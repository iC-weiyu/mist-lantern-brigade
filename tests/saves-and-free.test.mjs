import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { loadContent } from '../src/content.mjs';
import { createSave, validateImportedSave, idempotent } from '../src/engine.mjs';
import { SaveSlots } from '../src/save-slots.mjs';
import { claimFreeRecruit, freeRecruitStatus } from '../src/free-recruit.mjs';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const content = loadContent(root);
const time = (value) => Date.parse(value);

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mist-slots-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'save.json');
}

test('three slots migrate without touching the original, reject overwrites and restore each story cursor', (t) => {
  const legacyPath = workspace(t); const original = createSave(content);
  original.currencies.tickets = 57; original.story.prologue.beatIndex = 6;
  const raw = JSON.stringify(original); fs.writeFileSync(legacyPath, raw);
  const store = new SaveSlots(legacyPath, content);
  assert.equal(fs.readFileSync(legacyPath, 'utf8'), raw);
  const oldToken = store.selectionToken;
  store.select('2', true, '第二段旅程');
  assert.equal(store.save.currencies.tickets, 10);
  assert.equal(store.save.story.prologue.beatIndex, 0);
  assert.equal(store.save.story.prologue.currentSceneId, 'opening');
  assert.throws(() => store.assertSelection('1', oldToken), /存档已切换/);
  const changed = structuredClone(store.save); changed.story.prologue.beatIndex = 3; store.commit(changed);
  store.select('3', true); assert.throws(() => store.select('4', true), /1～3/);
  assert.throws(() => store.select('1', true), /已有存档/);
  store.select('1');
  assert.equal(store.save.currencies.tickets, 57);
  assert.equal(store.save.story.prologue.beatIndex, 6);
  assert.throws(() => store.assertSelection('1', oldToken), /存档已切换/);
  const restarted = new SaveSlots(legacyPath, content); restarted.select('2');
  assert.equal(restarted.save.story.prologue.beatIndex, 3);
  assert.equal(fs.readFileSync(legacyPath, 'utf8'), raw);
});

test('deleting slots clears only the target, switches safely, and allows an all-empty archive', (t) => {
  const legacyPath = workspace(t); const original = createSave(content);
  original.currencies.tickets = 57;
  const raw = JSON.stringify(original); fs.writeFileSync(legacyPath, raw);
  const store = new SaveSlots(legacyPath, content);
  store.select('2', true, '备用旅程');
  const tokenBeforeDelete = store.selectionToken;
  const switched = store.remove('2');
  assert.deepEqual(switched, { deletedSlotId: '2', activeSlotId: '1' });
  assert.equal(store.save.currencies.tickets, 57);
  assert.throws(() => store.assertSelection('2', tokenBeforeDelete), /存档已切换/);
  const emptied = store.remove('1');
  assert.deepEqual(emptied, { deletedSlotId: '1', activeSlotId: null });
  assert.equal(store.save, null);
  assert.ok(store.state().slots.every((slot) => slot.empty));
  store.select('3', true, '重新点灯');
  assert.equal(store.data.activeSlotId, '3');
  assert.equal(store.save.currencies.tickets, 10);
  assert.equal(fs.readFileSync(legacyPath, 'utf8'), raw);
});

test('new saves use independent nonzero random seeds and migration preserves existing RNG', () => {
  const seeds = new Set(Array.from({ length: 16 }, () => createSave(content).rngState));
  assert.ok(seeds.size > 1); assert.ok(!seeds.has(0));
  const old = createSave(content); old.rngState = 123;
  validateImportedSave(old, content); assert.equal(old.rngState, 123);
});

test('free hourly single refreshes on the exact hour, does not stack and uses no tickets', () => {
  const save = createSave(content); save.currencies.tickets = 0;
  const before = time('2026-09-17T14:59:59.999+08:00');
  assert.equal(claimFreeRecruit(save, content, 'hourly_common', before).results.length, 1);
  assert.throws(() => claimFreeRecruit(save, content, 'hourly_common', before), /已使用/);
  assert.equal(freeRecruitStatus(save, before)[0].nextRefreshAt, time('2026-09-17T15:00:00+08:00'));
  claimFreeRecruit(save, content, 'hourly_common', before + 1);
  const muchLater = before + 72 * 3_600_000;
  claimFreeRecruit(save, content, 'hourly_common', muchLater);
  assert.throws(() => claimFreeRecruit(save, content, 'hourly_common', muchLater), /已使用/);
  assert.equal(save.currencies.tickets, 0); assert.equal(save.gacha.totalPulls, 3);
});

test('daily offers refresh at Beijing 23:00, not midnight, independently from the hourly offer', () => {
  const save = createSave(content); save.unlocks.themePool = true;
  save.gacha.totalPulls = 190;
  const before = time('2026-09-17T22:59:59.999+08:00');
  const first = claimFreeRecruit(save, content, 'daily_common', before);
  assert.equal(first.results.length, 10); assert.equal(save.gacha.selectors.common, 1);
  assert.equal(save.currencies.tickets, 10);
  claimFreeRecruit(save, content, 'daily_theme', before);
  claimFreeRecruit(save, content, 'hourly_common', before);
  assert.ok(freeRecruitStatus(save, before).every((offer) => !offer.available));
  assert.ok(freeRecruitStatus(save, before + 1).every((offer) => offer.available));
  claimFreeRecruit(save, content, 'daily_common', before + 1);
  claimFreeRecruit(save, content, 'daily_theme', before + 1);
  const midnight = time('2026-09-18T00:00:00+08:00');
  assert.ok(freeRecruitStatus(save, midnight).filter((offer) => offer.cycle === 'daily').every((offer) => !offer.available));
  assert.ok(freeRecruitStatus(save, time('2026-09-18T23:00:00+08:00')).every((offer) => offer.available));
});

test('free claims survive reload, are idempotent, and theme lock does not consume an offer', () => {
  const save = createSave(content); const now = time('2026-09-17T23:00:00+08:00');
  assert.throws(() => claimFreeRecruit(save, content, 'daily_theme', now), /完成序章/);
  assert.equal(save.gacha.freeClaims, undefined);
  const a = idempotent(save, 'same-request', () => claimFreeRecruit(save, content, 'daily_common', now));
  const b = idempotent(save, 'same-request', () => claimFreeRecruit(save, content, 'daily_common', now));
  assert.deepEqual(a, b); assert.equal(save.gacha.totalPulls, 10);
  const restored = validateImportedSave(JSON.parse(JSON.stringify(save)), content);
  assert.throws(() => claimFreeRecruit(restored, content, 'daily_common', now), /已使用/);
  assert.ok(freeRecruitStatus(createSave(content), now).find((offer) => offer.id === 'daily_common').available);
});

test('starter names are consistent in story narration, speaker labels, and stable IDs', () => {
  const expected = ['冬青', '南星', '米团', '路修', '小灯芯'];
  assert.deepEqual(content.characters.filter((c) => ['L01','L02','L03','L04','L05'].includes(c.id)).map(c => c.name), expected);
  assert.doesNotMatch(JSON.stringify(content.prologue), /莉娅|诺娅|弥露|芬恩|缇可/);
  for (const beat of content.prologue.scenes.flatMap(scene => scene.beats)) {
    if (beat.speakerId) assert.equal(beat.speaker, content.characters.find(c => c.id === beat.speakerId).name);
  }
});

test('HTTP slot selection rejects stale actions and keeps resources and free claims isolated', async (t) => {
  const legacyPath = workspace(t);
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: '0', MIST_SAVE_PATH: legacyPath }, stdio: ['ignore','pipe','pipe'] });
  t.after(async () => { if (child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill(); }); });
  const base = await new Promise((resolve, reject) => {
    let output = ''; const timeout = setTimeout(() => reject(new Error('server start timeout')), 10_000);
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/http:\/\/localhost:(\d+)/); if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`); } });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
  });
  const post = async (endpoint, snapshot, payload, client = 'test-one') => (await fetch(base + endpoint, { method:'POST', headers:{'Content-Type':'application/json','X-Client-Id':client}, body:JSON.stringify({ slotId:snapshot.activeSlotId, selectionToken:snapshot.selectionToken, ...payload }) })).json();
  const first = await (await fetch(base + '/api/bootstrap?clientId=test-one')).json();
  const paid = await post('/api/action', first, { type:'free_gacha', offerId:'daily_common', txId:'free-one' });
  assert.equal(paid.save.gacha.totalPulls, 10); assert.equal(paid.save.currencies.tickets, 10);
  const second = await post('/api/slots', paid, { operation:'create', targetSlotId:'2' });
  assert.equal(second.save.gacha.totalPulls, 0);
  const stale = await post('/api/action', paid, { type:'gacha', pool:'common', count:1, txId:'stale' });
  assert.equal(stale.ok, false); assert.match(stale.error, /存档已切换/);
  const otherTab = await post('/api/slots', second, { operation:'select', targetSlotId:'1' }, 'test-two');
  assert.equal(otherTab.ok, false);
  const restored = await post('/api/slots', second, { operation:'select', targetSlotId:'1' });
  assert.equal(restored.save.gacha.totalPulls, 10);
  assert.equal(restored.freeRecruit.find(offer => offer.id === 'daily_common').available, false);
  const duplicate = await post('/api/action', restored, { type:'free_gacha', offerId:'daily_common', txId:'free-one' });
  assert.equal(duplicate.save.gacha.totalPulls, 10);
});

test('HTTP deletion requires explicit checkbox confirmation and can remove the final slot', async (t) => {
  const legacyPath = workspace(t);
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: '0', MIST_SAVE_PATH: legacyPath }, stdio: ['ignore','pipe','pipe'] });
  t.after(async () => { if (child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill(); }); });
  const base = await new Promise((resolve, reject) => {
    let output = ''; const timeout = setTimeout(() => reject(new Error('server start timeout')), 10_000);
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/http:\/\/localhost:(\d+)/); if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`); } });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
  });
  const bootstrap = await (await fetch(base + '/api/bootstrap?clientId=delete-test')).json();
  const send = async (payload) => (await fetch(base + '/api/slots', { method:'POST', headers:{'Content-Type':'application/json','X-Client-Id':'delete-test'}, body:JSON.stringify({ slotId:bootstrap.activeSlotId, selectionToken:bootstrap.selectionToken, targetSlotId:'1', ...payload }) })).json();
  const rejected = await send({ operation:'delete', confirmed:false });
  assert.equal(rejected.ok, false); assert.match(rejected.error, /确认框/);
  const deleted = await send({ operation:'delete', confirmed:true });
  assert.equal(deleted.ok, true); assert.equal(deleted.save, null); assert.equal(deleted.activeSlotId, null);
  assert.ok(deleted.slots.every((slot) => slot.empty));
  const recreated = await (await fetch(base + '/api/slots', { method:'POST', headers:{'Content-Type':'application/json','X-Client-Id':'delete-test'}, body:JSON.stringify({ operation:'create', slotId:null, selectionToken:deleted.selectionToken, targetSlotId:'2', name:'重新开始' }) })).json();
  assert.equal(recreated.ok, true); assert.equal(recreated.activeSlotId, '2'); assert.equal(recreated.save.currencies.tickets, 10);
});
