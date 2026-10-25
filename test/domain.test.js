import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './mysql-helper.js';
import { Domain } from '../src/domain.js';
import { normalizeArticle, validateArticle, renderArticle } from '../src/content.js';
import { website, validArticle } from './helpers.js';

async function setup(t, provider) { const { store } = await testDatabase(t); await store.createWorkspace('workspace-a', 'Test workspace'); const domain = new Domain(store, provider); const site = await domain.saveSite('workspace-a', website()); return { store, domain, site }; }
async function draft(domain, site) { const topic = await domain.createTopic('workspace-a', site.id, { title: 'A workflow question?', priority: 2 }); return domain.createDraft('workspace-a', topic.id); }

test('content contract accepts a complete fixture and blocks missing evidence / unsafe links', () => {
  const content = normalizeArticle(validArticle({ coverImage: { url: 'https://example.org/cover.jpg', alt: 'Safe cover', prompt: 'Cover prompt' } }));
  assert.deepEqual(validateArticle(content, website()).errors, []);
  const completeHtml = renderArticle(content);
  assert.match(completeHtml, /class="article-image cover-image"/); assert.match(completeHtml, /class="article-toc"/); assert.match(completeHtml, /class="visual-summary"/);
  assert.match(completeHtml, /class="article-subsection"/); assert.match(completeHtml, /class="author-profile"/); assert.match(completeHtml, /class="article-cta"/);
  content.sections[0].image = { url: 'javascript:alert(1)', alt: 'Unsafe' }; assert.ok(!renderArticle(content).includes('javascript:'));
  content.references = []; assert.equal(validateArticle(content, website()).valid, false);
  content.title = '<script>alert(1)</script>'; content.internalLinks = [{ title: '<img>', url: 'javascript:alert(1)' }];
  const html = renderArticle(content); assert.ok(!html.includes('<script>')); assert.ok(!html.includes('href="javascript:')); assert.ok(html.includes('&lt;script&gt;'));
});
test('image prompts use the website visual system and choose explanatory sections', async () => {
  let request;
  const imageProvider = { ready: () => true, generate: async input => { request = input; return { url: 'https://example.com/generated.webp', usage: {} }; } };
  const domain = new Domain({}, {}, imageProvider), content = normalizeArticle(validArticle());
  content.coverImage.alt = 'Purpose-written cover description'; content.coverImage.caption = 'Editorial caption';
  content.sections[0].heading = 'Background and context'; content.sections[0].image.prompt = 'Generic illustration';
  content.sections[1].heading = 'How does the workflow operate?'; content.sections[1].image.prompt = 'A five-stage process diagram';
  const site = website({ imageGeneration: { provider: 'gemini', model: 'test-image', quality: 'high', style: 'Ink-and-paper diagrams with a forest green accent.' } });
  const generated = await domain.createImage(content, site, 'cover', 0);
  assert.match(request.prompt, /Ink-and-paper diagrams/); assert.match(request.prompt, /small blog thumbnail/); assert.match(request.prompt, /generic robot heads/);
  assert.equal(generated.image.alt, 'Purpose-written cover description'); assert.equal(generated.image.caption, 'Editorial caption');
  assert.deepEqual(domain.imageSectionIndexes(content, 1), [1]);
});
test('workspace isolation and website-specific delivery keys protect drafts and other sites', async t => {
  const { domain, site } = (await setup(t)); const article = (await draft(domain, site));
  await assert.rejects(async () => (await domain.articleDetail('workspace-b', article.id)), /Not found/);
  await assert.rejects(async () => (await domain.rotateKey('workspace-b', site.id)), /Not found/);
  const { key } = (await domain.rotateKey('workspace-a', site.id));
  assert.deepEqual((await domain.delivered(site.id, key)).articles, []);
  await assert.rejects(async () => (await domain.delivered(site.id, key, article.content.slug)), /not found/);
  const other = (await domain.saveSite('workspace-a', website({ name: 'Other site' })));
  await assert.rejects(async () => (await domain.delivered(other.id, key)), /Valid website/);
  (await domain.rotateKey('workspace-a', site.id)); await assert.rejects(async () => (await domain.delivered(site.id, key)), /Valid website/);
});
test('approval binds to revision, rejects stale edits, and requires explicit evidence review', async t => {
  const { domain, site } = (await setup(t)); let article = (await draft(domain, site));
  article = (await domain.saveArticle('workspace-a', article.id, { revision: 1, content: validArticle() }));
  await assert.rejects(async () => (await domain.transition('workspace-a', article.id, 'approve', { revision: 2 }, 'editor')), /Confirm/);
  (await domain.transition('workspace-a', article.id, 'approve', { revision: 2, evidenceReviewed: true }, 'editor'));
  await assert.rejects(async () => (await domain.saveArticle('workspace-a', article.id, { revision: 1, content: validArticle() })), /changed/);
  article = (await domain.saveArticle('workspace-a', article.id, { revision: 2, content: validArticle({ author: 'Another author' }) }));
  assert.equal(article.status, 'draft'); assert.equal(article.approvedRevision, null);
  await assert.rejects(async () => (await domain.transition('workspace-a', article.id, 'schedule', { revision: 3, scheduledAt: new Date(Date.now() + 10000).toISOString() }, 'editor')), /Approve/);
});
test('due publisher respects pause, future times, validation, and publishes exactly once', async t => {
  const { domain, site } = (await setup(t)); let article = (await draft(domain, site));
  article = (await domain.saveArticle('workspace-a', article.id, { revision: 1, content: validArticle() }));
  (await domain.transition('workspace-a', article.id, 'approve', { revision: 2, evidenceReviewed: true }, 'editor'));
  const due = new Date(Date.now() + 3600000);
  (await domain.transition('workspace-a', article.id, 'schedule', { revision: 2, scheduledAt: due.toISOString() }, 'editor'));
  assert.equal((await domain.publishDue()).published, 0);
  (await domain.saveSite('workspace-a', website({ publicationPaused: true }), site.id));
  assert.equal((await domain.publishDue(due)).published, 0);
  (await domain.saveSite('workspace-a', website(), site.id));
  assert.equal((await domain.publishDue(due)).published, 1); assert.equal((await domain.publishDue(due)).published, 0);
  const { key } = (await domain.rotateKey('workspace-a', site.id));
  const output = (await domain.delivered(site.id, key, article.content.slug));
  assert.equal(output.title, article.content.title); assert.ok(!('evidence' in output.references[0])); assert.ok(!('research' in output));
  (await domain.transition('workspace-a', article.id, 'unpublish', { revision: 2 }, 'editor'));
  assert.equal((await domain.delivered(site.id, key)).articles.length, 0);
});
test('budget reservations are atomic, retained on failures, and do not count missing usage as zero', async t => {
  const provider = { ready: true, models: { research: 'test', writing: 'test' } };
  const { domain, site } = (await setup(t, provider));
  (await domain.saveSite('workspace-a', website({ monthlyBudget: 1, jobBudget: 1 }), site.id));
  const a = (await domain.createTopic('workspace-a', site.id, { title: 'First topic' }));
  const b = (await domain.createTopic('workspace-a', site.id, { title: 'Second topic' }));
  const job = (await domain.startGeneration('workspace-a', a.id));
  assert.equal(job.costStatus, 'unreconciled'); assert.equal((await domain.reserved('workspace-a', site.id)), 100);
  await assert.rejects(async () => (await domain.startGeneration('workspace-a', b.id)), /budget/);
  await assert.rejects(async () => (await domain.startGeneration('workspace-a', a.id)), /active job/);
});
test('generation checkpoints research, inserts one private draft, and cannot be replayed', async t => {
  let researchCalls = 0, writerCalls = 0;
  const provider = { ready: true, models: { research: 'test', writing: 'test' },
    research: async () => { researchCalls++; return { memo: 'Synthetic test research', sources: validArticle().references, usage: { usageUnavailable: true } }; },
    write: async () => { writerCalls++; return { article: validArticle(), usage: { usageUnavailable: true } }; }
  };
  const { domain, site, store } = (await setup(t, provider));
  const topic = (await domain.createTopic('workspace-a', site.id, { title: 'Research test topic' }));
  const job = (await domain.startGeneration('workspace-a', topic.id));
  await Promise.all([domain.runJob('workspace-a', job.id), domain.runJob('workspace-a', job.id)]);
  await domain.runJob('workspace-a', job.id);
  assert.equal(researchCalls, 1); assert.equal(writerCalls, 1);
  const articles = (await store.list('article', 'workspace-a', site.id));
  assert.equal(articles.length, 1); assert.equal(articles[0].status, 'draft'); assert.equal(articles[0].approvedRevision, null);
});
test('failed writing retry reuses research and keeps separate paid-job reservations', async t => {
  let researchCalls = 0, fail = true;
  const provider = { ready: true, models: { research: 'test', writing: 'test' },
    research: async () => { researchCalls++; return { memo: 'Test memo', sources: validArticle().references, usage: {} }; },
    write: async () => { if (fail) throw new Error('private provider detail'); return { article: validArticle(), usage: {} }; }
  };
  const { domain, site, store } = (await setup(t, provider)); const topic = (await domain.createTopic('workspace-a', site.id, { title: 'Retry test topic' }));
  const first = (await domain.startGeneration('workspace-a', topic.id)); await domain.runJob('workspace-a', first.id);
  assert.equal((await store.get('job', 'workspace-a', first.id)).status, 'failed');
  assert.ok(!(await store.get('job', 'workspace-a', first.id)).error.includes('private'));
  fail = false; const next = (await domain.startGeneration('workspace-a', topic.id)); await domain.runJob('workspace-a', next.id);
  assert.equal(researchCalls, 1); assert.equal((await store.list('article', 'workspace-a', site.id)).length, 1);
  assert.equal((await domain.reserved('workspace-a', site.id)), 200);
});
test('no-source research blocks writing and preserves failure', async t => {
  let wrote = false;
  const { domain, site, store } = (await setup(t, { ready: true, models: {}, research: async () => ({ memo: 'No sources', sources: [], usage: {} }), write: async () => { wrote = true; } }));
  const topic = (await domain.createTopic('workspace-a', site.id, { title: 'Sparse evidence topic' }));
  const job = (await domain.startGeneration('workspace-a', topic.id)); await domain.runJob('workspace-a', job.id);
  assert.equal(wrote, false); assert.equal((await store.get('job', 'workspace-a', job.id)).status, 'failed'); assert.equal((await store.list('article', 'workspace-a', site.id)).length, 0);
});
