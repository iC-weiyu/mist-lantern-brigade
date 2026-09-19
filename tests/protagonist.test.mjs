import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadContent } from '../src/content.mjs';
import { createSave, validateImportedSave } from '../src/engine.mjs';
import { protagonistSummary } from '../src/protagonist.mjs';
const content = loadContent(fileURLToPath(new URL('..', import.meta.url)));

test('protagonist starts at SR strength without taking a companion slot', () => {
  const save = createSave(content); const hero = protagonistSummary(save);
  assert.deepEqual([hero.hp, hero.attack, hero.defense, hero.level], [850, 102, 51, 1]);
  assert.equal(save.party.length, 5); assert.equal(Object.keys(save.owned).length, 5);
});

test('story growth is derived once from cleared stages and legacy saves receive it', () => {
  const save = createSave(content); delete save.profile.protagonist;
  save.story.clearedStages = ['prologue_1','prologue_2','prologue_3','prologue_3'];
  validateImportedSave(save, content);
  const first = protagonistSummary(save);
  assert.equal(first.storyBonus, 35); assert.equal(first.hp, 1148);
  assert.deepEqual(protagonistSummary(save), first);
  assert.equal(save.currencies.tickets, 10);
});

test('growth continues past the companion level cap without affecting speed', () => {
  const save = createSave(content); save.profile.protagonist.level = 1000;
  validateImportedSave(save, content);
  const first = protagonistSummary(save); save.profile.protagonist.level = 1001;
  const next = protagonistSummary(save);
  assert.ok(next.hp > first.hp); assert.ok(next.attack > first.attack); assert.equal(next.speed, 1000);
});
