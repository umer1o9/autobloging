import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { website } from './helpers.js';

test('automation landing view renders setup, safely escapes site names, and opens mode controls', async () => {
  const site = { ...website(), id: 'site-test', name: '<script>test</script>', monthlyBudgetCents: 2500, automation: { enabled: true, mode: 'automatic', themes: [] } };
  const app = { innerHTML: '' }, modal = { open: false, showModal() { this.open = true; } };
  const document = { querySelector: s => s === '#app' ? app : modal, addEventListener() {} };
  const script = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  await runInNewContext(`(async () => { ${script}\nautomationDialog('site-test'); selectedSite = 'site-test'; document.websitesHtml = websites(); document.activityHtml = jobsPage(); })()`, {
    document, fetch: async () => ({ ok: true, json: async () => ({ user: { name: 'Test', email: 'test@example.com' }, sites: [site], articles: [], topics: [{ id: 'topic-test', siteId: site.id, title: 'A dated activity' }], jobs: [{ id: 'job-test', siteId: site.id, topicId: 'topic-test', stage: 'review', status: 'completed', createdAt: '2026-10-22T10:00:00.000Z', completedAt: '2026-10-22T12:44:00.000Z', reservedCents: 100 }], provider: { ready: false, models: {} } }) }),
    setInterval: () => 1, clearInterval() {}, Intl, console
  });
  assert.match(app.innerHTML, /Automatic publishing/);
  assert.match(app.innerHTML, /Inspect website/);
  assert.match(app.innerHTML, /One-time setup/);
  assert.ok(!app.innerHTML.includes('<script>test</script>'));
  assert.match(modal.innerHTML, /Fully automatic — no human input/);
  assert.match(modal.innerHTML, /Save &amp; start hands-off flow|Save & start hands-off flow/);
  assert.match(app.innerHTML, /Run now/);
  assert.match(app.innerHTML, /Connected websites/);
  assert.match(app.innerHTML, /Content pipeline/);
  assert.match(app.innerHTML, /Website production/);
  assert.match(document.websitesHtml, /Generate article now/);
  assert.match(document.websitesHtml, /Starts one article immediately/);
  assert.match(document.activityHtml, /Date &amp; time/);
  assert.match(document.activityHtml, /Oct 22, 2026/);
  assert.match(document.activityHtml, /Finished 5:44 PM · Asia\/Karachi/);
  assert.equal(modal.open, true);
});

test('article library can open a dedicated full-page reader', async () => {
  const site = { ...website(), id: 'site-test', monthlyBudgetCents: 2500 };
  const article = {
    id: 'article-test', siteId: site.id, status: 'published', revision: 1, publishedAt: '2026-10-22T12:00:00.000Z',
    content: { title: 'A complete article', excerpt: 'A useful introduction.', author: 'Editorial team' },
    html: '<article><h1>A complete article</h1><p class="byline">By Editorial team</p><p>Full article body.</p></article>',
    research: { sources: [{ title: 'Reliable source', url: 'https://example.org/source' }] }
  };
  const app = { innerHTML: '' }, modal = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const document = { querySelector: selector => selector === '#app' ? app : modal, addEventListener() {} };
  const script = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  await runInNewContext(`(async () => { ${script}\nawait openFullArticle('article-test'); })()`, {
    document,
    fetch: async path => ({ ok: true, json: async () => String(path).includes('/api/articles/') ? { article } : {
      user: { name: 'Test', email: 'test@example.com' }, sites: [site],
      articles: [{ id: article.id, siteId: site.id, title: article.content.title, status: article.status, revision: 1 }],
      topics: [], jobs: [], provider: { ready: true, models: { research: 'r', writing: 'w', repair: 'x' } }
    } }),
    setInterval: () => 1, clearInterval() {}, Intl, Date, console
  });
  assert.match(app.innerHTML, /Workspace &nbsp; \/ &nbsp; Full article/);
  assert.match(app.innerHTML, /reader-page/);
  assert.match(app.innerHTML, /A complete article/);
  assert.match(app.innerHTML, /Full article body/);
  assert.match(app.innerHTML, /Research sources/);
  assert.match(app.innerHTML, /← Back/);
  assert.match(app.innerHTML, /Copy article/);
  assert.match(app.innerHTML, /Download Word/);
});

test('unpublish works from library and reader without a review dialog', async () => {
  const script = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  for (const reader of [false, true]) {
    const site = { ...website(), id: 'site-test' };
    const article = { id: 'article-test', siteId: site.id, title: 'A published article', status: 'published', revision: 7, content: { title: 'A published article', author: 'Editor', excerpt: '' }, html: '<p>Article body</p>' };
    const app = { innerHTML: '' }, events = {}, calls = [];
    const modal = { open: false, classList: { add() {}, remove() {} } };
    const document = { querySelector: selector => selector === '#app' ? app : modal, addEventListener: (event, callback) => { events[event] = callback; } };
    await runInNewContext(`(async () => { ${script}\npage = 'review'; render(); document.libraryHtml = app.innerHTML; ${reader ? "await openFullArticle('article-test');" : ''} document.before = app.innerHTML; await document.clickUnpublish(); })()`, {
      document: Object.assign(document, { clickUnpublish: () => events.click({ preventDefault() {}, target: { closest: () => ({ dataset: { action: 'unpublish', id: article.id }, disabled: false }) } }) }),
      fetch: async (path, options = {}) => {
        if (path.endsWith('/unpublish')) { calls.push(JSON.parse(options.body)); article.status = 'draft'; }
        return { ok: true, json: async () => path.startsWith('/api/articles/') ? { article } : { user: { name: 'Test', email: 'test@example.com' }, sites: [site], articles: [article], topics: [], jobs: [], provider: { ready: false, models: {} } } };
      },
      setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, Intl, Date, console
    });
    assert.match(document.libraryHtml, /data-action="unpublish"/);
    assert.match(document.before, /data-action="unpublish"/);
    assert.deepEqual(calls, [{ revision: 7 }]);
    assert.doesNotMatch(app.innerHTML, /data-action="unpublish"/);
    assert.match(app.innerHTML, /draft/i);
    assert.equal(modal.open, false);
  }
});
