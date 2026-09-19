import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadContent } from '../src/content.mjs';
import { createTestSave, grantTestCharacter } from '../src/test-workbench.mjs';
import { startBattle, stepBattle } from '../src/engine.mjs';

const content = loadContent(fileURLToPath(new URL('..', import.meta.url)));

test('player continuous damage stores the same 1.20x candidate multiplier as direct damage', () => {
  const dotId = content.characters.find((character) => character.rarity === 'SSR' && character.template === 'D')?.id;
  assert.ok(dotId, 'expected a D-template SSR');
  const save = createTestSave(content);
  grantTestCharacter(save, content, dotId, 1);
  save.party = [dotId, 'L01', 'L02', 'L03', 'L04'];
  const battle = startBattle(save, content, 'prologue_1');
  const actor = battle.players.find((unit) => unit.characterId === dotId);
  for (const unit of [...battle.players, ...battle.enemies]) unit.gauge = 0;
  actor.gauge = 10000;
  stepBattle(save, content, battle.enemies[0].id);
  const dot = battle.enemies[0].dots[0];
  assert.equal(dot.amount, actor.attack * 0.12 * 1.2);
});

test('enemy direct damage uses 2.0x while enemy hp and defense remain unchanged', () => {
  const save = createTestSave(content);
  const battle = startBattle(save, content, 'prologue_1');
  const enemy = battle.enemies[0];
  const enemyHp = enemy.maxHp;
  const enemyDefense = enemy.defense;
  for (const unit of [...battle.players, ...battle.enemies]) unit.gauge = 0;
  enemy.gauge = 10000;
  stepBattle(save, content);
  const damage = battle.lastEvent.effects.find((effect) => effect.kind === 'damage');
  assert.ok(damage);
  assert.equal(enemy.maxHp, enemyHp);
  assert.equal(enemy.defense, enemyDefense);
  assert.equal(battle.balance.enemyDamageMultiplier, 2);
  assert.equal(battle.metrics.enemyDamage, damage.hpDamage);
});
