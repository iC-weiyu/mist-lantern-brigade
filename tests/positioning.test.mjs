import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadContent } from '../src/content.mjs';
const content = loadContent(fileURLToPath(new URL('..', import.meta.url)));
const character = id => content.characters.find(entry => entry.id === id);

test('SSR recommended rows distinguish melee and ranged units without changing their job', () => {
  for (const entry of content.characters.filter(entry => entry.rarity === 'SSR')) {
    assert.ok(['前排', '中排', '后排'].includes(entry.recommendedRow), entry.id);
    assert.ok(entry.combatStyle, entry.id);
  }
  for (const id of ['C02', 'C17', 'C18', 'C31']) {
    assert.equal(character(id).template, 'A');
    assert.equal(character(id).recommendedRow, '前排');
  }
  for (const id of ['C05', 'C36']) {
    assert.equal(character(id).template, 'A');
    assert.equal(character(id).recommendedRow, '中排');
  }
  assert.equal(character('C20').template, 'S');
  assert.equal(character('C20').recommendedRow, '后排');
  assert.equal(character('C18').attack, 120);
});
