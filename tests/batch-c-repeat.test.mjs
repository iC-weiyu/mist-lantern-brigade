import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContent } from '../src/content.mjs';
import {
  createSave, startBattle, stepBattle, enableRepeatSession, pauseBattle, resumeBattle, stopAfterBattle,
  suspendInterruptedBattle, idempotent,
} from '../src/engine.mjs';

const content = loadContent(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

function ready() {
  const save = createSave(content);
  save.story.prologue.status = 'legacy';
  save.story.clearedStages = ['prologue_1'];
  return save;
}

function run(save, speed = 1) {
  const actions = [];
  while (save.battle.status === 'active') {
    actions.push(speed);
    stepBattle(save, content, save.battle.focusId, 'balanced', { now: 1_000 + actions.length * (660 / speed) });
  }
  return actions;
}

test('1x and 5x use the same engine result and action order', () => {
  const one = ready(); const five = structuredClone(one);
  startBattle(one, content, 'prologue_1'); startBattle(five, content, 'prologue_1');
  run(one, 1); run(five, 5);
  assert.equal(one.battle.status, five.battle.status);
  assert.equal(one.battle.actionCount, five.battle.actionCount);
  assert.deepEqual(one.battle.players.map((u) => [u.hp, u.shield, u.energy, u.alive]), five.battle.players.map((u) => [u.hp, u.shield, u.energy, u.alive]));
  assert.deepEqual(one.battle.enemies.map((u) => [u.hp, u.shield, u.energy, u.alive]), five.battle.enemies.map((u) => [u.hp, u.shield, u.energy, u.alive]));
  assert.deepEqual(
    { ...one.battle.reward, equipment: { ...one.battle.reward.equipment, id: 'same' } },
    { ...five.battle.reward, equipment: { ...five.battle.reward.equipment, id: 'same' } },
  );
});

test('repeat session requires a first clear and records one settled reward exactly once', () => {
  const first = createSave(content); first.story.prologue.status = 'legacy';
  assert.throws(() => startBattle(first, content, 'prologue_1', { repeat: true }), /首胜/);
  const save = ready();
  startBattle(save, content, 'prologue_1', { repeat: true, now: 10_000 });
  const sessionId = save.repeatSession.id;
  const beforeCoins = save.currencies.coins;
  let finalTx = null;
  while (save.battle.status === 'active') {
    finalTx = `step-${save.battle.actionCount}`;
    idempotent(save, finalTx, () => stepBattle(save, content, save.battle.focusId, 'balanced', { now: 10_100 + save.battle.actionCount * 660 }));
  }
  assert.equal(save.battle.status, 'victory');
  assert.equal(save.repeatSession.id, sessionId);
  assert.equal(save.repeatSession.wins, 1);
  assert.equal(save.repeatSession.battleIds.length, 1);
  assert.equal(save.repeatSession.equipmentIds.length, 1);
  assert.equal(save.currencies.coins - beforeCoins, save.battle.reward.coins);
  const wins = save.repeatSession.wins; const coins = save.currencies.coins; const gear = [...save.repeatSession.equipmentIds];
  idempotent(save, finalTx, () => stepBattle(save, content));
  assert.equal(save.repeatSession.wins, wins);
  assert.equal(save.currencies.coins, coins);
  assert.deepEqual(save.repeatSession.equipmentIds, gear);
  save.currencies.coins -= 7;
  assert.equal(save.repeatSession.reward.coins, save.battle.reward.coins);
});

test('checking online repeat binds the current battle to a persisted session', () => {
  const save = ready();
  startBattle(save, content, 'prologue_1');
  const battleId = save.battle.id;
  const session = enableRepeatSession(save, 15_000);
  assert.equal(save.battle.repeatSessionId, session.id);
  assert.equal(session.currentBattleId, battleId);
  assert.equal(session.stageId, 'prologue_1');
  assert.equal(session.status, 'active');
});

test('immediate pause, resume, stop-after-current, and interrupted refresh have explicit boundaries', () => {
  const save = ready();
  startBattle(save, content, 'prologue_1', { repeat: true, now: 20_000 });
  stepBattle(save, content, save.battle.focusId, 'balanced', { now: 20_660 });
  pauseBattle(save, '玩家立即暂停', 21_000);
  const actionCount = save.battle.actionCount; const onlineMs = save.repeatSession.onlineMs;
  assert.equal(save.battle.status, 'paused');
  assert.equal(save.repeatSession.status, 'paused');
  assert.throws(() => stepBattle(save, content), /没有可推进/);
  resumeBattle(save, 30_000);
  assert.equal(save.repeatSession.onlineMs, onlineMs);
  assert.equal(save.repeatSession.status, 'active');
  stopAfterBattle(save, 30_001);
  while (save.battle.status === 'active') stepBattle(save, content, save.battle.focusId, 'balanced', { now: 30_100 + save.battle.actionCount * 660 });
  assert.equal(save.battle.status, 'victory');
  assert.equal(save.repeatSession.status, 'completed');
  assert.equal(save.repeatSession.stopAfterBattle, true);
  assert.equal(save.repeatSummary.id, save.repeatSession.id);
  assert.equal(save.battle.actionCount > actionCount, true);

  const interrupted = ready();
  startBattle(interrupted, content, 'prologue_1', { repeat: true, now: 40_000 });
  const before = interrupted.repeatSession.onlineMs;
  assert.equal(suspendInterruptedBattle(interrupted, '刷新或关闭页面中断', 400_000), true);
  assert.equal(interrupted.battle.status, 'paused');
  assert.equal(interrupted.repeatSession.status, 'paused');
  assert.equal(interrupted.repeatSession.onlineMs, before);
});

test('full equipment storage stops before deleting or issuing a drop', () => {
  const save = ready();
  save.equipment = Array.from({ length: 999 }, (_, i) => ({ id: `qa-${i}`, name: '占位装备', rarity: '精良', slot: 'weapon', setId: 'E01', level: 0, locked: false, main: '攻击 +12' }));
  startBattle(save, content, 'prologue_1', { repeat: true });
  save.equipment.push({ id: 'qa-999', name: '占位装备', rarity: '精良', slot: 'weapon', setId: 'E01', level: 0, locked: false, main: '攻击 +12' });
  for (const unit of [...save.battle.players, ...save.battle.enemies]) unit.gauge = 0;
  save.battle.players[0].gauge = 10000;
  save.battle.enemies.forEach((enemy) => { enemy.hp = 0; enemy.alive = false; });
  stepBattle(save, content, save.battle.enemies[0].id, 'balanced');
  assert.equal(save.battle.status, 'stopped');
  assert.equal(save.battle.stopReason, 'backpack_full');
  assert.equal(save.repeatSession.status, 'stopped');
  assert.equal(save.equipment.length, 1000);
  assert.equal(save.repeatSession.equipmentIds.length, 0);
  assert.equal(save.repeatSession.wins, 0);
});
