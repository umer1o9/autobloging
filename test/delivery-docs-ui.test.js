import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const guide = await readFile(new URL('../docs/DELIVERY_API_INTEGRATION.md', import.meta.url), 'utf8');
const openapi = JSON.parse(await readFile(new URL('../docs/DELIVERY_API.openapi.json', import.meta.url), 'utf8'));
async function setup({ empty = false, selected = '' } = {}) {
  const app = { innerHTML: '' }, modal = { open: false, classList: { add() {}, remove() {} } }, events = {}, location = { pathname: '/delivery-api', search: `?site=${selected}`, origin: 'https://studio.example.com' }, clipboard = [], downloads = [], nodes = [];
  const records = { user: { name: 'Docs tester', workspace: 'workspace-docs' }, sites: empty ? [] : [
    { id: 'site-one', name: 'One <script>unsafe</script>', url: 'https://one.example', hasApiKey: true },
    { id: 'site-two', name: 'Second site', url: 'https://two.example', hasApiKey: false }
  ], articles: [{ id: 'article-one', siteId: 'site-one', status: 'published', slug: 'first-published-article' }], jobs: [], topics: [], provider: { ready: false, models: {} } };
  const storage = new Map();
  class TestURL extends URL {
    static createObjectURL(blob) { downloads.push(blob); return 'blob:download'; }
    static revokeObjectURL() {}
  }
  const context = {
    document: { querySelector: name => name === '#app' ? app : modal, addEventListener: (name, handler) => { events[name] = handler; }, createElement: () => { const node = { click() {}, remove() {} }; nodes.push(node); return node; }, body: { appendChild() {} } },
    location, URL: TestURL, URLSearchParams, Blob, Intl, console,
    history: { pushState: (_, unused, url) => { const value = new URL(url, location.origin); location.pathname = value.pathname; location.search = value.search; }, replaceState: (_, unused, url) => { const value = new URL(url, location.origin); location.pathname = value.pathname; location.search = value.search; } },
    navigator: { clipboard: { writeText: async text => clipboard.push(text) } },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    fetch: async path => ({ ok: true, json: async () => path === '/api/delivery-documentation' ? { guide, openapi } : records })
  };
  const api = await runInNewContext(`(async()=>{${source}\nreturn {integration,siteDeliveryDocumentation,site:()=>selectedSite};})()`, context);
  const click = (action, id = '') => events.click({ preventDefault() {}, target: { closest: () => ({ disabled: false, dataset: { action, id } }) } });
  return { app, events, api, clipboard, downloads, nodes, records, location, click };
}

test('Delivery API asks for a website instead of silently using the first', async () => {
  const { app } = await setup();
  assert.match(app.innerHTML, /Documentation for website/);
  assert.match(app.innerHTML, /Choose a website above/);
  assert.ok(!app.innerHTML.includes('studio.example.com/api/v1/sites/site-one'));
});

test('selected website shows separate listing and details and persists dropdown changes', async () => {
  const ui = await setup({ selected: 'site-one' });
  assert.match(ui.app.innerHTML, /1\. Article listing/); assert.match(ui.app.innerHTML, /2\. Article details/);
  assert.match(ui.app.innerHTML, /site-one\/articles\/first-published-article/);
  assert.ok(!ui.app.innerHTML.includes('<script>unsafe</script>'));
  await ui.events.change({ target: { id: 'api-documentation-site', value: 'site-two' } });
  assert.equal(ui.api.site(), 'site-two'); assert.match(ui.location.search, /site=site-two/);
  assert.match(ui.app.innerHTML, /site-two\/articles\/ARTICLE_SLUG/);
  assert.ok(!ui.app.innerHTML.includes('site-one/articles'));
});

test('copy and downloads use the selected site and only secret placeholders', async () => {
  const ui = await setup({ selected: 'site-one' });
  await ui.click('copy-api-snippet', 'listing');
  assert.equal(ui.clipboard[0], 'https://studio.example.com/api/v1/sites/site-one/articles?limit=12&offset=0');
  await ui.click('copy-api-guide');
  assert.match(ui.clipboard[1], /Website ID: site-one/);
  assert.match(ui.clipboard[1], /YOUR_WEBSITE_DELIVERY_KEY/);
  assert.ok(!ui.clipboard[1].includes('YOUR_WEBSITE_ID'));
  await ui.click('download-api-openapi');
  const spec = JSON.parse(await ui.downloads[0].text());
  assert.equal(spec.servers[0].url, 'https://studio.example.com');
  assert.equal(spec.paths['/api/v1/sites/{siteId}/articles'].get.parameters[0].schema.default, 'site-one');
  assert.equal(Object.keys(spec.paths).length, 2);
  await ui.click('download-api-guide');
  assert.match(ui.nodes[1].download, /site-one-guide\.md$/);
  assert.match(await ui.downloads[1].text(), /Website ID: site-one/);
});

test('documentation has a useful setup state when no websites are connected', async () => {
  const { app } = await setup({ empty: true });
  assert.match(app.innerHTML, /Add a website first/);
  assert.ok(!app.innerHTML.includes('YOUR_SITE_ID'));
});
