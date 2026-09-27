import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { loadContent } from '../src/content.mjs';
import {
  createSave, chooseSelector, recycleDupe, validateImportedSave,
} from '../src/engine.mjs';
import {
  CHARACTER_CATALOG_VERSION, DEMOTED_SR_IDS, OPEN_SSR_IDS, RESERVED_SSR_IDS,
  addSelectorEntitlement, currentLowCandidates, currentSsrCandidates, validateWishSelection,
} from '../src/character-state.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const content = loadContent(root);

function tempSave(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mist-batch-e-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'save.json');
}

test('batch E catalog lists are complete, mutually exclusive, and pool counts are current', () => {
  assert.equal(OPEN_SSR_IDS.length, 18);
  assert.equal(RESERVED_SSR_IDS.length, 16);
  assert.equal(DEMOTED_SR_IDS.length, 8);
  assert.equal(new Set([...OPEN_SSR_IDS, ...RESERVED_SSR_IDS, ...DEMOTED_SR_IDS]).size, 42);
  assert.equal(currentSsrCandidates(content, 'standard').length, 12);
  assert.equal(currentSsrCandidates(content, 'past').length, 3);
  assert.equal(currentSsrCandidates(content, 'current').length, 3);
  assert.equal(currentLowCandidates(content, 'SR').length, 56);
  for (const id of DEMOTED_SR_IDS) {
    const character = content.characters.find((entry) => entry.id === id);
    assert.equal(character.rarity, 'SR');
    assert.equal(character.baseRarity, 'SSR');
    assert.equal(character.pool, 'low');
    assert.equal(character.legacyPool, 'standard');
  }
});

test('duplicate recycling is SSR 100, SR 10, R 2 contract shards and never equipment dust', () => {
  const save = createSave(content);
  save.owned.C01 = { level: 1, breakthrough: 0, dupes: 1, investedXp: 0, investedCoins: 0 };
  save.owned.C05 = { level: 1, breakthrough: 0, dupes: 1, investedXp: 0, investedCoins: 0 };
  save.owned.L01.dupes = 1;
  const dust = save.currencies.equipmentDust;
  recycleDupe(save, 'C01', content);
  recycleDupe(save, 'C05', content);
  recycleDupe(save, 'L01', content);
  assert.equal(save.currencies.contractShards, 120);
  assert.equal(save.currencies.equipmentDust, dust);
});

test('wish validation accepts only open standard SSR and rejects reserve, demoted, duplicate, or cross-pool IDs', () => {
  assert.deepEqual(validateWishSelection(content, 'common', ['C01', 'C02', '']), ['C01', 'C02', '']);
  assert.throws(() => validateWishSelection(content, 'common', ['C10', '', '']), /开放的常驻 SSR/);
  assert.throws(() => validateWishSelection(content, 'common', ['C05', '', '']), /开放的常驻 SSR/);
  assert.throws(() => validateWishSelection(content, 'common', ['C34', '', '']), /开放的常驻 SSR/);
  assert.throws(() => validateWishSelection(content, 'common', ['C01', 'C01', '']), /不可重复/);
});

test('selector entitlements preserve old SSR snapshots but new selectors cannot choose reserve or demoted IDs', () => {
  const legacy = createSave(content);
  legacy.gacha.selectors.common = 1;
  validateImportedSave(legacy, content);
  chooseSelector(legacy, 'C10', 'common', content);
  assert.equal(legacy.owned.C10.acquiredRarity, 'SSR');

  const current = createSave(content);
  addSelectorEntitlement(current, content, 'common');
  assert.throws(() => chooseSelector(current, 'C10', 'common', content), /不在该自选范围/);
  assert.throws(() => chooseSelector(current, 'C05', 'common', content), /不在该自选范围/);
  chooseSelector(current, 'C01', 'common', content);
  assert.equal(current.gacha.selectors.common, 0);
});

test('migration is versioned and idempotent while preserving old assets and history fields', () => {
  const save = createSave(content);
  save.owned.C13 = { level: 8, breakthrough: 2, dupes: 3, investedXp: 400, investedCoins: 900, equipped: true };
  save.party = ['C13', 'L02', 'L03', 'L04', 'L05'];
  save.gacha.selectors.common = 1;
  save.gacha.lastResults = [{ characterId: 'C05', rarity: 'SSR', isNew: false }];
  save.transactions.old = { results: [{ characterId: 'C05', rarity: 'SSR' }] };
  validateImportedSave(save, content);
  const once = JSON.stringify(save);
  assert.equal(save.catalog.version, CHARACTER_CATALOG_VERSION);
  assert.equal(save.owned.C13.acquiredRarity, 'SSR');
  assert.equal(save.owned.C13.level, 8);
  assert.equal(save.owned.C13.breakthrough, 2);
  assert.deepEqual(save.gacha.lastResults, [{ characterId: 'C05', rarity: 'SSR', isNew: false }]);
  assert.deepEqual(save.transactions.old.results, [{ characterId: 'C05', rarity: 'SSR' }]);
  validateImportedSave(save, content);
  assert.equal(JSON.stringify(save), once);
});

test('temporary HTTP path enforces wish validation and exercises test-workbench recycle without formal saves', async (t) => {
  const legacyPath = tempSave(t);
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: root, env: { ...process.env, PORT: '0', MIST_SAVE_PATH: legacyPath }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) await new Promise((resolve) => { child.once('exit', resolve); child.kill(); });
  });
  const base = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('server start timeout')), 10_000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`); }
    });
    child.once('error', reject);
  });
  const post = async (route, state, payload) => (await fetch(base + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client-Id': 'batch-e-http' },
    body: JSON.stringify({ slotId: state.activeSlotId, selectionToken: state.selectionToken, ...payload }),
  })).json();
  const boot = await (await fetch(base + '/api/bootstrap?clientId=batch-e-http')).json();
  const badWish = await post('/api/action', boot, { type: 'set_wishes', pool: 'common', wishes: ['C10', '', ''], txId: 'bad-wish' });
  assert.equal(badWish.ok, false);
  const goodWish = await post('/api/action', boot, { type: 'set_wishes', pool: 'common', wishes: ['C01', 'C02', ''], txId: 'good-wish' });
  assert.equal(goodWish.ok, true);
  const testSlot = await post('/api/slots', goodWish, { operation: 'select', targetSlotId: 'test' });
  assert.equal(testSlot.ok, true);
  const testBoot = await (await fetch(base + '/api/bootstrap?clientId=batch-e-http')).json();
  assert.equal(testBoot.content.characters.find((entry) => entry.id === 'C31').catalogStatus, 'reserve');
  const granted = await post('/api/action', testBoot, { type: 'test_grant', characterId: 'C05', count: 2, txId: 'grant-c05' });
  assert.equal(granted.ok, true);
  const recycled = await post('/api/action', granted, { type: 'recycle', characterId: 'C05', txId: 'recycle-c05' });
  assert.equal(recycled.ok, true);
  assert.equal(recycled.result.shards, 10);
  assert.equal(recycled.save.currencies.equipmentDust, 80);
});
