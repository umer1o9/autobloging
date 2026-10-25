import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './mysql-helper.js';
import { Domain } from '../src/domain.js';
import { createProvider } from '../src/provider.js';
import { website, validArticle } from './helpers.js';

async function setup(t, overrides = {}) {
  const { store } = await testDatabase(t);
  await store.createWorkspace('automation-test', 'Automation');
  let calls = 0;
  const provider = { ready: true, models: { research: 'test', writing: 'test' },
    research: async topic => { calls++; return { memo: 'Test only', sources: validArticle().references,
      selectedTopic: topic.autoDiscover ? { title: 'How can publishing automation save time?', query: 'publishing automation', group: 'Automation', brief: 'A researched guide.' } : null, usage: {} }; },
    write: async () => ({ article: validArticle(), usage: {} }) };
  const domain = new Domain(store, provider), site = await domain.saveSite('automation-test', website(overrides));
  const config = (enabled = true, mode = 'automatic') => domain.configureAutomation('automation-test', site.id, { enabled, mode, themes: ['publishing workflows'] });
  const list = kind => store.list(kind, 'automation-test', site.id);
  return { store, domain, site, config, list, calls: () => calls };
}
test('economy model defaults require key and explicit generation opt-in', () => {
  assert.deepEqual(createProvider({}).models, { research: 'gemini-3.5-flash-lite', writing: 'gemini-3.5-flash-lite', repair: 'gemini-3.8-flash' });
  assert.equal(createProvider({ GEMINI_API_KEY: 'test', ALLOW_PAID_GENERATION: 'true' }).ready, true);
  assert.equal(createProvider({ GEMINI_API_KEY: 'test' }).ready, false);
});
test('automatic flow creates one job under concurrent ticks, paces, publishes and delivers once', async t => {
  const { domain, config, list, site } = await setup(t);
  await config();
  await Promise.all([domain.automate(), domain.automate()]);
  const jobs = await list('job'); assert.equal(jobs.length, 1);
  assert.equal((await list('topic'))[0].autoDiscover, true);
  await domain.runJob('automation-test', jobs[0].id);
  assert.equal((await list('topic'))[0].title, 'How can publishing automation save time?');
  assert.equal((await list('article'))[0].status, 'draft');
  await domain.automate();
  const article = (await list('article'))[0];
  assert.equal(article.status, 'scheduled'); assert.equal(article.approvedRevision, null);
  assert.equal(article.automaticRevision, 1);
  const due = new Date(Date.now() + 10000);
  assert.equal((await domain.publishDue(due)).published, 1);
  assert.equal((await domain.publishDue(due)).published, 0);
  assert.equal((await list('job')).length, 1);
  const { key } = await domain.rotateKey('automation-test', site.id);
  assert.equal((await domain.delivered(site.id, key)).articles.length, 1);
});
test('hands-off discovery needs no themes and prepares safe internal links', async t => {
  const { domain, site, list } = await setup(t, { approvedLinks: [] });
  await domain.configureAutomation('automation-test', site.id, { enabled: true, mode: 'automatic', themes: [] });
  await domain.automate();
  const [job] = await list('job'), [topic] = await list('topic');
  assert.ok(job); assert.equal(topic.autoDiscover, true); assert.deepEqual(topic.themes, []);
  const prepared = await domain.need('site', 'automation-test', site.id);
  assert.equal(prepared.approvedLinks.length, 3);
  assert.ok(prepared.approvedLinks.some(link => link.service));
});
test('manual run bypasses cadence but keeps normal admission safeguards', async t => {
  const { domain, config, list } = await setup(t);
  await config(); await domain.automate();
  const first = (await list('job'))[0]; await domain.runJob('automation-test', first.id); await domain.automate();
  assert.ok(new Date((await domain.need('site', 'automation-test', first.siteId)).automation.nextRunAt) > new Date());
  await domain.runAutomationNow('automation-test', first.siteId);
  assert.equal((await list('job')).length, 2);
  await domain.runAutomationNow('automation-test', first.siteId);
  assert.equal((await list('job')).length, 2);
});
test('manual run acknowledges inspected failures and queues a fresh article', async t => {
  const { domain, config, list, store, site } = await setup(t);
  await config(); await domain.automate();
  const [failed] = await list('job');
  await store.put('job', 'automation-test', site.id, { ...failed, status: 'failed', stage: 'research failed', error: 'Too few sources.' });
  const [topic] = await list('topic'); await store.put('topic', 'automation-test', site.id, { ...topic, status: 'failed' });
  await domain.runAutomationNow('automation-test', site.id);
  const jobs = await list('job'), updatedSite = await domain.need('site', 'automation-test', site.id);
  assert.equal(jobs.length, 2); assert.ok(updatedSite.automation.acknowledgedFailures.includes(failed.id));
  assert.equal(jobs.filter(job => job.status === 'queued').length, 1);
});
test('pause blocks queued paid calls and automatic publication until resume', async t => {
  const { domain, config, list, calls } = await setup(t);
  await config(); await domain.automate();
  const job = (await list('job'))[0];
  await config(false); await domain.runJob('automation-test', job.id);
  assert.equal(calls(), 0); assert.equal((await list('job'))[0].status, 'queued');
  await config(); await domain.runJob('automation-test', job.id); await domain.automate();
  await config(false);
  assert.equal((await domain.publishDue(new Date(Date.now() + 10000))).published, 0);
  await config(); assert.equal((await domain.publishDue(new Date(Date.now() + 10000))).published, 1);
});
test('review mode requires approval; manual drafts never gain automatic approval', async t => {
  const { domain, config, list, site } = await setup(t);
  await config(true, 'review'); await domain.automate();
  await domain.runJob('automation-test', (await list('job'))[0].id); await domain.automate();
  let article = (await list('article'))[0]; assert.equal(article.status, 'draft');
  await domain.transition('automation-test', article.id, 'approve', { revision: 1, evidenceReviewed: true }, 'editor');
  await domain.automate(); assert.equal((await list('article'))[0].status, 'scheduled');
  const topic = await domain.createTopic('automation-test', site.id, { title: 'Manual article stays private' });
  article = await domain.createDraft('automation-test', topic.id);
  await domain.saveArticle('automation-test', article.id, { revision: 1, content: validArticle({ slug: 'manual-private' }) });
  await config(); await domain.automate();
  assert.equal((await domain.articleDetail('automation-test', article.id)).status, 'draft');
});
test('missing key, budget exhaustion, failed jobs and theme exhaustion do not trigger paid loops', async t => {
  const { domain, config, list, store, site } = await setup(t, { monthlyBudget: 0, jobBudget: 0 });
  await config(); domain.provider.ready = false; await domain.automate();
  assert.equal((await list('topic')).length, 0);
  domain.provider.ready = true; await domain.automate(); await domain.automate();
  assert.equal((await list('job')).length, 0); assert.equal((await list('topic')).length, 1);
  await domain.saveSite('automation-test', website(), site.id);
  domain.provider.research = async () => { throw Object.assign(new Error('Mock failure'), { safe: true, retryable: false }); };
  await domain.automate(); const failedJob = (await list('job'))[0];
  await domain.runJob('automation-test', failedJob.id);
  await domain.runJob('automation-test', failedJob.id);
  await domain.runJob('automation-test', failedJob.id);
  await domain.automate(); await domain.automate();
  assert.equal((await list('job')).length, 1);
  assert.equal((await list('job'))[0].attempts, 1);
  assert.match((await store.get('site', 'automation-test', site.id)).automation.message, /job failed/);
  await assert.rejects(() => domain.configureAutomation('other', site.id, { enabled: true, mode: 'automatic', themes: [] }), /Not found/);
});
test('transient provider failures use bounded backoff and stop after three attempts', async t => {
  const { domain, config, list, store } = await setup(t);
  domain.provider.research = async () => { throw Object.assign(new Error('Provider returned HTTP 429.'), { safe: true, retryable: true }); };
  await config(); await domain.automate(); const job = (await list('job'))[0];
  await domain.runJob('automation-test', job.id);
  let waiting = (await list('job'))[0];
  assert.equal(waiting.status, 'queued'); assert.match(waiting.stage, /waiting to retry/);
  assert.equal(waiting.attempts, 1); assert.ok(new Date(waiting.retryAt) > new Date());
  assert.equal((await store.queuedJobs(2)).length, 0);
  waiting.retryAt = new Date(0).toISOString(); await store.put('job', 'automation-test', waiting.siteId, waiting);
  await domain.runJob('automation-test', job.id);
  waiting = (await list('job'))[0]; waiting.retryAt = new Date(0).toISOString(); await store.put('job', 'automation-test', waiting.siteId, waiting);
  await domain.runJob('automation-test', job.id);
  const failed = (await list('job'))[0];
  assert.equal(failed.status, 'failed'); assert.equal(failed.attempts, 3); assert.match(failed.stage, /failed/);
  assert.equal(failed.retryAt, null);
});
test('paused automated jobs do not occupy worker selection slots', async t => {
  const { domain, config, list, store } = await setup(t);
  await config(); await domain.automate();
  assert.equal((await store.queuedJobs(2)).length, 1);
  await config(false);
  assert.equal((await store.queuedJobs(2)).length, 0);
  assert.equal((await list('job'))[0].status, 'queued');
});
