import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const script = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
function fixtures() {
  return {
    user: { workspace: 'workspace-one', name: 'Calendar test', email: 'test@example.com' },
    sites: [{ id: 's1', name: 'SnapKodex', url: 'https://example.com', timezone: 'Asia/Karachi', monthlyVolume: 30, monthlyBudgetCents: 1000, reviewCapacity: 5, automation: { enabled: true } }, { id: 's2', name: 'Second website', timezone: 'America/Los_Angeles' }],
    articles: [
      { id: 'a1', topicId: 't1', siteId: 's1', title: 'Published <script>alert(1)</script>', status: 'published', createdAt: '2026-10-01T00:00:00Z', publishedAt: '2026-10-24T21:00:00Z' },
      { id: 'a2', topicId: 't2', siteId: 's1', title: 'Scheduled article', status: 'scheduled', createdAt: '2026-10-01T00:00:00Z', scheduledAt: '2026-10-25T22:00:00Z' },
      { id: 'a3', topicId: 't3', siteId: 's2', title: 'A draft', status: 'draft', createdAt: '2026-10-25T12:00:00Z' }
    ],
    topics: [{ id: 'tj', title: 'Researching the next topic' }],
    jobs: [{ id: 'j1', topicId: 't1', siteId: 's1', status: 'failed', createdAt: '2026-10-24T21:00:00Z' }, { id: 'j2', topicId: 'tj', siteId: 's1', status: 'running', stage: 'research', createdAt: '2026-10-25T00:00:00Z' }],
    provider: { ready: false, models: {} }
  };
}
async function harness({ records = fixtures(), url = '/websites?site=s1&month=2026-10', storage = new Map() } = {}) {
  const app = { innerHTML: '' }, modal = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const events = {}, location = {};
  function setUrl(value) { const parsed = new URL(value, 'http://localhost:3210'); Object.assign(location, { pathname: parsed.pathname, search: parsed.search, origin: parsed.origin }); }
  setUrl(url);
  const context = {
    document: { querySelector: s => s === '#app' ? app : modal, addEventListener: (name, handler) => { events[name] = handler; } },
    location, history: { pushState: (_, unused, value) => setUrl(value), replaceState: (_, unused, value) => setUrl(value) },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    URLSearchParams, Intl, Date, console, setInterval: () => 1, clearInterval() {},
    fetch: async path => ({ ok: true, json: async () => {
      if (path === '/api/dashboard') return records;
      if (path.startsWith('/api/jobs/')) return { job: records.jobs.find(j => path.endsWith(j.id)) };
      const article = records.articles.find(a => path.endsWith(a.id));
      return { article: { ...article, content: { title: article.title }, html: '<article>Full article body</article>' } };
    } })
  };
  const api = await runInNewContext(`(async () => { ${script}\nreturn { entries: calendarEntries, cells: monthCells, dateKey, validDate, restoreRoute, refresh, openFullArticle, navigatePage, selectWebsite, websites, calendar, render, setDate: (day) => { calendarDate = day; calendarMonth = day.slice(0,7); syncViewUrl(); }, expand: day => { expandedDays.add(day); syncViewUrl(); }, state: () => ({site:selectedSite,month:calendarMonth,date:calendarDate,expanded:[...expandedDays],returnPage:articleReturnPage,page}), changeWorkspace: user => {data.user=user; readViewState(false);} }; })()`, context);
  return { api, app, modal, events, location, setUrl, records, storage };
}

test('date grouping uses publication/schedule/creation and selected website timezone', async () => {
  const { api } = await harness();
  const entries = api.entries();
  assert.equal(entries.find(e => e.id === 'a1').day, '2026-10-25');
  assert.equal(entries.find(e => e.id === 'a2').day, '2026-10-26');
  assert.ok(!entries.some(e => e.id === 'a3'));
  assert.ok(!entries.some(e => e.id === 'j1'));
  assert.equal(entries.find(e => e.id === 'j2').stage, 'research');
  assert.equal(api.dateKey('2026-10-25T00:00:00Z', 'America/Los_Angeles'), '2026-10-24');
});

test('grid starts Monday, includes leap day and handles year boundaries', async () => {
  const { api } = await harness();
  assert.equal(api.cells('2024-02')[0], '2024-01-29');
  assert.ok(api.cells('2024-02').includes('2024-02-29'));
  assert.equal(api.cells('2026-12').at(-1), '2027-01-03');
  assert.equal(api.cells('2021-02').length, 28);
  assert.equal(api.validDate('2026-02-30'), false);
});

test('website summary, status labels, escaped titles and counts render in shared box calendar', async () => {
  const { api, app } = await harness();
  assert.match(app.innerHTML, /month-grid/);
  assert.match(app.innerHTML, /Published &lt;script&gt;/);
  assert.ok(!app.innerHTML.includes('<script>alert'));
  assert.match(app.innerHTML, /1 article · 1 job/);
  assert.match(app.innerHTML, /data-action="view-article" data-id="a1"/);
  assert.match(app.innerHTML, /data-action="job" data-id="j2"/);
  assert.match(app.innerHTML, /Generate article now/);
  assert.match(api.calendar(), /month-grid/);
  api.selectWebsite('');
  assert.match(app.innerHTML, /All connected websites/);
  assert.match(app.innerHTML, /Manage a website/);
  assert.match(app.innerHTML, /calendar-entry-site/);
});

test('four-entry limit expands and persisted expansion restores after reload', async () => {
  const records = fixtures();
  records.articles = Array.from({ length: 6 }, (_, i) => ({ id: `a${i}`, topicId: `t${i}`, siteId: 's1', title: `Article ${i}`, status: 'draft', createdAt: '2026-10-25T12:00:00Z' })); records.jobs = [];
  const first = await harness({ records });
  assert.match(first.app.innerHTML, /Show 2 more/);
  assert.equal((first.app.innerHTML.match(/class="calendar-entry /g) || []).length, 4);
  first.api.expand('2026-10-25'); first.api.render();
  assert.equal((first.app.innerHTML.match(/class="calendar-entry /g) || []).length, 6);
  const second = await harness({ records, url: first.location.pathname + first.location.search, storage: first.storage });
  assert.equal((second.app.innerHTML.match(/class="calendar-entry /g) || []).length, 6);
});

test('article reader reload and Back retain website, month, date and origin', async () => {
  const first = await harness(); first.api.setDate('2026-10-25'); first.api.expand('2026-10-25');
  await first.api.openFullArticle('a1');
  assert.match(first.app.innerHTML, /Full article body/);
  assert.match(first.location.search, /return=websites/);
  const second = await harness({ url: first.location.pathname + first.location.search, storage: first.storage });
  assert.equal(second.api.state().returnPage, 'websites');
  second.api.navigatePage(second.api.state().returnPage);
  assert.equal(second.api.state().site, 's1'); assert.equal(second.api.state().date, '2026-10-25');
  assert.match(second.location.search, /expanded=2026-10-25/);
  assert.match(second.app.innerHTML, /month-grid/);
});

test('URL overrides saved state, workspace storage is isolated and deleted sites reset', async () => {
  const first = await harness(); first.api.setDate('2026-10-25');
  const saved = await harness({ url: '/calendar', storage: first.storage });
  assert.equal(saved.api.state().site, 's1'); assert.equal(saved.api.state().date, '2026-10-25');
  const urlWins = await harness({ url: '/calendar?site=s2&month=2026-11', storage: first.storage });
  assert.equal(urlWins.api.state().site, 's2'); assert.equal(urlWins.api.state().month, '2026-11');
  urlWins.api.changeWorkspace({ workspace: 'workspace-two' });
  assert.equal(urlWins.api.state().site, '');
  const invalid = await harness({ url: '/websites?site=deleted&month=not-a-month&date=2026-02-30' });
  assert.equal(invalid.api.state().site, ''); assert.equal(invalid.api.state().date, '');
});

test('refresh preserves filters and route restoration responds to browser history', async () => {
  const { api, setUrl } = await harness(); api.setDate('2026-10-25'); await api.refresh();
  assert.equal(api.state().date, '2026-10-25');
  setUrl('/calendar?site=s2&month=2027-01&date=2027-01-02'); await api.restoreRoute();
  assert.equal(api.state().page, 'calendar'); assert.equal(api.state().site, 's2'); assert.equal(api.state().date, '2027-01-02');
});

test('empty months still render a box calendar and next/previous controls change year', async () => {
  const { api, app, events } = await harness({ url: '/calendar?site=s1&month=2026-12' });
  assert.match(app.innerHTML, /No articles or generation jobs this month/);
  const click = action => events.click({ target: { closest: () => ({ dataset: { action }, disabled: false }) }, preventDefault() {} });
  await click('calendar-next'); assert.equal(api.state().month, '2027-01');
  await click('calendar-prev'); assert.equal(api.state().month, '2026-12');
  await click('calendar-today'); assert.ok(api.validDate(api.state().date));
});

test('all article statuses, missing date fallbacks and job detail clicks work', async () => {
  const records = fixtures();
  records.articles = ['published','scheduled','draft','approved','rejected','review'].map((status,i) => ({ id: `status-${i}`, topicId: `status-topic-${i}`, siteId: 's1', title: `${status} title`, status, createdAt: '2026-10-25T12:00:00Z' }));
  records.jobs = [{ id: 'job-only', siteId: 's1', topicId: 'tj', status: 'failed', stage: 'research failed', createdAt: '2026-10-26T12:00:00Z' }];
  const { api, events, modal, app } = await harness({ records });
  assert.ok(api.entries().filter(e => e.kind === 'article').every(e => e.day === '2026-10-25'));
  api.expand('2026-10-25'); api.render();
  for (const status of ['published','scheduled','draft','approved','rejected','review']) assert.ok(app.innerHTML.includes(`calendar-entry status-${status}`));
  await events.click({ target: { closest: () => ({ dataset: { action: 'job', id: 'job-only' }, disabled: false }) }, preventDefault() {} });
  assert.equal(modal.open, true); assert.match(modal.innerHTML, /Generation details/); assert.match(modal.innerHTML, /research failed/);
});

test('corrupt saved state does not break calendar startup', async () => {
  const { api } = await harness({ url: '/calendar', storage: new Map([['autoblog:calendar:v1:workspace-one', 'null']]) });
  assert.equal(api.state().site, ''); assert.match(api.state().month, /^\d{4}-\d{2}$/);
});
