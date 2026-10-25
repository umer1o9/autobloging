import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Domain } from '../src/domain.js';
import { testDatabase } from './mysql-helper.js';
import { website, validArticle } from './helpers.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importSqlite } from '../scripts/import-sqlite.js';

async function pair(t, provider = { ready: true, models: {} }) {
  const db = await testDatabase(t, false);
  const other = new Store(db.url);
  t.after(async () => { await other.close(); await db.cleanup(); });
  await db.store.createWorkspace('workspace-a', 'Concurrency test');
  const a = new Domain(db.store, provider), b = new Domain(other, provider);
  const site = await a.saveSite('workspace-a', website({ monthlyBudget: 1, jobBudget: 1 }));
  return { a, b, store: db.store, other, site };
}
test('separate MySQL pools serialize competing budget reservations', async t => {
  const { a, b, store, site } = await pair(t);
  const first = await a.createTopic('workspace-a', site.id, { title: 'First concurrent topic' });
  const second = await a.createTopic('workspace-a', site.id, { title: 'Second concurrent topic' });
  const results = await Promise.allSettled([a.startGeneration('workspace-a', first.id), b.startGeneration('workspace-a', second.id)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /budget/);
  assert.equal(await a.reserved('workspace-a', site.id), 100);
  assert.equal((await store.list('job', 'workspace-a', site.id)).length, 1);
});
test('simultaneous edits accept one revision; competing publishers publish once', async t => {
  const { a, b, store, site } = await pair(t);
  const topic = await a.createTopic('workspace-a', site.id, { title: 'Concurrent editor workflow' });
  const draft = await a.createDraft('workspace-a', topic.id);
  const results = await Promise.allSettled([
    a.saveArticle('workspace-a', draft.id, { revision: 1, content: validArticle({ author: 'Editor A' }) }),
    b.saveArticle('workspace-a', draft.id, { revision: 1, content: validArticle({ author: 'Editor B' }) })
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
  await a.transition('workspace-a', draft.id, 'approve', { revision: 2, evidenceReviewed: true }, 'editor');
  const due = new Date(Date.now() + 60000);
  await a.transition('workspace-a', draft.id, 'schedule', { revision: 2, scheduledAt: due.toISOString() }, 'editor');
  const publications = await Promise.all([a.publishDue(due), b.publishDue(due)]);
  assert.equal(publications.reduce((sum,r) => sum + r.published, 0), 1);
  assert.equal((await store.query("SELECT COUNT(*) AS n FROM audit_events WHERE action='article.published'"))[0].n, 1);
  assert.equal((await store.query('SELECT COUNT(*) AS n FROM approvals'))[0].n, 1);
});
test('competing job workers call the paid provider only once', async t => {
  let calls = 0;
  const provider = { ready: true, models: {}, research: async () => { calls++; return { memo: 'Fixture', sources: validArticle().references, usage: {} }; }, write: async () => ({ article: validArticle(), usage: {} }) };
  const { a, b, store, site } = await pair(t, provider);
  const topic = await a.createTopic('workspace-a', site.id, { title: 'Concurrent paid job' });
  const job = await a.startGeneration('workspace-a', topic.id);
  await Promise.all([a.runJob('workspace-a', job.id), b.runJob('workspace-a', job.id)]);
  assert.equal(calls, 1);
  assert.equal((await store.list('article', 'workspace-a', site.id)).length, 1);
  assert.equal((await store.query('SELECT COUNT(*) AS n FROM usage_records'))[0].n, 2);
});
test('rollback leaves no partial data and database constraints enforce website scope', async t => {
  const { a, store, site } = await pair(t);
  await assert.rejects(() => store.transaction(async () => {
    await a.createTopic('workspace-a', site.id, { title: 'Must roll back' });
    throw new Error('Deliberate rollback');
  }, 'workspace-a'), /Deliberate rollback/);
  assert.equal((await store.list('topic', 'workspace-a', site.id)).length, 0);
  await store.createWorkspace('workspace-b', 'Another workspace');
  await assert.rejects(() => store.put('topic','workspace-b',site.id,{ id: 'cross-site', normalized:'invalid', status:'queued', createdAt:new Date().toISOString() }), error => error.code === 'ER_NO_REFERENCED_ROW_2');
});
test('delivery pagination is performed by MySQL and returns only published content', async t => {
  const { a, store, site } = await pair(t);
  for (let i=0; i<3; i++) {
    const topic = await a.createTopic('workspace-a',site.id,{ title:`Pagination fixture ${i}` });
    const draft = await a.createDraft('workspace-a',topic.id);
    if (i<2) await store.put('article','workspace-a',site.id,{ ...draft,status:'published',publishedAt:`2026-10-15T12:00:0${i}.000Z`,content:validArticle({slug:`fixture-${i}`}) });
  }
  const { key } = await a.rotateKey('workspace-a',site.id);
  const result = await a.delivered(site.id,key,undefined,{offset:1,limit:1});
  assert.equal(result.total,2); assert.equal(result.articles.length,1); assert.equal(result.articles[0].slug,'fixture-0');
});
test('only one server owns the scheduler lock at a time', async t => {
  const { store, other } = await pair(t);
  assert.equal(await store.acquireWorker(),true);
  assert.equal(await other.acquireWorker(),false);
});
test('SQLite import preserves users, sessions and content; replay is harmless', async t => {
  const { store } = await testDatabase(t);
  const folder = await mkdtemp(join(tmpdir(),'autoblog-import-')); t.after(() => rm(folder,{recursive:true,force:true}));
  const path = join(folder,'legacy.sqlite'); const source = new DatabaseSync(path);
  source.exec('CREATE TABLE users (id TEXT,email TEXT,password TEXT,workspace TEXT,name TEXT); CREATE TABLE sessions (hash TEXT,user_id TEXT,expires INTEGER); CREATE TABLE records (id TEXT,kind TEXT,workspace TEXT,site TEXT,body TEXT); CREATE TABLE events (id TEXT,workspace TEXT,site TEXT,action TEXT,entity TEXT,at TEXT)');
  source.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run('old-user','old@example.test','old-password-hash','old-workspace','Old workspace');
  source.prepare('INSERT INTO sessions VALUES (?,?,?)').run('a'.repeat(64),'old-user',Date.now()+60000);
  const site = { ...website(), id:'old-site', createdAt:new Date().toISOString(), monthlyBudgetCents:2500,jobBudgetCents:100 };
  const topic = {id:'old-topic',siteId:site.id,title:'Preserve me',normalized:'preserve me',status:'review',createdAt:site.createdAt,articleId:'old-article'};
  const article = {id:'old-article',siteId:site.id,topicId:topic.id,status:'draft',revision:3,approvedRevision:null,scheduledAt:null,createdAt:site.createdAt,content:validArticle()};
  for(const [kind,value] of [['site',site],['topic',topic],['article',article]]) source.prepare('INSERT INTO records VALUES (?,?,?,?,?)').run(value.id,kind,'old-workspace',site.id,JSON.stringify(value));
  source.close();
  const result = await importSqlite(store,path,join(folder,'backups'));
  assert.equal(result.counts.article,1); assert.deepEqual(await store.get('article','old-workspace',article.id),article);
  assert.equal((await store.userByEmail('old@example.test')).password,'old-password-hash');
  assert.equal((await store.sessionUser('a'.repeat(64),Date.now())).id,'old-user');
  assert.equal((await importSqlite(store,path,join(folder,'backups'))).alreadyImported,true);
  const unchanged = new DatabaseSync(path,{readOnly:true}); assert.equal(unchanged.prepare('SELECT COUNT(*) AS n FROM records').get().n,3); unchanged.close();
});
