import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { website } from './helpers.js';

test('website knowledge controls queue, inspect, search, escape source text and download Markdown', async () => {
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const events={}, app={innerHTML:''}, results={innerHTML:''}, query={value:'webhook integrations'}, modal={open:false,showModal(){this.open=true;},classList:{add(){},remove(){}}}, downloads=[], requests=[];
  const site={...website(),id:'site-knowledge',knowledge:{status:'completed',indexedPages:1,lastSyncedAt:'2026-10-29T10:00:00Z'}};
  const record={url:'https://example.com/services',title:'<script>Services</script>',headings:[],textLength:500,fetchedAt:'2026-10-29T10:00:00Z'};
  const document={querySelector:s=>s==='#app'?app:modal,getElementById:id=>id==='knowledge-query'?query:results,addEventListener:(name,callback)=>events[name]=callback,createElement:()=>({click(){downloads.push(this.download);},remove(){}}),body:{appendChild(){}}};
  class TestURL extends URL{static createObjectURL(){return 'blob:test';}static revokeObjectURL(){}}
  await runInNewContext(`(async()=>{${source}\nselectedSite='site-knowledge';page='websites';render();})()`,{document,URL:TestURL,Blob,Intl,console,setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},fetch:async(path,options={})=>{
    requests.push({path,method:options.method});
    return {ok:true,json:async()=>path.endsWith('/knowledge/sync')?{knowledge:{status:'queued'}}:path.endsWith('/knowledge')?{knowledge:{status:'completed',indexedPages:1,pending:0,indexType:'Local vectors'},pages:[record]}:path.includes('/knowledge/search')?{passages:[{title:record.title,url:record.url,text:'<img src=x onerror=bad()> Evidence',score:.8}]}:path.includes('/knowledge/document')?{markdown:'# Services\n\nWebsite details'}:{user:{name:'Test',email:'a@example.com'},sites:[site],articles:[],topics:[],jobs:[],provider:{ready:false,models:{}}}};
  }});
  const click=(action,extra={})=>events.click({preventDefault(){},target:{closest:()=>({disabled:false,dataset:{action,id:site.id,...extra}})}});
  assert.match(app.innerHTML,/Website knowledge/);assert.match(app.innerHTML,/Resync website/);assert.match(app.innerHTML,/1 indexed pages/);
  await click('knowledge-sync');assert.ok(requests.some(r=>r.path.endsWith('/knowledge/sync')&&r.method==='POST'));
  await click('knowledge');assert.match(modal.innerHTML,/&lt;script&gt;Services/);assert.doesNotMatch(modal.innerHTML,/<script>/);
  await click('knowledge-search');assert.match(results.innerHTML,/&lt;img/);assert.doesNotMatch(results.innerHTML,/<img/);
  await click('knowledge-document',{url:record.url});assert.match(modal.innerHTML,/# Services/);
  await click('knowledge-download',{url:record.url});assert.deepEqual(downloads,['site-knowledge-website-knowledge.md']);
});
