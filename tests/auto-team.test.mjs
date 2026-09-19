import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadContent } from '../src/content.mjs';
import { buildAutoTeam } from '../public/auto-team.js';
const content = loadContent(fileURLToPath(new URL('..', import.meta.url)));
const ownedOf = ids => Object.fromEntries(ids.map(id => [id, { level: 1, breakthrough: 0 }]));
function check(result) {
  assert.equal(result.party.length, 5);
  assert.equal(new Set(result.party).size, 5);
  assert.equal(result.formation.filter(Boolean).length, 6);
  assert.deepEqual(result.formation.filter(id => id && id !== 'protagonist').sort(), [...result.party].sort());
  for (let row = 0; row < 3; row++) assert.ok(result.formation.slice(row * 3, row * 3 + 3).some(id => id && id !== 'protagonist'));
}
test('auto team prioritizes rarity then level then breakthrough and uses three partner rows', () => {
  const owned = ownedOf(['C02','C18','C04','C05','C20','C21','L01']);
  owned.C18.level = 3; owned.C05.level = 2; owned.C20.breakthrough = 2; owned.L01.level = 100;
  const before = structuredClone(owned);
  const result = buildAutoTeam(content.characters, owned);
  assert.deepEqual(result.party, ['C18','C05','C20','C02','C04']);
  check(result); assert.deepEqual(owned, before);
  assert.ok(result.formation.indexOf('C18') < 3);
  assert.ok(result.formation.indexOf('C20') >= 6);
});
test('auto team covers all rows even if the collection contains only melee attackers', () => {
  const result = buildAutoTeam(content.characters, ownedOf(['C02','C17','C18','C31','C25']), ['protagonist']);
  check(result); assert.equal(result.formation[0], 'protagonist');
});
test('auto team reserves a suitable lower-rarity partner when a row lacks SSR choices', () => {
  const result = buildAutoTeam(content.characters, ownedOf(['C02','C17','C18','C31','C04','C05','L02']));
  check(result); assert.ok(result.party.includes('L02'));
  assert.ok(result.formation.indexOf('L02') >= 6);
});
