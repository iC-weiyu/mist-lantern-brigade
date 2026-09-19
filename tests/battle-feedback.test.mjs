import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadContent } from '../src/content.mjs';
import { createTestSave, grantTestCharacter } from '../src/test-workbench.mjs';
import { startBattle, stepBattle } from '../src/engine.mjs';

const content = loadContent(fileURLToPath(new URL('..', import.meta.url)));
function ready(ids) {
  const save = createTestSave(content);
  if (ids) { for (const id of ids) grantTestCharacter(save, content, id, 1); save.party = ids; }
  startBattle(save, content, 'prologue_1');
  return save;
}
function next(save, actor) {
  for (const unit of [...save.battle.players, ...save.battle.enemies]) unit.gauge = 0;
  actor.gauge = 10000; stepBattle(save, content);
  return save.battle.lastEvent;
}

test('first encounter finishes quickly at level one without losing starter viability', () => {
  for (const [ids, limit] of [[null, 30], [['C01', 'C02', 'C03', 'C04', 'C08'], 22]]) {
    const save = ready(ids);
    while (save.battle.status === 'active') stepBattle(save, content);
    assert.equal(save.battle.status, 'victory');
    assert.ok(save.battle.actionCount <= limit, `took ${save.battle.actionCount} actions`);
    assert.ok(save.battle.players.every(unit => unit.alive));
  }
});

test('healer attacks at full health, keeps ultimate energy, and heals an injured ally', () => {
  const save = ready(); const actor = save.battle.players.find(unit => unit.template === 'H');
  actor.energy = 100;
  assert.equal(next(save, actor).skill, 'P'); assert.equal(actor.energy, 100);
  const victim = save.battle.players[0]; victim.hp = victim.maxHp - 500;
  const oldHp = victim.hp; const event = next(save, actor);
  assert.equal(event.skill, 'U');
  assert.equal(event.effects.find(effect => effect.targetId === victim.id).amount, victim.hp - oldHp);
  assert.ok(victim.hp > oldHp);
});

test('support does not waste actions refreshing a permanent buff', () => {
  const save = ready(); const actor = save.battle.players.find(unit => unit.template === 'S');
  const first = next(save, actor);
  assert.equal(first.skill, 'A'); assert.equal(first.effects.filter(effect => effect.kind === 'buff').length, 5);
  actor.cooldown = 0; assert.equal(next(save, actor).skill, 'P');
  actor.energy = 100; assert.equal(next(save, actor).skill, 'U');
  assert.ok(save.battle.players.every(unit => unit.attackBuff === .2));
  actor.energy = 100; assert.equal(next(save, actor).skill, 'P');
});

test('shield and damage effects report actual capped gains and absorbed damage', () => {
  const save = ready(); const actor = save.battle.players.find(unit => unit.template === 'T');
  const ally = save.battle.players[1]; ally.shield = Math.round(ally.maxHp * .5) - 1;
  assert.equal(next(save, actor).effects.find(effect => effect.targetId === ally.id).amount, 1);
  const attacker = save.battle.players.find(unit => unit.template === 'A');
  const enemy = save.battle.enemies[0]; enemy.shield = 10; enemy.hp = 3;
  const effect = next(save, attacker).effects.find(effect => effect.targetId === enemy.id);
  assert.equal(effect.absorbed, 10); assert.equal(effect.hpDamage, 3); assert.equal(enemy.alive, false);
});

test('boss active shield protects itself instead of repeatedly shielding all enemies', () => {
  const save = ready(); startBattle(save, content, 'prologue_2');
  const boss = save.battle.enemies.find(unit => unit.template === 'T');
  const event = next(save, boss);
  assert.equal(event.skill, 'A'); assert.deepEqual(event.targetIds, [boss.id]);
  assert.ok(save.battle.enemies.filter(unit => unit !== boss).every(unit => unit.shield === 0));
});

test('lethal damage over time creates a fresh effect without replaying the previous action', () => {
  const save = ready(); const victim = save.battle.enemies[0];
  victim.hp = 2; victim.dots = [{ amount: 10, turns: 1 }];
  save.battle.lastEvent = { actorId: 'stale', effects: [{ kind: 'heal' }] };
  const event = next(save, victim);
  assert.equal(event.actorId, victim.id); assert.equal(event.skill, null);
  assert.equal(event.effects.length, 1); assert.equal(event.effects[0].kind, 'dot');
  assert.equal(event.effects[0].hpDamage, 2); assert.equal(victim.alive, false);
});
