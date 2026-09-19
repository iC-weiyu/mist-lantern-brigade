import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContent } from '../src/content.mjs';
import {
  createSave, equipmentOverview, updateEquipment, validateImportedSave, startBattle,
} from '../src/engine.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const content = loadContent(root);

function unlockFirstBattle(save) {
  save.story.prologue.status = 'idle';
  save.story.prologue.currentSceneId = null;
  save.story.prologue.nextSceneId = 'after_bridge';
  save.story.prologue.completedScenes = ['opening', 'departure', 'before_bridge'];
}

test('equipment transactions support equip, replace, move, swap, unequip, and slot rejection atomically', () => {
  const save = createSave(content);
  const beforeInvalid = structuredClone(save.equipped);
  assert.throws(() => updateEquipment(save, content, { equipmentId: 'starter_2', targetCharacterId: 'L01', targetSlot: 'weapon' }), /槽位不匹配/);
  assert.deepEqual(save.equipped, beforeInvalid);

  assert.equal(updateEquipment(save, content, { equipmentId: 'starter_1', targetCharacterId: 'L01', targetSlot: 'weapon' }).action, 'equip');
  assert.equal(updateEquipment(save, content, { equipmentId: 'starter_5', targetCharacterId: 'L01', targetSlot: 'weapon' }).action, 'replace');
  assert.equal(save.equipped.starter_5, 'L01');
  assert.equal(save.equipped.starter_1, undefined);
  updateEquipment(save, content, { equipmentId: 'starter_1', targetCharacterId: 'L02', targetSlot: 'weapon' });
  const swapped = updateEquipment(save, content, { equipmentId: 'starter_5', targetCharacterId: 'L02', targetSlot: 'weapon' });
  assert.equal(swapped.action, 'swap');
  assert.equal(save.equipped.starter_5, 'L02');
  assert.equal(save.equipped.starter_1, 'L01');
  assert.equal(updateEquipment(save, content, { equipmentId: 'starter_5', targetCharacterId: 'L02', remove: true }).action, 'unequip');
  assert.equal(save.equipped.starter_5, undefined);
  assert.equal(save.equipped.starter_1, 'L01');
  assert.equal(equipmentOverview(save, content).party[0].equipmentBySlot.weapon, 'starter_1');
});

test('equipment overview uses saved party order and active battles keep their opening snapshot', () => {
  const save = createSave(content);
  updateEquipment(save, content, { equipmentId: 'starter_1', targetCharacterId: 'L01', targetSlot: 'weapon' });
  const overview = equipmentOverview(save, content);
  assert.deepEqual(overview.party.map((entry) => entry.characterId), save.party);
  assert.equal(overview.party[0].equipmentBySlot.weapon, 'starter_1');
  unlockFirstBattle(save);
  const battle = startBattle(save, content, 'prologue_1');
  const hpAtStart = battle.players.find((unit) => unit.characterId === 'L01').maxHp;
  updateEquipment(save, content, { equipmentId: 'starter_2', targetCharacterId: 'L01', targetSlot: 'armor' });
  assert.equal(save.battle.players.find((unit) => unit.characterId === 'L01').maxHp, hpAtStart);
  save.battle = null;
  const nextBattle = startBattle(save, content, 'prologue_1');
  assert.ok(nextBattle.players.find((unit) => unit.characterId === 'L01').maxHp > hpAtStart);
});

test('import validation rejects duplicate equipment ids or duplicate same-slot wearers without repairing them', () => {
  const duplicateId = createSave(content);
  duplicateId.equipment[1].id = duplicateId.equipment[0].id;
  assert.throws(() => validateImportedSave(duplicateId, content), /重复装备 ID/);

  const duplicateSlot = createSave(content);
  duplicateSlot.equipped.starter_1 = 'L01';
  duplicateSlot.equipped.starter_5 = 'L01';
  assert.throws(() => validateImportedSave(duplicateSlot, content), /重复装备槽/);
});
