import mysql from 'mysql2/promise';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const tables = { site: 'websites', topic: 'topics', article: 'articles', job: 'jobs' };
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
const conflict = message => Object.assign(new Error(message), { status: 409 });
export class Store {
  constructor(url = process.env.DATABASE_URL) {
    if (!url?.startsWith('mysql://')) throw new Error('Set DATABASE_URL to a MySQL connection URL. See README.md.');
    const uri = new URL(url);
    this.database = decodeURIComponent(uri.pathname.slice(1));
    this.pool = mysql.createPool({ host: uri.hostname, port: Number(uri.port || 3306), user: decodeURIComponent(uri.username), password: decodeURIComponent(uri.password), database: this.database,
      waitForConnections: true, connectionLimit: 10, queueLimit: 100, charset: 'utf8mb4', timezone: 'Z', supportBigNumbers: true,
      ...(process.env.MYSQL_SSL === 'true' ? { ssl: { rejectUnauthorized: true } } : {}) });
    this.context = new AsyncLocalStorage();
  }
  async query(sql, values = []) { const [rows] = await (this.context.getStore() || this.pool).execute(sql, values); return rows; }
  async migrate() {
    const connection = await this.pool.getConnection();
    const name = `autoblog-schema:${this.database}`.slice(0, 64);
    try {
      const [[lock]] = await connection.execute('SELECT GET_LOCK(?, 30) AS acquired', [name]);
      if (!lock.acquired) throw new Error('Another schema migration is running.');
      await connection.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB');
      const [applied] = await connection.execute('SELECT version FROM schema_migrations WHERE version=1');
      if (!applied.length) {
        const sql = await readFile(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8');
        for (const statement of sql.split(';').map(x => x.trim()).filter(Boolean)) await connection.query(statement);
        await connection.execute('INSERT INTO schema_migrations (version) VALUES (1)');
      }
    } finally { await connection.execute('SELECT RELEASE_LOCK(?)', [name]).catch(() => {}); connection.release(); }
  }
  async assertSchema() {
    const rows = await this.query('SELECT version FROM schema_migrations WHERE version=1');
    if (!rows.length) throw new Error('Run npm run db:migrate before starting the application.');
  }
  async transaction(fn, scope = 'global') {
    if (this.context.getStore()) return fn();
    const connection = await this.pool.getConnection();
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await connection.beginTransaction();
      const result = await this.context.run(connection, async () => {
        // Serialize cross-table policy decisions for one workspace, not for the entire database.
        await this.query('INSERT INTO coordination_locks (lock_key) VALUES (?) ON DUPLICATE KEY UPDATE lock_key=VALUES(lock_key)', [scope]);
        await this.query('SELECT lock_key FROM coordination_locks WHERE lock_key=? FOR UPDATE', [scope]);
        return fn();
      });
      await connection.commit(); return result;
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
  table(kind) { if (!tables[kind]) throw new Error('Unknown record kind'); return tables[kind]; }
  async createWorkspace(id, name) { await this.query('INSERT INTO workspaces (id,name) VALUES (?,?)', [id, name]); }
  async createUser(user) {
    return this.transaction(async () => {
      await this.createWorkspace(user.workspace, user.name);
      await this.query('INSERT INTO users (id,email,password_hash,workspace_id,name) VALUES (?,?,?,?,?)', [user.id, user.email, user.password, user.workspace, user.name]);
    }, user.workspace);
  }
  async userByEmail(email) { return (await this.query('SELECT id,email,password_hash AS password,workspace_id AS workspace,name FROM users WHERE email=?', [email]))[0]; }
  async sessionUser(token, at) { return (await this.query('SELECT u.id,u.email,u.workspace_id AS workspace,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?', [token, at]))[0]; }
  async createSession(token, user, expiry) { await this.query('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)', [token, user, expiry]); }
  async deleteSession(token) { await this.query('DELETE FROM sessions WHERE token_hash=?', [token]); }
  async cleanSessions() { await this.query('DELETE FROM sessions WHERE expires_at<? LIMIT 1000', [Date.now()]); }
  async put(kind, workspace, site, value) {
    if (!this.context.getStore()) return this.transaction(() => this.put(kind, workspace, site, value), workspace);
    const table = this.table(kind);
    const existing = (await this.query(`SELECT workspace_id,${kind === 'site' ? 'id' : 'site_id'} AS site_id FROM ${table} WHERE id=? FOR UPDATE`, [value.id]))[0];
    if (existing && (existing.workspace_id !== workspace || existing.site_id !== site)) throw conflict('Record belongs to another workspace or website.');
    const fields = { workspace_id: workspace, ...(kind !== 'site' ? { site_id: site } : {}), payload: JSON.stringify(value), created_at: value.createdAt || new Date().toISOString() };
    if (kind === 'site') Object.assign(fields, { name: value.name, api_key_hash: value.apiKeyHash || null });
    if (kind === 'topic') Object.assign(fields, { normalized_title: value.normalized, status: value.status });
    if (kind === 'article') Object.assign(fields, { topic_id: value.topicId, slug: value.content.slug || null, status: value.status, revision: value.revision, approved_revision: value.approvedRevision, scheduled_at: value.scheduledAt || null, published_at: value.publishedAt || null });
    if (kind === 'job') Object.assign(fields, { topic_id: value.topicId, status: value.status, reserved_cents: value.reservedCents });
    try {
      if (existing) await this.query(`UPDATE ${table} SET ${Object.keys(fields).map(k => `${k}=?`).join(',')} WHERE id=? AND workspace_id=?`, [...Object.values(fields), value.id, workspace]);
      else await this.query(`INSERT INTO ${table} (id,${Object.keys(fields).join(',')}) VALUES (${Array(Object.keys(fields).length + 1).fill('?').join(',')})`, [value.id, ...Object.values(fields)]);
    } catch (error) { if (error.code === 'ER_DUP_ENTRY') throw conflict('A topic, article slug, or publication slot already exists for this website.'); throw error; }
    if (kind === 'article') {
      if (value.approvedRevision != null && value.reviewedBy) await this.query('INSERT INTO approvals (article_id,revision,workspace_id,reviewer_id,reviewed_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE reviewer_id=VALUES(reviewer_id),reviewed_at=VALUES(reviewed_at),invalidated_at=NULL', [value.id, value.approvedRevision, workspace, value.reviewedBy, value.reviewedAt]);
      if (value.approvedRevision === null) await this.query('UPDATE approvals SET invalidated_at=? WHERE article_id=? AND invalidated_at IS NULL', [new Date().toISOString(), value.id]);
    }
    if (kind === 'job') for (const [index, usage] of (value.usage || []).entries()) await this.query('INSERT INTO usage_records (job_id,call_index,workspace_id,site_id,stage,payload) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE payload=VALUES(payload)', [value.id, index, workspace, site, usage.stage, JSON.stringify(usage)]);
    return value;
  }
  async get(kind, workspace, id) { const rows = await this.query(`SELECT payload FROM ${this.table(kind)} WHERE workspace_id=? AND id=?`, [workspace, id]); return rows[0] ? parse(rows[0].payload) : null; }
  async list(kind, workspace, site) {
    const rows = await this.query(`SELECT payload FROM ${this.table(kind)} WHERE workspace_id=?${site === undefined ? '' : ' AND ' + (kind === 'site' ? 'id' : 'site_id') + '=?'} ORDER BY created_at DESC,id DESC`, site === undefined ? [workspace] : [workspace, site]);
    return rows.map(r => parse(r.payload));
  }
  async all(kind) { return (await this.query(`SELECT workspace_id AS workspace,${kind === 'site' ? 'id' : 'site_id'} AS site,payload FROM ${this.table(kind)} ORDER BY created_at,id`)).map(r => ({ workspace: r.workspace, site: r.site, value: parse(r.payload) })); }
  async findDeliverySite(site, keyHash) { const row = (await this.query('SELECT workspace_id AS workspace,payload FROM websites WHERE id=? AND api_key_hash=?', [site, keyHash]))[0]; return row ? { workspace: row.workspace, value: parse(row.payload) } : null; }
  async published(workspace, site, { slug, offset = 0, limit = 20 } = {}) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw Object.assign(new Error('Invalid pagination.'), { status: 400 });
    const where = "workspace_id=? AND site_id=? AND status='published'";
    if (slug) { const rows = await this.query(`SELECT payload FROM articles WHERE ${where} AND slug=?`, [workspace, site, slug]); return rows[0] ? parse(rows[0].payload) : null; }
    const rows = await this.query(`SELECT payload FROM articles WHERE ${where} ORDER BY published_at DESC,id DESC LIMIT ${limit} OFFSET ${offset}`, [workspace, site]);
    const [count] = await this.query(`SELECT COUNT(*) AS total FROM articles WHERE ${where}`, [workspace, site]);
    return { items: rows.map(r => parse(r.payload)), total: Number(count.total), offset, limit };
  }
  async dueArticles(at) { return (await this.query("SELECT workspace_id AS workspace,payload FROM articles WHERE status='scheduled' AND scheduled_at<=? ORDER BY scheduled_at,id LIMIT 100", [at])).map(r => ({ workspace: r.workspace, value: parse(r.payload) })); }
  async queuedJobs(limit) {
    limit = Math.max(0, Math.min(2, Math.trunc(limit)));
    const rows = await this.query("SELECT j.workspace_id AS workspace,j.payload FROM jobs j JOIN websites s ON s.id=j.site_id AND s.workspace_id=j.workspace_id WHERE j.status='queued' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.payload,'$.generationPaused')),'false') <> 'true' AND (COALESCE(JSON_UNQUOTE(JSON_EXTRACT(j.payload,'$.automationGenerated')),'false') <> 'true' OR JSON_UNQUOTE(JSON_EXTRACT(s.payload,'$.automation.enabled'))='true') ORDER BY j.created_at,j.id LIMIT 100");
    const current = Date.now();
    return rows.map(r => ({ workspace: r.workspace, value: parse(r.payload) })).filter(row => !row.value.retryAt || new Date(row.value.retryAt).getTime() <= current).slice(0, limit);
  }
  async reserved(workspace, site, month) { const [row] = await this.query("SELECT COALESCE(SUM(reserved_cents),0) AS reserved FROM jobs WHERE workspace_id=? AND site_id=? AND (created_at>=? OR status IN ('queued','running'))", [workspace, site, `${month}-01T00:00:00.000Z`]); return Number(row.reserved); }
  async audit(workspace, site, action, entity) { await this.query('INSERT INTO audit_events (id,workspace_id,site_id,action,entity_id,created_at) VALUES (?,?,?,?,?,?)', [randomUUID(), workspace, site, action, entity, new Date().toISOString()]); }
  async acquireWorker() {
    this.workerConnection = await this.pool.getConnection();
    const [[row]] = await this.workerConnection.execute('SELECT GET_LOCK(?,0) AS acquired', [`autoblog-worker:${this.database}`.slice(0,64)]);
    this.workerActive = row.acquired === 1;
    if (!this.workerActive) { this.workerConnection.release(); this.workerConnection = null; }
    else this.workerConnection.on('error', () => { this.workerActive = false; });
    return this.workerActive;
  }
  async close() {
    if (this.workerConnection) { await this.workerConnection.execute('SELECT RELEASE_LOCK(?)', [`autoblog-worker:${this.database}`.slice(0,64)]).catch(() => {}); this.workerConnection.release(); this.workerConnection = null; }
    await this.pool.end();
  }
}
