import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { startServer } from '../src/startup.js';
import { Store } from '../src/store.js';
import { testDatabase } from './mysql-helper.js';
import { Domain } from '../src/domain.js';
import { website } from './helpers.js';

test('managed startup binds before initialization and gates requests until the application is ready', async t => {
  let release, closed = false;
  const initialization = new Promise(resolve => { release = resolve; });
  const application = { server: http.createServer((_req,res) => res.end('Application ready')), close: async () => { closed = true; } };
  const startup = startServer({ port: 0, initialize: () => initialization });
  t.after(async () => { release(application); await startup.close(); });
  await startup.listening;
  const origin = `http://127.0.0.1:${startup.server.address().port}`;
  const waiting = await fetch(origin);
  assert.equal(waiting.status,503); assert.equal(waiting.headers.get('retry-after'),'5');
  assert.match((await waiting.json()).error,/starting/);
  release(application); await startup.ready;
  assert.equal(await (await fetch(origin)).text(),'Application ready');
  await startup.close(); assert.equal(closed,true);
});

test('initialization failure stays unavailable and never exposes the private error to visitors', async t => {
  const startup = startServer({ port: 0, initialize: async () => { throw new Error('Private database diagnostic'); } });
  const failure = assert.rejects(startup.ready,/Private database diagnostic/);
  t.after(() => startup.close()); await startup.listening; await failure;
  const response = await fetch(`http://127.0.0.1:${startup.server.address().port}`);
  assert.equal(response.status,503);
  const message=await response.text();assert.match(message,/initialization failed/);assert.doesNotMatch(message,/Private database diagnostic/);
});

test('schema preparation only migrates known missing-schema errors and still supports strict checks', async () => {
  let migrated=0;
  const accessError=Object.assign(new Error('Access denied'),{code:'ER_ACCESS_DENIED_ERROR'});
  const denied={assertSchema:async()=>{throw accessError;},migrate:async()=>{migrated++;}};
  await assert.rejects(Store.prototype.prepareSchema.call(denied,{migrate:true}),error=>error===accessError);
  assert.equal(migrated,0);
  const missing={assertSchema:async()=>{throw Object.assign(new Error('Missing migration'),{code:'SCHEMA_MIGRATION_REQUIRED'});},migrate:async()=>{migrated++;}};
  await assert.rejects(Store.prototype.prepareSchema.call(missing),/Missing migration/);
  assert.equal(migrated,0);
});

test('runtime schema preparation upgrades version 1 with the optional migration account and retains websites', async t => {
  const {store,url}=await testDatabase(t);await store.createWorkspace('workspace-a','A');
  const domain=new Domain(store,{ready:false});const site=await domain.saveSite('workspace-a',website());
  await store.query('DROP TABLE website_pages');await store.query('DROP TABLE website_knowledge');await store.query('DELETE FROM schema_migrations WHERE version=2');
  await store.prepareSchema({migrate:true,migrationDatabase:url,log:()=>{}});
  await store.assertSchema();
  assert.equal((await store.get('site','workspace-a',site.id)).name,site.name);
  await store.prepareSchema({migrate:true,log:()=>{throw new Error('Current schemas should not migrate again');}});
});

test('runtime bootstrap recreates missing migration metadata without replacing existing records', async t => {
  const {store}=await testDatabase(t);await store.createWorkspace('workspace-a','A');
  await store.query('DROP TABLE schema_migrations');
  await store.prepareSchema({migrate:true,log:()=>{}});
  await store.assertSchema();
  assert.equal((await store.query('SELECT name FROM workspaces WHERE id=?',['workspace-a']))[0].name,'A');
});

test('Hostinger CommonJS lsnode entry binds first, migrates an older database and starts without top-level await', async t => {
  const {store,url}=await testDatabase(t);await store.createWorkspace('workspace-a','Preserved workspace');
  await store.query('DROP TABLE website_pages');await store.query('DROP TABLE website_knowledge');await store.query('DELETE FROM schema_migrations WHERE version=2');
  const entry=fileURLToPath(new URL('../src/server.js',import.meta.url));
  const code=`const http=require('node:http');const listen=http.Server.prototype.listen;http.Server.prototype.listen=function(...args){console.log('LISTEN_CALLED');return listen.apply(this,args);};process.argv[1]='/tmp/lsnode.js';require(${JSON.stringify(entry)});`;
  const child=spawn(process.execPath,['-e',code],{env:{...process.env,DATABASE_URL:url,MIGRATION_DATABASE_URL:'',WORKER_MODE:'cron',ALLOW_PAID_GENERATION:'false',HOST:'127.0.0.1',PORT:'0'}});
  let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
  t.after(async()=>{if(child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}});
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error(`Startup timed out: ${output}`)),15000);
    const check=()=>{if(output.includes('AutoBlog Studio is running on MySQL')){clearTimeout(timer);resolve();}};
    child.stdout.on('data',check);child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Child exited ${code}: ${output}`));});
  });
  assert.ok(output.indexOf('LISTEN_CALLED')<output.indexOf('[startup] Applying pending'));
  assert.doesNotMatch(output,/ERR_REQUIRE_ASYNC_MODULE|failed to start/);
  await store.assertSchema();
  assert.equal((await store.query('SELECT name FROM workspaces WHERE id=?',['workspace-a']))[0].name,'Preserved workspace');
});
