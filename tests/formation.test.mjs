import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadContent } from '../src/content.mjs';
import { createSave, startBattle, stepBattle } from '../src/engine.mjs';
import { ensureFormation, setFormation } from '../src/formation.mjs';
const content = loadContent(fileURLToPath(new URL('..', import.meta.url)));
function ready() { const save = createSave(content); save.story.prologue.status = 'legacy'; return save; }

test('formation repairs legacy placement and rejects duplicates or missing protagonist', () => {
  const save = ready(); delete save.formation;
  const cells = ensureFormation(save);
  assert.equal(cells.length, 9); assert.equal(new Set(cells.filter(Boolean)).size, 6);
  assert.equal(cells[4], 'protagonist');
  const copy = [...cells]; copy[0] = 'protagonist';
  assert.throws(() => setFormation(save, copy)); assert.deepEqual(save.formation, cells);
  assert.throws(() => setFormation(save, cells.slice(1)));
});

test('row bonuses apply to the next battle while active snapshots keep their formation', () => {
  const save = ready(); const first = startBattle(save, content, 'prologue_1');
  const tank = { ...first.players.find(p => p.characterId === 'L01' || p.id === 'L01') };
  const damage = { ...first.players.find(p => p.characterId === 'L04' || p.id === 'L04') };
  const cells = [...save.formation]; [cells[0], cells[3]] = [cells[3], cells[0]]; setFormation(save, cells);
  assert.notDeepEqual(first.formation, cells);
  save.battle = null; const second = startBattle(save, content, 'prologue_1');
  const nextTank = second.players.find(p => p.name === tank.name);
  const nextDamage = second.players.find(p => p.name === damage.name);
  assert.equal(tank.maxHp, Math.round(nextTank.maxHp * 1.15));
  assert.equal(tank.defense, Math.round(nextTank.defense * 1.15));
  assert.equal(nextTank.attack, Math.round(tank.attack * 1.1));
  assert.equal(damage.attack, Math.round(nextDamage.attack * 1.1));
  assert.equal(second.players.length, 5);
});

test('back row healing and shields affect actual action results', () => {
  for (const id of ['L01', 'L02']) {
    const save = ready(); const cells = [...save.formation]; const from = cells.indexOf(id);
    [cells[from], cells[8]] = [cells[8], cells[from]]; setFormation(save, cells);
    const battle = startBattle(save, content, 'prologue_1');
    const actor = battle.players.find(p => p.characterId === id || p.id === id);
    actor.speed = 100000; actor.cooldown = 0; actor.energy = 0;
    for (const unit of battle.players) unit.hp = 1;
    stepBattle(save, content, null, 'balanced');
    if (id === 'L01') assert.equal(battle.players[0].shield, Math.round(actor.defense * 1.6 * 1.15));
    else assert.ok(battle.players.some(p => p.hp === 1 + Math.round(actor.attack * 2.2 * 1.15)));
  }
});
