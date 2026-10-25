import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { Store } from '../src/store.js';

export async function importSqlite(store, path, backupDirectory = resolve('data/backups')) {
  const source = new DatabaseSync(path, { readOnly: true });
  let snapshot;
  try {
    source.exec('BEGIN');
    snapshot = { users: source.prepare('SELECT * FROM users ORDER BY id').all(), sessions: source.prepare('SELECT * FROM sessions ORDER BY hash').all(), records: source.prepare('SELECT * FROM records ORDER BY id').all(), events: source.prepare('SELECT * FROM events ORDER BY id').all() };
    source.exec('COMMIT');
  } finally { source.close(); }
  const encoded = JSON.stringify(snapshot), fingerprint = createHash('sha256').update(encoded).digest('hex');
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  await writeFile(resolve(backupDirectory, `sqlite-${fingerprint}.json`), encoded, { mode: 0o600, flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  return store.transaction(async () => {
    if ((await store.query('SELECT source_hash FROM data_imports WHERE source_hash=?', [fingerprint])).length) return { alreadyImported: true };
    for (const table of ['users', 'websites', 'topics', 'articles', 'jobs', 'sessions', 'audit_events', 'workspaces']) {
      const [row] = await store.query(`SELECT COUNT(*) AS count FROM ${table}`);
      if (Number(row.count)) throw new Error('Import requires an empty destination database. Existing MySQL data was not changed.');
    }
    const workspaceNames = new Map(snapshot.users.map(u => [u.workspace, u.name]));
    for (const r of snapshot.records) if (!workspaceNames.has(r.workspace)) workspaceNames.set(r.workspace, 'Imported workspace');
    for (const [id, name] of workspaceNames) await store.createWorkspace(id, name);
    for (const u of snapshot.users) await store.query('INSERT INTO users (id,email,password_hash,workspace_id,name) VALUES (?,?,?,?,?)', [u.id,u.email,u.password,u.workspace,u.name]);
    for (const s of snapshot.sessions) await store.createSession(s.hash,s.user_id,s.expires);
    const kinds = ['site', 'topic', 'article', 'job'];
    if (snapshot.records.some(r => !kinds.includes(r.kind))) throw new Error('Unknown source record type; import rolled back.');
    for (const kind of kinds) for (const r of snapshot.records.filter(r => r.kind === kind)) {
      const value = JSON.parse(r.body);
      await store.put(kind, r.workspace, r.site, value);
      if (!isDeepStrictEqual(await store.get(kind, r.workspace, r.id), value)) throw new Error('Imported content verification failed; transaction rolled back.');
    }
    for (const event of snapshot.events) await store.query('INSERT INTO audit_events (id,workspace_id,site_id,action,entity_id,created_at) VALUES (?,?,?,?,?,?)', [event.id,event.workspace,event.site,event.action,event.entity,event.at]);
    const counts = { workspaces: workspaceNames.size, users: snapshot.users.length, sessions: snapshot.sessions.length, events: snapshot.events.length, ...Object.fromEntries(kinds.map(kind => [kind, snapshot.records.filter(r => r.kind === kind).length])) };
    for (const [name, table] of Object.entries({ workspaces:'workspaces',users:'users',sessions:'sessions',events:'audit_events',site:'websites',topic:'topics',article:'articles',job:'jobs' })) {
      const [row] = await store.query(`SELECT COUNT(*) AS count FROM ${table}`);
      if (Number(row.count) !== counts[name]) throw new Error('Import row count mismatch; transaction rolled back.');
    }
    await store.query('INSERT INTO data_imports (source_hash,counts) VALUES (?,?)', [fingerprint,JSON.stringify(counts)]);
    return { alreadyImported: false, counts, backup: resolve(backupDirectory, `sqlite-${fingerprint}.json`) };
  }, 'sqlite-import');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const store = new Store(process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL);
  try { await store.assertSchema(); console.log(JSON.stringify(await importSqlite(store, resolve(process.argv[2] || 'data/autoblog.sqlite')), null, 2)); }
  finally { await store.close(); }
}
