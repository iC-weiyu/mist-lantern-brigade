import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { loadContent } from '../src/content.mjs';
import { SaveSlots } from '../src/save-slots.mjs';
import { createTestSave, setTestResources, grantTestCharacter } from '../src/test-workbench.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const content = loadContent(root);
function workspace(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(),'mist-workbench-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); return path.join(dir,'save.json'); }

test('sandbox persists independently, keeps all three slots, and never writes their file', t => {
  const store = new SaveSlots(workspace(t), content);
  const original = fs.readFileSync(store.file,'utf8'); const token = store.selectionToken;
  store.select('test');
  assert.equal(store.state().slots.length,3);
  assert.equal(store.save.currencies.tickets,999); assert.equal(store.save.currencies.coins,99999999); assert.equal(store.save.currencies.contractShards,9999);
  assert.equal(store.save.unlocks.themePool,true);
  assert.throws(()=>store.assertSelection('1',token));
  const save=structuredClone(store.save); setTestResources(save,{tickets:321,coins:123456,contractShards:88}); grantTestCharacter(save,content,'C18',8); store.commit(save);
  assert.equal(fs.readFileSync(store.file,'utf8'),original);
  const resumed=new SaveSlots(store.file.replace('.slots.json','.json'),content);
  assert.equal(resumed.activeSlotId,'test'); assert.equal(resumed.save.owned.C18.dupes,7); assert.equal(resumed.save.currencies.tickets,321);
  resumed.select('1'); assert.equal(resumed.save.currencies.tickets,10); assert.equal(resumed.save.owned.C18,undefined);
  resumed.select('test'); assert.equal(resumed.save.currencies.tickets,321);
});

test('resource and character edits validate before mutation and leave gacha counters unchanged', () => {
  const save=createTestSave(content); const gacha=structuredClone(save.gacha);const before=structuredClone(save.currencies);
  for(const resources of [{tickets:-1},{coins:1.2},{foo:1},{tickets:5,coins:Infinity}]) assert.throws(()=>setTestResources(save,resources));
  assert.deepEqual(save.currencies,before);
  assert.throws(()=>grantTestCharacter(save,content,'bad',1)); assert.throws(()=>grantTestCharacter(save,content,'C18',0));
  grantTestCharacter(save,content,'C18',8); grantTestCharacter(save,content,'C18',2);
  assert.equal(save.owned.C18.dupes,9); assert.equal(save.collection.discovered.filter(id=>id==='C18').length,1);
  assert.deepEqual(save.gacha,gacha);
});

test('HTTP workbench rejects formal saves and stale clients, and repeated grants are idempotent',async t=>{
  const legacyPath=workspace(t);
  const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'0',MIST_SAVE_PATH:legacyPath},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill();});});
  const base=await new Promise((resolve,reject)=>{let output='';const timeout=setTimeout(()=>reject(Error('server timeout')),10000);child.stdout.on('data',data=>{output+=data;const match=output.match(/localhost:(\d+)/);if(match){clearTimeout(timeout);resolve(`http://127.0.0.1:${match[1]}`);}});child.once('error',reject);});
  const boot=await(await fetch(base+'/api/bootstrap?clientId=workbench-test')).json();
  const post=async(route,state,payload)=>(await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Client-Id':'workbench-test'},body:JSON.stringify({slotId:state.activeSlotId,selectionToken:state.selectionToken,...payload})})).json();
  assert.equal((await post('/api/action',boot,{type:'test_resources',resources:{tickets:500},txId:'forbidden'})).ok,false);
  const sandbox=await post('/api/slots',boot,{operation:'select',targetSlotId:'test'}); assert.equal(sandbox.ok,true);
  const payload={type:'test_grant',characterId:'C20',count:8,txId:'grant-once'};
  const granted=await post('/api/action',sandbox,payload); assert.equal(granted.save.owned.C20.dupes,7);
  const repeat=await post('/api/action',granted,payload); assert.equal(repeat.save.owned.C20.dupes,7);
  const formal=await post('/api/slots',repeat,{operation:'select',targetSlotId:'1'}); assert.equal(formal.save.owned.C20,undefined);
  assert.equal((await post('/api/action',repeat,{...payload,txId:'stale'})).ok,false);
});
