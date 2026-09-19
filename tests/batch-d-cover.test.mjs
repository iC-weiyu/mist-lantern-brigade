import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadContent } from '../src/content.mjs';
import { createSave, startBattle, stepBattle } from '../src/engine.mjs';

const content = loadContent(fileURLToPath(new URL('..', import.meta.url)));

function ready() {
  const save = createSave(content);
  save.story.prologue.status = 'legacy';
  return save;
}

function prepared(deadCharacterIds = []) {
  const save = ready();
  const battle = startBattle(save, content, 'prologue_1');
  battle.enemies.slice(1).forEach((unit) => { unit.alive = false; unit.hp = 0; });
  for (const unit of battle.players) {
    unit.gauge = 0;
    if (deadCharacterIds.includes(unit.characterId)) { unit.alive = false; unit.hp = 0; }
  }
  return save;
}

function stepEnemy(save, mutate = () => {}) {
  const battle = save.battle;
  const enemy = battle.enemies[0];
  for (const unit of battle.players) if (unit.alive) { unit.hp = unit.maxHp; unit.shield = 0; unit.gauge = 0; }
  battle.actionCount = 0;
  enemy.gauge = 10000; enemy.energy = 0; enemy.cooldown = 0;
  mutate(battle, enemy);
  stepBattle(save, content, null, 'balanced');
  return { battle, event: battle.lastEvent, damage: battle.lastEvent.effects.filter((effect) => effect.kind === 'damage') };
}

function sampleRows(deadCharacterIds, count = 12000) {
  const save = prepared(deadCharacterIds);
  const counts = { front: 0, middle: 0, back: 0 };
  for (let i = 0; i < count; i += 1) {
    const { damage } = stepEnemy(save);
    const row = damage[0]?.coverRow;
    assert.ok(row, `expected a covered row at sample ${i}`);
    counts[row] += 1;
  }
  return counts;
}

test('new battle snapshots carry the cover rule and deterministic weighted rows', () => {
  const save = prepared();
  assert.deepEqual(save.battle.positioning, {
    version: 'batch-d-cover-v1',
    appliesTo: 'enemy-ordinary-single-direct',
    rowWeights: { front: 0.6, middle: 0.25, back: 0.15 },
    attenuation: { front: 1, middle: 0.85, back: 0.7 },
    bypassTags: ['bypassCover', 'piercing'],
  });
  const counts = sampleRows([], 12000);
  assert.ok(Math.abs(counts.front / 12000 - 0.6) < 0.025, JSON.stringify(counts));
  assert.ok(Math.abs(counts.middle / 12000 - 0.25) < 0.02, JSON.stringify(counts));
  assert.ok(Math.abs(counts.back / 12000 - 0.15) < 0.02, JSON.stringify(counts));
});

test('missing rows are renormalized without depending on party list order', () => {
  const counts = sampleRows(['L01'], 12000);
  assert.equal(counts.front, 0);
  assert.ok(Math.abs(counts.middle / 12000 - 0.625) < 0.025, JSON.stringify(counts));
  assert.ok(Math.abs(counts.back / 12000 - 0.375) < 0.025, JSON.stringify(counts));

  const onlyBack = sampleRows(['L01', 'L04', 'L05'], 2000);
  assert.deepEqual(onlyBack, { front: 0, middle: 0, back: 2000 });

  const first = prepared();
  const second = structuredClone(first);
  second.battle.players.reverse();
  first.rngState = second.rngState = 0x12345678;
  const one = stepEnemy(first);
  const two = stepEnemy(second);
  assert.equal(one.event.effects[0].coverRow, two.event.effects[0].coverRow);
  assert.equal(one.event.effects[0].targetId, two.event.effects[0].targetId);
  assert.equal(one.event.effects[0].coverMultiplier, two.event.effects[0].coverMultiplier);
});

test('cover attenuation is applied after the batch B enemy multiplier and only once', () => {
  const save = prepared();
  const { battle, event, damage } = stepEnemy(save, (current) => {
    current.positioning.rowWeights = { front: 0, middle: 1, back: 0 };
  });
  const effect = damage[0];
  const actor = battle.enemies[0];
  const target = battle.players.find((unit) => unit.id === effect.targetId);
  const coefficient = 1.45;
  const expected = Math.max(1, Math.round(actor.attack * coefficient * 110 / (110 + target.defense) * 2 * 0.85));
  assert.equal(effect.coverRow, 'middle');
  assert.equal(effect.coverMultiplier, 0.85);
  assert.equal(effect.amount, expected);
  assert.match(event.text, /前排掩护（中排×0\.85）/);

  const front = prepared();
  const frontResult = stepEnemy(front, (current) => { current.positioning.rowWeights = { front: 1, middle: 0, back: 0 }; });
  assert.equal(frontResult.damage[0].coverRow, 'front');
  assert.equal(frontResult.damage[0].coverMultiplier, 1);

  const deadFront = prepared(['L01']);
  const recovered = stepEnemy(deadFront, (current) => { current.positioning.rowWeights = { front: 0, middle: 1, back: 0 }; });
  assert.equal(recovered.damage[0].coverRow, 'middle');
  assert.equal(recovered.damage[0].coverMultiplier, 1);
  assert.match(recovered.event.text, /前排已倒下，掩护失效（×1\.00）/);
});

test('multi-target and explicitly bypassed attacks do not use cover attenuation', () => {
  const multi = prepared();
  const multiResult = stepEnemy(multi, (_battle, enemy) => { enemy.template = 'B'; });
  assert.ok(multiResult.damage.length >= 3);
  assert.ok(multiResult.damage.every((effect) => effect.coverMultiplier === 1 && effect.coverRow === null));

  const bypass = prepared();
  const bypassResult = stepEnemy(bypass, (current, enemy) => {
    current.positioning.rowWeights = { front: 0, middle: 1, back: 0 };
    enemy.bypassCover = true;
  });
  assert.equal(bypassResult.damage.length, 1);
  assert.equal(bypassResult.damage[0].coverMultiplier, 1);
  assert.equal(bypassResult.damage[0].coverRow, null);
});

test('old in-progress battles keep old targeting and a 1.0 cover multiplier', () => {
  const save = prepared();
  delete save.battle.positioning;
  const middle = save.battle.players.find((unit) => unit.formationRow === '中排');
  const result = stepEnemy(save, () => { middle.hp = 1; });
  assert.equal(result.damage[0].targetId, middle.id);
  assert.equal(result.damage[0].coverRow, null);
  assert.equal(result.damage[0].coverMultiplier, 1);
  assert.equal(save.battle.balance.enemyDamageMultiplier, 2);
});
