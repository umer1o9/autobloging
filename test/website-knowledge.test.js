import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './mysql-helper.js';
import { Domain } from '../src/domain.js';
import { website, validArticle } from './helpers.js';
import { parsePage } from '../src/website-index.js';

const response = (url, body, status = 200, type = 'text/html') => ({ url, status, type, headers: {}, body: Buffer.from(body) });
function fetcher(pages, calls = []) {
  return async (url, _origin, { allowed = () => true } = {}) => {
    assert.equal(allowed(url), true);
    calls.push(url);
    if (url.endsWith('/robots.txt')) return response(url, 'User-agent: *\nDisallow: /blocked\nSitemap: https://example.com/sitemap.xml',200,'text/plain');
    if (url.endsWith('/sitemap.xml')) return response(url, '<urlset><url><loc>https://example.com/services</loc></url></urlset>',200,'application/xml');
    return response(url, pages.get(url) || '', pages.has(url) ? 200 : 404);
  };
}
const page = (name, links = '') => `<title>${name}</title><main><h1>${name}</h1><p>${(`${name} software integrations service details and target customers. `).repeat(10)}</p>${links}</main>`;

test('sync queues durably, respects robots, exports Markdown, isolates tenants, and retains last index during resync', async t => {
  const { store } = await testDatabase(t);
  await store.createWorkspace('workspace-a','A'); await store.createWorkspace('workspace-b','B');
  const domain = new Domain(store, { ready: false });
  const site = await domain.saveSite('workspace-a',website());
  const first = await store.getKnowledge('workspace-a',site.id);
  assert.equal(first.status,'queued');
  assert.equal((await domain.queueWebsiteSync('workspace-a',site.id)).runId,first.runId);
  await assert.rejects(domain.queueWebsiteSync('workspace-b',site.id),error => error.status===404);
  assert.deepEqual((await domain.knowledge.view('workspace-b',site.id)).pages,[]);
  const calls = [], pages = new Map([
    ['https://example.com/', page('Home','<a href="/about">About</a><a href="/blocked">Blocked</a><a href="https://other.com/">External</a>')],
    ['https://example.com/about',page('About')], ['https://example.com/services',page('Services')]
  ]);
  store.workerActive=true;
  domain.knowledge.fetch=fetcher(pages,calls); domain.knowledge.wait=async()=>{};
  await domain.syncWebsites(()=>{});
  const completed = await domain.knowledge.view('workspace-a',site.id);
  assert.equal(completed.knowledge.status,'partial');
  assert.equal(completed.knowledge.indexedPages,3);
  assert.ok(!calls.some(url=>url.includes('/blocked') || url.includes('other.com')));
  assert.match(await domain.knowledge.document('workspace-a',site.id,'https://example.com/services'),/# Services/);
  assert.equal((await domain.knowledge.context('workspace-a',site.id,'software services')).passages[0].url,'https://example.com/services');
  await domain.queueWebsiteSync('workspace-a',site.id);
  assert.equal((await domain.knowledge.view('workspace-a',site.id)).pages.length,3);
  pages.delete('https://example.com/about'); pages.set('https://example.com/',page('Updated home'));
  await domain.syncWebsites(()=>{});
  assert.equal((await domain.knowledge.view('workspace-a',site.id)).pages.length,2);
  await assert.rejects(domain.knowledge.document('workspace-a',site.id,'https://example.com/about'),error=>error.status===404);
  const previousRun=(await store.getKnowledge('workspace-a',site.id)).activeRunId;
  await domain.queueWebsiteSync('workspace-a',site.id);
  domain.knowledge.fetch=async()=>{throw new Error('Website unavailable');};
  await domain.syncWebsites(()=>{});
  const failed=await store.getKnowledge('workspace-a',site.id);
  assert.equal(failed.status,'failed'); assert.equal(failed.activeRunId,previousRun);
  assert.equal((await domain.knowledge.view('workspace-a',site.id)).pages.length,2);
  assert.equal(await domain.reserved('workspace-a',site.id),0);
});

test('crawl persists between batches and a superseded run cannot overwrite the new URL', async t => {
  const { store } = await testDatabase(t); await store.createWorkspace('workspace-a','A');
  const domain=new Domain(store,{ready:false}); const site=await domain.saveSite('workspace-a',website());
  const pages=new Map([['https://example.com/',page('Home',Array.from({length:14},(_,i)=>`<a href="/page-${i}">Page ${i}</a>`).join(''))],['https://example.com/services',page('Services')],...Array.from({length:14},(_,i)=>[`https://example.com/page-${i}`,page(`Page ${i}`)])]);
  store.workerActive=true;domain.knowledge.fetch=fetcher(pages);domain.knowledge.wait=async()=>{};
  await domain.syncWebsites(()=>{});
  const running=await store.getKnowledge('workspace-a',site.id);
  assert.equal(running.status,'running');assert.equal(running.pageCount,10);
  assert.equal((await domain.knowledge.view('workspace-a',site.id)).pages.length,0);
  await domain.syncWebsites(()=>{});
  assert.equal((await domain.knowledge.view('workspace-a',site.id)).knowledge.indexedPages,16);
  const old=await store.getKnowledge('workspace-a',site.id);
  await domain.saveSite('workspace-a',website({url:'https://example.com/new-root'}),site.id);
  assert.equal(await store.progressKnowledge('workspace-a',site.id,old.runId,{...old,status:'failed'}),false);
  assert.equal((await store.getKnowledge('workspace-a',site.id)).status,'queued');
});

test('article research and writing receive only this website knowledge and record the snapshot', async t => {
  const { store }=await testDatabase(t);await store.createWorkspace('workspace-a','A');
  const contexts=[];
  const provider={ready:true,models:{},research:async(_topic,site)=>{contexts.push(site.knowledgeContext);return{sources:validArticle().references,usage:{}};},write:async(_topic,site)=>{contexts.push(site.knowledgeContext);return{article:validArticle(),usage:{}};}};
  const domain=new Domain(store,provider);const site=await domain.saveSite('workspace-a',website());
  const state=await store.getKnowledge('workspace-a',site.id);
  await store.putPage('workspace-a',site.id,state.runId,parsePage(page('UniqueFirstPartyIntegration'),site.url));
  await store.putKnowledge('workspace-a',site.id,{...state,status:'completed',activeRunId:state.runId,indexedPages:1});
  const topic=await domain.createTopic('workspace-a',site.id,{title:'Software integration guide'});
  const job=await domain.startGeneration('workspace-a',topic.id);await domain.runJob('workspace-a',job.id);
  assert.equal((await store.get('job','workspace-a',job.id)).status,'completed');
  assert.equal(contexts.length,2);for(const context of contexts)assert.match(context,/UniqueFirstPartyIntegration/);
  assert.equal((await store.get('job','workspace-a',job.id)).websiteKnowledge.runId,state.runId);
});

test('migration 2 upgrades a version-1 schema without replacing website records and can run twice', async t => {
  const {store}=await testDatabase(t);await store.createWorkspace('workspace-a','A');
  const domain=new Domain(store,{ready:false});const site=await domain.saveSite('workspace-a',website());
  await store.query('DROP TABLE website_pages');await store.query('DROP TABLE website_knowledge');await store.query('DELETE FROM schema_migrations WHERE version=2');
  await assert.rejects(store.assertSchema(),/db:migrate/);
  await store.migrate();await store.migrate();await store.assertSchema();
  assert.equal((await store.get('site','workspace-a',site.id)).name,site.name);
  assert.equal(await store.getKnowledge('workspace-a',site.id),null);
  assert.equal((await domain.queueWebsiteSync('workspace-a',site.id)).status,'queued');
});

test('canonical aliases and homepage fallbacks do not create misleading duplicate page records', async t => {
  const {store}=await testDatabase(t);await store.createWorkspace('workspace-a','A');
  const domain=new Domain(store,{ready:false});const site=await domain.saveSite('workspace-a',website());
  const home=page('Home','<a href="/alias">Alias</a><a href="/fallback">Fallback</a>');
  const pages=new Map([['https://example.com/',home],['https://example.com/services',page('Services')],['https://example.com/alias',home.replace('<title>','<link rel="canonical" href="/"><title>')],['https://example.com/fallback',home]]);
  store.workerActive=true;domain.knowledge.fetch=fetcher(pages);domain.knowledge.wait=async()=>{};
  await domain.syncWebsites(()=>{});
  const view=await domain.knowledge.view('workspace-a',site.id);
  assert.equal(view.knowledge.indexedPages,2);
  assert.ok(view.knowledge.errors.some(item=>/Canonical alias/.test(item.error)));
  assert.ok(view.knowledge.errors.some(item=>/Duplicate content/.test(item.error)));
  assert.deepEqual(view.pages.map(p=>p.url).sort(),['https://example.com/','https://example.com/services']);
});

test('worker lock loss does not mark a resumable crawl failed or activate staging pages', async t => {
  const {store}=await testDatabase(t);await store.createWorkspace('workspace-a','A');
  const domain=new Domain(store,{ready:false});const site=await domain.saveSite('workspace-a',website());
  store.workerActive=true;
  domain.knowledge.fetch=async(url)=>{store.workerActive=false;return response(url,'User-agent: *',200,'text/plain');};
  await domain.syncWebsites(()=>{});
  const state=await store.getKnowledge('workspace-a',site.id);
  assert.equal(state.status,'running');assert.equal(state.activeRunId,null);
  store.workerActive=true;domain.knowledge.wait=async()=>{};domain.knowledge.fetch=fetcher(new Map([['https://example.com/',page('Home')],['https://example.com/services',page('Services')]]));
  await domain.syncWebsites(()=>{});
  assert.equal((await domain.knowledge.view('workspace-a',site.id)).knowledge.indexedPages,2);
});
