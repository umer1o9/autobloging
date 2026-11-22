import { linkedinLogin, linkedinConnection, linkedinPages } from './linkedin.js';
import { facebookLogin, facebookAppEnvironment } from './facebook-login.js';
import http from 'node:http';
import { startServer } from './startup.js';
import { createMcpEndpoint } from './mcp.js';
import { knowledgeSummary } from './website-knowledge.js';
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

export async function createApp({ database = process.env.DATABASE_URL, origin = process.env.APP_ORIGIN || 'http://127.0.0.1:3210', provider = createProvider(), imageProvider = createImageProvider(), workers = process.env.WORKER_MODE !== 'cron', migrate = false, migrationDatabase = process.env.MIGRATION_DATABASE_URL, httpServer, reportStartup = () => {}, mcpConfig } = {}) {
  const store = new Store(database);
  try { await store.prepareSchema({ migrate, migrationDatabase, onPhase: reportStartup }); } catch (error) { await store.close(); throw error; }
  const domain = new Domain(store, provider, imageProvider), throttle = new Map(), adminOrigins = allowedAdminOrigins(origin);
  const mcpEndpoint = createMcpEndpoint({ store, domain, origins: adminOrigins, config: mcpConfig });
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
  const facebookFor = site => facebookLogin(origin, facebookAppEnvironment(site?.facebookApp));
  const readFacebookFlow = req => {
    const [workspace, siteId, token] = (readCookie(req, 'ab_facebook') || '').split('.');
    return { workspace, siteId, token };
  };
  const saveFacebookFlow = (facebook, workspace, siteId, flow) => flowCookie([workspace, siteId, facebook.seal(flow)].join('.'));
  const readCookie = (req, name) => req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(name + '='))?.slice(name.length + 1);
  const flowCookie = value => `ab_facebook=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${value ? 600 : 0}`;
  const linkedinCookie = value => `ab_linkedin=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${value ? 600 : 0}`;
  const sessionBinding = req => hash(readCookie(req, 'ab_session') || '');
  reportStartup('Preparing HTTP routes');
  const handle = async (req, res) => {
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
      if (path === '/linkedin/callback' && method === 'GET') {
        const [workspace, siteId, sealed] = (readCookie(req, 'ab_linkedin') || '').split('.');
        const site = workspace && siteId && await store.get('site', workspace, siteId);
        const login = linkedinLogin(origin, site?.linkedinApp);
        const flow = login.open(sealed);
        if (!flow || flow.siteId !== siteId || flow.workspace !== workspace || flow.expires <= Date.now() ||
            flow.state !== url.searchParams.get('state') || (await store.sessionUser(flow.binding, Date.now()))?.workspace !== workspace) {
          throw new AppError(400, 'LinkedIn sign-in expired. Start again from Social publishing.');
        }
        let status = 'failed';
        try {
          const code = url.searchParams.get('code');
          if (!code) throw new Error('Missing authorization code.');
          const account = await login.exchange(code);
          await store.transaction(async () => {
            const current = await domain.need('site', workspace, siteId);
            if (JSON.stringify(current.linkedinApp) !== JSON.stringify(site.linkedinApp) || !(await store.sessionUser(flow.binding, Date.now()))) throw new Error('LinkedIn setup changed.');
            current.linkedinConnection = login.seal(account);
            delete current.linkedinPages;
            if (current.social) current.social.enabled = false;
            await store.put('site', workspace, siteId, current);
            await store.audit(workspace, siteId, 'social.linkedin_connected', siteId);
          }, workspace);
          status = 'connected';
        } catch { /* Give the user a safe error without exposing provider credentials. */ }
        res.writeHead(303, { location: `/websites?site=${encodeURIComponent(siteId)}&linkedin=${status}`, 'set-cookie': linkedinCookie(''), 'cache-control': 'no-store' });
        return res.end();
      }
      if (path === '/facebook/callback' && method === 'GET') {
        const { workspace, siteId, token: sealed } = readFacebookFlow(req);
        const site = workspace && siteId && await store.get('site', workspace, siteId);
        const facebook = facebookFor(site);
        const flow = site && facebook.open(sealed);
        if (flow?.stage !== 'authorize' || flow.expires <= Date.now() || flow.state !== url.searchParams.get('state') || flow.siteId !== siteId || flow.workspace !== workspace || (await store.sessionUser(flow.binding, Date.now()))?.workspace !== workspace) {
          throw new AppError(400, 'Facebook sign-in expired. Start again from Social publishing.');
        }
        try {
          const code = url.searchParams.get('code');
          if (!code) throw new Error();
          const token = await facebook.exchange(code);
          if (!token) throw new Error();
          const next = [workspace, siteId, facebook.seal({ ...flow, stage: 'choose', token })].join('.');
          if (next.length > 3600) throw new Error();
          res.writeHead(303, { location: `/websites?site=${encodeURIComponent(flow.siteId)}&facebook=choose`, 'set-cookie': flowCookie(next), 'cache-control': 'no-store' });
          return res.end();
        } catch {
          res.writeHead(303, { location: `/websites?site=${encodeURIComponent(flow.siteId)}&facebook=failed`, 'set-cookie': flowCookie(''), 'cache-control': 'no-store' });
          return res.end();
        }
      }
      if (path === '/mcp') return await mcpEndpoint(req, res);
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
        if (path === '/api/delivery-documentation' && method === 'GET') {
          return send(res, 200, {
            guide: readFileSync(new URL('../docs/DELIVERY_API_INTEGRATION.md', import.meta.url), 'utf8'),
            openapi: JSON.parse(readFileSync(new URL('../docs/DELIVERY_API.openapi.json', import.meta.url), 'utf8'))
          });
        }
        if (path === '/api/mcp-documentation' && method === 'GET') return send(res, 200, { guide: readFileSync(new URL('../docs/MCP.md', import.meta.url), 'utf8') });
        if (path === '/api/auth/me' && method === 'GET') return send(res, 200, { user });
        if (path === '/api/auth/logout' && method === 'POST') {
          const token = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('ab_session='))?.slice(11);
          await store.deleteSession(hash(token || ''));
          return send(res, 200, { ok: true }, { 'set-cookie': cookie('') });
        }
        if (path === '/api/dashboard' && method === 'GET') {
          const [siteRecords, topics, articleRecords, jobRecords, linkedInPublished] = await Promise.all([
            store.list('site', workspace), store.list('topic', workspace), store.list('article', workspace),
            store.list('job', workspace), domain.social.publishedLinkedInArticleIds(workspace)
          ]);
          const sites = await Promise.all(siteRecords.map(async s => ({ ...domain.safeSite(s), linkedinActive: !!linkedinConnection(s), reservedCents: await domain.reserved(workspace, s.id), knowledge: knowledgeSummary(await store.getKnowledge(workspace, s.id)) })));
          const articles = articleRecords.map(({ content, research, ...a }) => ({
            ...a, title: content.title, slug: content.slug, linkedinPublished: linkedInPublished.has(a.id)
          }));
          return send(res, 200, { user, sites, topics, articles, jobs: jobRecords.map(({ research, candidate, settings, websiteKnowledge, ...j }) => j), provider: { ready: provider.ready, models: provider.models, images: { configured: imageProvider.configured, defaults: imageProvider.defaults, models: imageProvider.models } } });
        }
        if (path === '/api/sites' && method === 'POST') return send(res, 201, { site: await domain.saveSite(workspace, await body(req)) });
        let match;
        if ((match = path.match(/^\/api\/sites\/([^/]+)\/social\/linkedin\/(settings|start|pages|disconnect)$/))) {
          const site = await domain.need('site', workspace, match[1]);
          const action = match[2];
          if (method === 'POST' && action === 'pages') {
            const account = linkedinConnection(site);
            if (!account) throw new AppError(409, 'Connect your LinkedIn account first.');
            const pages = await linkedinPages(account);
            await store.transaction(async () => {
              const current = await domain.need('site', workspace, site.id);
              if (current.linkedinConnection !== site.linkedinConnection) throw new AppError(409, 'LinkedIn connection changed. Refresh Pages again.');
              current.linkedinPages = pages;
              await store.put('site', workspace, site.id, current);
            }, workspace);
            return send(res, 200, { pages });
          }
          if (method === 'POST' && action === 'start') {
            const login = linkedinLogin(origin, site.linkedinApp);
            if (!login.configured) throw new AppError(409, 'Save LinkedIn app credentials and open AutoBlog Studio on HTTPS first.');
            const state = randomBytes(32).toString('hex');
            const flow = { state, expires: Date.now() + 600000, binding: sessionBinding(req), workspace, siteId: site.id };
            return send(res, 200, { url: login.authorize(state) }, { 'set-cookie': linkedinCookie([workspace, site.id, login.seal(flow)].join('.')) });
          }
          const setup = method === 'PUT' && action === 'settings';
          if (!setup && !(method === 'POST' && action === 'disconnect')) throw new AppError(405, 'Method not allowed.');
          let app;
          if (setup) {
            const configuredOrigin = new URL(origin);
            if (configuredOrigin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(configuredOrigin.hostname)) throw new AppError(403, 'Use HTTPS to save LinkedIn app settings.');
            const { clientId, clientSecret, pageAccess } = await body(req);
            if (typeof clientId !== 'string' || !/^[a-zA-Z0-9_-]{4,128}$/.test(clientId) ||
                typeof clientSecret !== 'string' || !/^\S{6,256}$/.test(clientSecret)) throw new AppError(400, 'Enter a valid LinkedIn Client ID and Client Secret.');
            app = { id: clientId, secret: clientSecret, origin, pageAccess: pageAccess === true };
          }
          await store.transaction(async () => {
            const current = await domain.need('site', workspace, site.id);
            if (setup && JSON.stringify(current.linkedinApp) === JSON.stringify(app)) return;
            if (setup) current.linkedinApp = app;
            delete current.linkedinConnection;
            delete current.linkedinPages;
            if (current.social) current.social.enabled = false;
            await store.put('site', workspace, site.id, current);
            await store.audit(workspace, site.id, setup ? 'social.linkedin_app_configured' : 'social.linkedin_disconnected', site.id);
          }, workspace);
          return send(res, 200, { ok: true }, { 'set-cookie': linkedinCookie('') });
        }
        if ((match = path.match(new RegExp('^/api/sites/([^/]+)/social/facebook/(settings|start|pages|connect|disconnect)$')))) {
          const site = await domain.need('site', workspace, match[1]);
          const action = match[2];
          if (method === 'PUT' && action === 'settings') {
            const configuredOrigin = new URL(origin);
            if (configuredOrigin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(configuredOrigin.hostname)) {
              throw new AppError(403, 'Use HTTPS when saving Meta app settings.');
            }
            const { appId, appSecret } = await body(req);
            if (typeof appId !== 'string' || !/^\d{1,32}$/.test(appId) ||
                typeof appSecret !== 'string' || !/^[a-fA-F0-9]{32}$/.test(appSecret)) {
              throw new AppError(400, 'Enter a numeric Meta App ID and the 32-character Meta App Secret.');
            }
            await store.transaction(async () => {
              const current = await domain.need('site', workspace, site.id);
              if (current.facebookApp?.id === appId && current.facebookApp.secret === appSecret && current.facebookApp.origin === origin) return;
              current.facebookApp = { id: appId, secret: appSecret, origin };
              delete current.facebookConnection;
              if (current.social) current.social.enabled = false;
              await store.put('site', workspace, site.id, current);
              await store.audit(workspace, site.id, 'social.facebook_app_configured', site.id);
            }, workspace);
            return send(res, 200, { ok: true }, { 'set-cookie': flowCookie('') });
          }
          const facebook = facebookFor(site);
          if (method === 'POST' && action === 'disconnect') {
            await store.transaction(async () => {
              const current = await domain.need('site', workspace, site.id);
              delete current.facebookConnection;
              if (current.social) current.social.enabled = false;
              await store.put('site', workspace, site.id, current);
            }, workspace);
            return send(res, 200, { ok: true });
          }
          if (!facebook.configured) throw new AppError(409, 'Configure Facebook App ID, App Secret and the HTTPS app origin first.');
          if (method === 'POST' && action === 'start') {
            const state = randomBytes(32).toString('hex');
            const flow = { stage: 'authorize', state, expires: Date.now() + 600000, binding: sessionBinding(req), workspace, siteId: site.id };
            return send(res, 200, { url: facebook.authorize(state) }, { 'set-cookie': saveFacebookFlow(facebook, workspace, site.id, flow) });
          }
          const flow = facebook.open(readFacebookFlow(req).token);
          if (flow?.stage !== 'choose' || flow.expires <= Date.now() || flow.binding !== sessionBinding(req) || flow.siteId !== site.id || flow.workspace !== workspace) {
            throw new AppError(403, 'Facebook sign-in expired. Start again from Social publishing.');
          }
          let pages;
          try { pages = await facebook.pages(flow.token); }
          catch { throw new AppError(502, 'Could not load authorized Pages. Check Meta permissions and sign in again.'); }
          if (method === 'GET' && action === 'pages') return send(res, 200, { pages: pages.map(({ id, name }) => ({ id, name })) });
          if (method === 'POST' && action === 'connect') {
            const input = await body(req);
            const page = pages.find(item => item.id === input.pageId);
            if (!page) throw new AppError(400, 'Select a Page authorized for publishing.');
            await store.transaction(async () => {
              const current = await domain.need('site', workspace, site.id);
              if (JSON.stringify(current.facebookApp) !== JSON.stringify(site.facebookApp)) throw new AppError(409, 'Facebook app settings changed. Sign in again.');
              current.facebookConnection = facebook.seal({ pageId: page.id, accessToken: page.access_token });
              if (current.social) current.social.enabled = false;
              await store.put('site', workspace, site.id, current);
              await store.audit(workspace, site.id, 'social.facebook_connected', site.id);
            }, workspace);
            return send(res, 200, { ok: true }, { 'set-cookie': flowCookie('') });
          }
          throw new AppError(405, 'Method not allowed.');
        }

        if ((match = path.match(/^\/api\/sites\/([^/]+)\/social(?:\/(accounts|posts\/([a-f0-9-]+)))?$/))) {
          const site = await domain.need('site', workspace, match[1]);
          if (!match[2] && method === 'GET') return send(res, 200, { ...await domain.social.view(workspace, site), facebookLoginReady: facebookFor(site).configured, facebookAppId: site.facebookApp?.id || '', facebookCallback: new URL('/facebook/callback', origin).href, facebookLinked: !!site.facebookConnection, linkedinClientId: site.linkedinApp?.id || '',
            linkedinLoginReady: linkedinLogin(origin, site.linkedinApp).configured, linkedinCallback: new URL('/linkedin/callback', origin).href,
            linkedinPageAccess: site.linkedinApp?.pageAccess === true, linkedinPagesReady: linkedinConnection(site)?.pageAccess === true, linkedinPages: site.linkedinPages || [],
            linkedinLinked: !!site.linkedinConnection, linkedinMember: linkedinConnection(site)?.name || '', linkedinActive: !!linkedinConnection(site) });
          if (!match[2] && method === 'PUT') {
            await domain.social.configure(workspace, site, await body(req));
            return send(res, 200, await domain.social.view(workspace, await domain.need('site', workspace, site.id)));
          }
          if (match[2] === 'accounts' && method === 'GET') return send(res, 200, { platforms: await domain.social.connectedAccounts(site) });
          if (match[3] && method === 'PUT') {
            await domain.social.edit(workspace, site.id, match[3], await body(req));
            return send(res, 200, { ok: true });
          }
          throw new AppError(405, 'Method not allowed.');
        }
        if ((match = path.match(/^\/api\/sites\/([^/]+)\/knowledge(?:\/(sync|document|search))?$/))) {
          await domain.need('site', workspace, match[1]);
          if (method === 'POST' && match[2] === 'sync') return send(res, 202, { knowledge: await domain.queueWebsiteSync(workspace, match[1]) });
          if (method === 'GET' && match[2] === 'search') return send(res, 200, await domain.knowledge.context(workspace, match[1], (url.searchParams.get('q') || '').slice(0,500)));
          if (method === 'GET' && match[2] === 'document') return send(res, 200, { markdown: await domain.knowledge.document(workspace, match[1], url.searchParams.get('url')) });
          if (method === 'GET' && !match[2]) return send(res, 200, await domain.knowledge.view(workspace, match[1]));
          throw new AppError(405, 'Method not allowed.');
        }
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
      const files = { '/article.css': ['article.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      const appRoutes = new Set(['/', ...Object.values({ automation: '/automation', overview: '/overview', sites: '/websites', topics: '/topics', review: '/articles', calendar: '/calendar', jobs: '/activity', api: '/delivery-api', mcp: '/mcp-connection' })]);
      const file = files[path] || (appRoutes.has(path) || /^\/articles\/[^/]+$/.test(path) ? ['index.html', 'text/html'] : null);
      if (method !== 'GET' || !file) throw new AppError(404, 'Not found.');
      res.writeHead(200, { 'content-type': `${file[1]}; charset=utf-8`, 'cache-control': 'no-store' });
      res.end(readFileSync(resolve(publicDir, file[0])));
    } catch (error) {
      if (!error.status || error.status >= 500) console.error(JSON.stringify({ event: 'http.request_failed', requestId, method: req.method, path: req.url.split('?')[0], status: error.status || 500, code: error.code || 'APPLICATION_ERROR' }));
      if (!res.headersSent) send(res, error.status || 500, { error: error.status ? error.message : 'Unexpected server error.', requestId }); else res.end();
    }
  };
  const server = httpServer || http.createServer(handle);
  let timer, activeTick, closing = false;
  const inFlight = new Set();
  reportStartup(workers ? 'Acquiring background worker lock' : 'Configuring cron worker mode');
  const workerOwner = workers && await store.acquireWorker();
  if (workerOwner) {
    reportStartup('Recovering interrupted generation jobs');
    await domain.recoverInterrupted();
    const tick = async () => {
      if (closing || !store.workerActive || activeTick) return;
      activeTick = (async () => {
        await domain.syncWebsites(message => console.log(message));
        await domain.automate();
        await domain.publishDue();
        await domain.social.run();
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
  return { server, handle, store, domain, close: async () => {
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
  const startup = startServer({ host, port, initialize: (httpServer, reportStartup) => createApp({ migrate: true, httpServer, reportStartup }) });
  void startup.ready.then(() => {
    console.log(`AutoBlog Studio is running on MySQL at ${process.env.APP_ORIGIN || `http://${host}:${port}`}`);
  }).catch(error => {
    console.error(`AutoBlog Studio failed to start (${error.code || 'STARTUP_ERROR'}): ${error.message}`);
    console.error('Check database access. Missing migrations require CREATE/ALTER privileges, or a MIGRATION_DATABASE_URL for the same database.');
    process.exitCode = 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void startup.close().then(() => process.exit(0)); });
}
