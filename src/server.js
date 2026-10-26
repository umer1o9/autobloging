import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Store } from './store.js';
import { Domain, AppError, hash } from './domain.js';
import { createProvider } from './provider.js';
import { createImageProvider } from './image-provider.js';

const derive = promisify(scrypt);
async function passwordHash(password, salt = randomBytes(16).toString('hex')) { return `${salt}:${(await derive(password, salt, 64)).toString('hex')}`; }
async function verify(password, saved) { const check = await passwordHash(password, saved.split(':')[0]); return timingSafeEqual(Buffer.from(check), Buffer.from(saved)); }
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
function allowedAdminOrigins(origin) {
  const configured = new URL(origin), allowed = new Set([configured.origin]);
  if (configured.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(configured.hostname)) {
    for (const hostname of ['127.0.0.1', 'localhost', '[::1]']) {
      const host = hostname === '[::1]' ? `[${hostname.slice(1, -1)}]` : hostname;
      allowed.add(`http://${host}${configured.port ? `:${configured.port}` : ''}`);
    }
  }
  for (const value of String(process.env.APP_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)) {
    try { allowed.add(new URL(value).origin); } catch { /* Ignore malformed optional origins. */ }
  }
  return allowed;
}

export async function createApp({ database = process.env.DATABASE_URL, origin = process.env.APP_ORIGIN || 'http://127.0.0.1:3210', provider = createProvider(), imageProvider = createImageProvider(), workers = process.env.WORKER_MODE !== 'cron' } = {}) {
  const store = new Store(database);
  try { await store.assertSchema(); } catch (error) { await store.close(); throw error; }
  const domain = new Domain(store, provider, imageProvider), throttle = new Map(), adminOrigins = allowedAdminOrigins(origin);
  const imageOrigins = [...adminOrigins].join(' ');
  const send = (res, status, value, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(value)); };
  async function body(req) {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new AppError(415, 'Use application/json.');
    let text = '';
    for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 500000) throw new AppError(413, 'Request is too large.'); }
    try { const value = JSON.parse(text || '{}'); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value; } catch { throw new AppError(400, 'Invalid JSON object.'); }
  }
  async function session(req) {
    const token = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('ab_session='))?.slice(11);
    if (!token) throw new AppError(401, 'Sign in to continue.');
    const user = await store.sessionUser(hash(token), Date.now());
    if (!user) throw new AppError(401, 'Session expired. Sign in again.');
    return user;
  }
  const cookie = value => `ab_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${value ? 604800 : 0}${origin.startsWith('https:') ? '; Secure' : ''}`;
  const server = http.createServer(async (req, res) => {
    const requestId = randomUUID();
    const isRunRequest = req.method === 'POST' && /^\/api\/sites\/[^/]+\/automation\/run(?:\?|$)/.test(req.url);
    const runStarted = Date.now();
    const runLog = message => console.log(`[run] ${new Date().toISOString()} requestId=${requestId} ${message} elapsedMs=${Date.now() - runStarted}`);
    if (isRunRequest) {
      runLog('request started');
      res.once('finish', () => runLog(`response sent status=${res.statusCode}`));
      res.once('close', () => { if (!res.writableFinished) runLog('connection closed before response finished'); });
    }
    res.setHeader('x-request-id', requestId);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: ${imageOrigins}; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
    try {
      const url = new URL(req.url, origin), path = url.pathname, method = req.method;
      if (!['GET', 'HEAD'].includes(method)) {
        if (req.headers.origin && !adminOrigins.has(req.headers.origin)) throw new AppError(403, 'Cross-origin administration is not allowed.');
        if (req.headers['x-autoblog-client'] !== 'admin') throw new AppError(403, 'Admin request header required.');
      }
      if (path === '/health' && method === 'GET') { await store.query('SELECT 1'); return send(res, 200, { status: 'ok' }); }
      const media = path.match(/^\/media\/([a-f0-9-]+\.(png|jpg|jpeg|webp))$/);
      if (media && method === 'GET') {
        const file = await imageProvider.read(media[1]).catch(() => null);
        if (!file) throw new AppError(404, 'Image not found.');
        res.writeHead(200, { 'content-type': `image/${media[2] === 'jpg' ? 'jpeg' : media[2]}`, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
        return res.end(file);
      }
      if (['/api/auth/register', '/api/auth/login'].includes(path) && method === 'POST') {
        const ip = req.socket.remoteAddress, time = Date.now(), previous = throttle.get(ip);
        const rate = previous && time - previous.at < 900000 ? previous : { count: 0, at: time };
        rate.count++; throttle.set(ip, rate);
        if (rate.count > 30) throw new AppError(429, 'Too many sign-in attempts. Try again in 15 minutes.');
        const input = await body(req), email = String(input.email || '').trim().toLowerCase(), password = input.password;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || typeof password !== 'string' || password.length < 12 || password.length > 256) throw new AppError(400, 'Use a valid email and a password of 12–256 characters.');
        let user;
        if (path.endsWith('register')) {
          if (process.env.DISABLE_REGISTRATION === 'true') throw new AppError(403, 'Registration is disabled.');
          if ((await store.userByEmail(email))) throw new AppError(409, 'Unable to create this account. Try signing in.');
          const encoded = await passwordHash(password);
          user = { id: randomUUID(), email, workspace: randomUUID(), name: String(input.name || 'My workspace').trim().slice(0, 100) };
          try { await store.createUser({ ...user, password: encoded }); }
          catch { throw new AppError(409, 'Unable to create this account. Try signing in.'); }
        } else {
          user = await store.userByEmail(email);
          const fallback = `00000000000000000000000000000000:${'0'.repeat(128)}`;
          const valid = await verify(password, user?.password || fallback);
          if (!user || !valid) throw new AppError(401, 'Email or password is incorrect.');
          delete user.password;
        }
        const token = randomBytes(32).toString('hex');
        await store.createSession(hash(token), user.id, Date.now() + 604800000);
        return send(res, 200, { user }, { 'set-cookie': cookie(token) });
      }
      if (path.startsWith('/api/v1/sites/') && method === 'GET') {
        const match = path.match(/^\/api\/v1\/sites\/([^/]+)\/articles(?:\/([^/]+))?$/);
        if (!match) throw new AppError(404, 'Endpoint not found.');
        const key = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
        const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 20);
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new AppError(400, 'Use offset >= 0 and limit between 1 and 100.');
        const result = await domain.delivered(match[1], key, match[2], { offset, limit });
        return send(res, 200, match[2] ? { article: result } : result);
      }
      if (path.startsWith('/api/')) {
        const user = await session(req), workspace = user.workspace;
        if (path === '/api/auth/me' && method === 'GET') return send(res, 200, { user });
        if (path === '/api/auth/logout' && method === 'POST') {
          const token = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('ab_session='))?.slice(11);
          await store.deleteSession(hash(token || ''));
          return send(res, 200, { ok: true }, { 'set-cookie': cookie('') });
        }
        if (path === '/api/dashboard' && method === 'GET') {
          const [siteRecords, topics, articleRecords, jobRecords] = await Promise.all([store.list('site', workspace), store.list('topic', workspace), store.list('article', workspace), store.list('job', workspace)]);
          const sites = await Promise.all(siteRecords.map(async s => ({ ...domain.safeSite(s), reservedCents: await domain.reserved(workspace, s.id) })));
          return send(res, 200, { user, sites, topics, articles: articleRecords.map(({ content, research, ...a }) => ({ ...a, title: content.title, slug: content.slug })), jobs: jobRecords.map(({ research, candidate, settings, ...j }) => j), provider: { ready: provider.ready, models: provider.models, images: { configured: imageProvider.configured, defaults: imageProvider.defaults, models: imageProvider.models } } });
        }
        if (path === '/api/sites' && method === 'POST') return send(res, 201, { site: await domain.saveSite(workspace, await body(req)) });
        let match;
        if ((match = path.match(/^\/api\/sites\/([^/]+)$/)) && method === 'PUT') return send(res, 200, { site: await domain.saveSite(workspace, await body(req), match[1]) });
        if ((match = path.match(/^\/api\/sites\/([^/]+)\/automation$/)) && method === 'POST') return send(res, 200, { site: await domain.configureAutomation(workspace, match[1], await body(req)) });
        if ((match = path.match(/^\/api\/sites\/([^/]+)\/automation\/run$/)) && method === 'POST') {
          runLog('before queue transaction');
          const site = await domain.runAutomationNow(workspace, match[1]);
          runLog('after queue transaction');
          return send(res, 202, { site });
        }
        if ((match = path.match(/^\/api\/sites\/([^/]+)\/key$/)) && method === 'POST') return send(res, 200, await domain.rotateKey(workspace, match[1]));
        if ((match = path.match(/^\/api\/sites\/([^/]+)\/topics$/)) && method === 'POST') return send(res, 201, { topic: await domain.createTopic(workspace, match[1], await body(req)) });
        if ((match = path.match(/^\/api\/topics\/([^/]+)\/draft$/)) && method === 'POST') return send(res, 201, { article: await domain.createDraft(workspace, match[1]) });
        if ((match = path.match(/^\/api\/topics\/([^/]+)\/generate$/)) && method === 'POST') {
          const job = await domain.startGeneration(workspace, match[1]);
          // The elected worker picks up this durable queued job on its next tick.
          return send(res, 202, { job });
        }
        if ((match = path.match(/^\/api\/jobs\/([^/]+)$/)) && method === 'GET') return send(res, 200, { job: await domain.need('job', workspace, match[1]) });
        if ((match = path.match(/^\/api\/articles\/([^/]+)$/))) {
          if (method === 'GET') return send(res, 200, { article: await domain.articleDetail(workspace, match[1]) });
          if (method === 'PUT') return send(res, 200, { article: await domain.saveArticle(workspace, match[1], await body(req)) });
        }
        if ((match = path.match(/^\/api\/articles\/([^/]+)\/images$/)) && method === 'POST') return send(res, 200, { article: await domain.generateArticleImage(workspace, match[1], await body(req)) });
        if ((match = path.match(/^\/api\/articles\/([^/]+)\/(approve|reject|schedule|unpublish)$/)) && method === 'POST') return send(res, 200, { article: await domain.transition(workspace, match[1], match[2], await body(req), user.id) });
        throw new AppError(404, 'Endpoint not found.');
      }
      const files = { '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      const appRoutes = new Set(['/', ...Object.values({ automation: '/automation', overview: '/overview', sites: '/websites', topics: '/topics', review: '/articles', calendar: '/calendar', jobs: '/activity', api: '/delivery-api' })]);
      const file = files[path] || (appRoutes.has(path) || /^\/articles\/[^/]+$/.test(path) ? ['index.html', 'text/html'] : null);
      if (method !== 'GET' || !file) throw new AppError(404, 'Not found.');
      res.writeHead(200, { 'content-type': `${file[1]}; charset=utf-8`, 'cache-control': 'no-store' });
      res.end(readFileSync(resolve(publicDir, file[0])));
    } catch (error) { if (!res.headersSent) send(res, error.status || 500, { error: error.status ? error.message : 'Unexpected server error.', requestId }); else res.end(); }
  });
  let timer, activeTick, closing = false;
  const inFlight = new Set();
  const workerOwner = workers && await store.acquireWorker();
  if (workerOwner) {
    await domain.recoverInterrupted();
    const tick = async () => {
      if (closing || !store.workerActive || activeTick) return;
      activeTick = (async () => {
        await domain.automate();
        await domain.publishDue();
        await store.cleanSessions();
        for (const [key, value] of throttle) if (Date.now() - value.at > 900000) throttle.delete(key);
        const queued = await store.queuedJobs(Math.max(0, 2 - domain.running.size));
        for (const { workspace, value: job } of queued) {
          if (closing || !store.workerActive) break;
          const promise = domain.runJob(workspace, job.id).catch(() => console.error('Job persistence failed; inspect database availability.'));
          inFlight.add(promise); promise.finally(() => inFlight.delete(promise));
        }
      })();
      try { await activeTick; } catch (error) { console.error(`Worker tick failed (${error.code || 'application error'}).`); }
      finally { activeTick = null; }
    };
    timer = setInterval(() => void tick(), 5000).unref();
  }
  return { server, store, domain, close: async () => {
    closing = true; clearInterval(timer);
    await new Promise(r => server.close(r));
    await activeTick?.catch(() => {});
    await Promise.allSettled([...inFlight]);
    await store.close();
  } };
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : '';
const directEntry = entryPath === fileURLToPath(import.meta.url);
const liteSpeedEntry = /(?:^|\/)lsnode\.js$/.test(entryPath);

if (directEntry || liteSpeedEntry) {
  const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 3210);
  void createApp().then(app => {
    app.server.listen(port, host, () => console.log(`AutoBlog Studio is running on MySQL at ${process.env.APP_ORIGIN || `http://${host}:${port}`}`));
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
  }).catch(error => {
    console.error('AutoBlog Studio failed to start.', error);
    process.exitCode = 1;
  });
}
