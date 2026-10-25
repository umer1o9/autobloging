import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './mysql-helper.js';
import { createApp } from '../src/server.js';
import { website, validArticle } from './helpers.js';

test('REST API: auth, tenant isolation, revision workflow, publication, key rotation, and safe errors', async t => {
  const db = await testDatabase(t, false);
  const app = await createApp({ database: db.url, origin: 'http://localhost', workers: false, provider: { ready: false, models: {} } });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r)); t.after(async () => { await app.close(); await db.cleanup(); });
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  for (const path of ['/automation', '/overview', '/websites', '/topics', '/articles', '/calendar', '/activity', '/delivery-api', '/articles/example-id']) {
    const routed = await fetch(origin + path);
    assert.equal(routed.status, 200);
    assert.match(routed.headers.get('content-type'), /text\/html/);
    assert.match(await routed.text(), /<div id="app">/);
  }
  async function call(path, { method = 'GET', cookie, input, bearer, headers = {} } = {}) {
    const response = await fetch(origin + path, { method, headers: { 'content-type': 'application/json', 'x-autoblog-client': 'admin', ...(cookie ? { cookie } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...headers }, ...(input ? { body: JSON.stringify(input) } : {}) });
    return { response, status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  assert.equal((await call('/api/dashboard')).status, 401);
  assert.equal((await call('/api/auth/register', { method: 'POST', input: { email: 'a@example.com', password: 'long-test-password', name: 'Workspace A' }, headers: { origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await call('/api/auth/login', { method: 'POST', input: { email: 'missing@example.com', password: 'long-test-password' }, headers: { origin: 'http://127.0.0.1' } })).status, 401);
  assert.equal((await call('/api/auth/login', { method: 'POST', input: { email: 'missing@example.com', password: 'long-test-password' }, headers: { origin: 'http://localhost' } })).status, 401);
  const first = await call('/api/auth/register', { method: 'POST', input: { email: 'a@example.com', password: 'long-test-password', name: 'Workspace A' } });
  assert.equal(first.status, 200); assert.ok(first.response.headers.get('set-cookie').includes('HttpOnly'));
  assert.ok(!JSON.stringify(first.body).includes('password'));
  const second = await call('/api/auth/register', { method: 'POST', input: { email: 'b@example.com', password: 'another-test-password', name: 'Workspace B' } });
  const site = (await call('/api/sites', { cookie: first.cookie, method: 'POST', input: website() })).body.site;
  assert.equal((await call(`/api/sites/${site.id}/key`, { cookie: second.cookie, method: 'POST', input: {} })).status, 404);
  const { key } = (await call(`/api/sites/${site.id}/key`, { cookie: first.cookie, method: 'POST', input: {} })).body;
  const topicResponse = await call(`/api/sites/${site.id}/topics`, { cookie: first.cookie, method: 'POST', input: { title: 'A useful test topic?' } });
  assert.equal(topicResponse.status, 201);
  const topic = topicResponse.body.topic;
  assert.equal((await call(`/api/sites/${site.id}/topics`, { cookie: first.cookie, method: 'POST', input: { title: 'A useful test topic!' } })).status, 409);
  assert.equal((await call(`/api/topics/${topic.id}/generate`, { cookie: first.cookie, method: 'POST', input: {} })).status, 503);
  const article = (await call(`/api/topics/${topic.id}/draft`, { cookie: first.cookie, method: 'POST', input: {} })).body.article;
  assert.equal((await call(`/api/articles/${article.id}`, { cookie: second.cookie })).status, 404);
  assert.equal((await call(`/api/v1/sites/${site.id}/articles`, { bearer: key })).body.total, 0);
  const saved = await call(`/api/articles/${article.id}`, { cookie: first.cookie, method: 'PUT', input: { revision: 1, content: validArticle() } });
  assert.equal(saved.body.article.validation.valid, true);
  assert.equal((await call(`/api/articles/${article.id}/approve`, { cookie: first.cookie, method: 'POST', input: { revision: 2, evidenceReviewed: true } })).status, 200);
  const due = new Date(Date.now() + 60000);
  assert.equal((await call(`/api/articles/${article.id}/schedule`, { cookie: first.cookie, method: 'POST', input: { revision: 2, scheduledAt: due.toISOString() } })).status, 200);
  await app.domain.publishDue(due);
  const delivery = await call(`/api/v1/sites/${site.id}/articles`, { bearer: key });
  assert.equal(delivery.body.total, 1); assert.ok(delivery.body.articles[0].html.includes('<article>'));
  assert.equal((await call(`/api/v1/sites/${site.id}/articles/reviewed-publishing-workflow`, { bearer: key })).status, 200);
  assert.equal((await call(`/api/v1/sites/${site.id}/articles?limit=-1`, { bearer: key })).status, 400);
  assert.equal((await call('/api/dashboard', { cookie: second.cookie })).body.articles.length, 0);
  await call(`/api/sites/${site.id}/key`, { cookie: first.cookie, method: 'POST', input: {} });
  assert.equal((await call(`/api/v1/sites/${site.id}/articles`, { bearer: key })).status, 401);
  await call('/api/auth/logout', { cookie: first.cookie, method: 'POST', input: {} });
  assert.equal((await call('/api/dashboard', { cookie: first.cookie })).status, 401);
});
