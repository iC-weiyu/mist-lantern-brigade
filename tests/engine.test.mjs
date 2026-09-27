import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContent } from '../src/content.mjs';
import {
  createSave, pityRate, performGacha, startBattle, stepBattle, recycleDupe, chooseSelector,
  viewCollectionEntry, validateImportedSave, beginStoryScene, advanceStoryBeat, finishStoryScene, characterProgressPreview, levelUp,
} from '../src/engine.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const content = loadContent(root);

function unlockFirstBattle(save) {
  save.story.prologue.status = 'idle';
  save.story.prologue.currentSceneId = null;
  save.story.prologue.nextSceneId = 'after_bridge';
  save.story.prologue.completedScenes = ['opening', 'departure', 'before_bridge'];
}

test('content registry contains the complete first-version roster', () => {
  assert.equal(content.characters.filter((c) => c.rarity === 'SSR').length, 34);
  assert.equal(content.characters.filter((c) => c.rarity === 'R').length, 72);
  assert.equal(content.characters.filter((c) => c.rarity === 'SR').length, 56);
  assert.equal(content.characters.length, 162);
  assert.equal(content.characters.filter((c) => c.pool === 'standard').length, 22);
  assert.equal(content.characters.filter((c) => c.pool === 'past').length, 9);
  assert.equal(content.characters.filter((c) => c.pool === 'current').length, 3);
  assert.equal(content.equipmentSets.length, 12);
});

test('common and theme pools keep independent SSR and SR pity counters', () => {
  const save = createSave(content);
  save.unlocks.themePool = true;
  save.gacha.commonPity = 39;
  save.gacha.themePity = 7;
  save.gacha.commonSrPity = 4;
  save.gacha.themeSrPity = 8;
  const common = performGacha(save, content, 'common', 1);
  assert.equal(common[0].rarity, 'SSR');
  assert.equal(save.gacha.commonPity, 0);
  assert.equal(save.gacha.commonSrPity, 0);
  assert.equal(save.gacha.themePity, 7);
  assert.equal(save.gacha.themeSrPity, 8);
  save.gacha.themePity = 39;
  const theme = performGacha(save, content, 'theme', 1);
  assert.equal(theme[0].rarity, 'SSR');
  assert.equal(save.gacha.themePity, 0);
  assert.equal(save.gacha.commonPity, 0);
});

test('legacy shared pity is preserved once into both independent pools', () => {
  const save = createSave(content);
  delete save.gacha.commonPity;
  delete save.gacha.themePity;
  delete save.gacha.commonSrPity;
  delete save.gacha.themeSrPity;
  delete save.gacha.beginnerSrPity;
  save.gacha.regularPity = 23;
  save.gacha.srPity = 6;
  validateImportedSave(save, content);
  assert.equal(save.gacha.commonPity, 23);
  assert.equal(save.gacha.themePity, 23);
  assert.equal(save.gacha.commonSrPity, 6);
  assert.equal(save.gacha.themeSrPity, 6);
  assert.equal(save.gacha.beginnerSrPity, 6);
  assert.equal(save.gacha.pityVersion, 'split-v1');
  assert.equal('regularPity' in save.gacha, false);
  assert.equal('srPity' in save.gacha, false);
});

test('enemy stages use unique cells in a nine-slot formation and grow to a full squad', () => {
  const expectedCounts = { prologue_1: 4, prologue_2: 6, prologue_3: 7, old_road_1: 9 };
  for (const [stageId, expectedCount] of Object.entries(expectedCounts)) {
    const save = createSave(content);
    save.story.prologue.status = 'legacy';
    save.story.clearedStages = ['prologue_1', 'prologue_2', 'prologue_3'];
    const battle = startBattle(save, content, stageId);
    assert.equal(battle.enemies.length, expectedCount);
    assert.equal(new Set(battle.enemies.map((enemy) => enemy.formationCell)).size, expectedCount);
    for (const enemy of battle.enemies) {
      assert.ok(enemy.formationCell >= 0 && enemy.formationCell < 9);
      assert.equal(enemy.formationRank, ['front', 'middle', 'back'][Math.floor(enemy.formationCell / 3)]);
      assert.equal(enemy.formationRow, { front: '前排', middle: '中排', back: '后排' }[enemy.formationRank]);
    }
  }
});

test('SSR display names, aliases, memory notes, and card summaries are applied by stable ID', () => {
  const ssr = content.characters.filter((character) => character.baseRarity === 'SSR');
  assert.equal(ssr.filter((character) => character.oldName !== character.name).length, 38);
  assert.equal(content.characters.find((character) => character.id === 'C01').name, '温照');
  assert.deepEqual(content.characters.find((character) => character.id === 'C01').aliases, ['艾琳']);
  assert.match(content.characters.find((character) => character.id === 'C01').memory, /盾内侧/);
  assert.match(content.characters.find((character) => character.id === 'C01').cardSummary, /护盾/);
  assert.doesNotMatch(content.characters.find((character) => character.id === 'C01').passiveText, /艾琳/);
});

test('prologue progress persists by scene and beat without granting narrative rewards', () => {
  const save = createSave(content); const tickets = save.currencies.tickets;
  assert.equal(save.story.prologue.currentSceneId, 'opening');
  advanceStoryBeat(save, content, 'opening');
  assert.equal(save.story.prologue.beatIndex, 1);
  const resumed = structuredClone(save); validateImportedSave(resumed, content);
  assert.equal(resumed.story.prologue.beatIndex, 1);
  finishStoryScene(resumed, content, 'opening', true);
  assert.equal(resumed.story.prologue.nextSceneId, 'departure');
  beginStoryScene(resumed, content, 'departure');
  finishStoryScene(resumed, content, 'departure', true);
  assert.equal(resumed.currencies.tickets, tickets);
});

test('legacy saves are not forced into the new opening and retain currencies', () => {
  const legacy = createSave(content); legacy.story.introSeen = true; legacy.currencies.tickets = 73; delete legacy.story.prologue;
  validateImportedSave(legacy, content);
  assert.equal(legacy.story.prologue.status, 'legacy');
  assert.equal(legacy.currencies.tickets, 73);
});

test('expanded low-rarity characters reuse a compatible existing skill template', () => {
  const byId = new Map(content.characters.map((character) => [character.id, character]));
  const expanded = content.characters.filter((character) => /^L(?:1[3-9]|[2-9]\d|1[01]\d|120)$/.test(character.id));
  assert.equal(expanded.length, 108);
  for (const character of expanded) {
    const source = byId.get(character.skillTemplateId);
    assert.ok(source, `${character.id} skill source exists`);
    assert.equal(character.rarity, source.rarity);
    assert.equal(character.template, source.template);
  }
});

test('soft pity matches the documented curve', () => {
  assert.equal(pityRate(0, 0.05), 0.05);
  assert.equal(pityRate(29, 0.05), 0.05);
  assert.equal(pityRate(30, 0.05), 0.1);
  assert.equal(pityRate(38, 0.05), 0.9);
  assert.equal(pityRate(39, 0.05), 1);
});

test('beginner pool closes at forty and all pulls count globally', () => {
  const save = createSave(content); save.currencies.tickets = 100;
  performGacha(save, content, 'beginner', 40);
  assert.equal(save.gacha.beginnerPulls, 40);
  assert.equal(save.gacha.totalPulls, 40);
  assert.throws(() => performGacha(save, content, 'beginner', 1), /次数已用完/);
});

test('expanding each low-rarity candidate list does not alter the rarity sequence', () => {
  const legacyLowIds = new Set(Array.from({ length: 12 }, (_, index) => `L${String(index + 1).padStart(2, '0')}`));
  const legacyContent = { ...content, characters: content.characters.filter((character) => character.rarity === 'SSR' || legacyLowIds.has(character.id)) };
  const expandedSave = createSave(content); expandedSave.currencies.tickets = 40;
  const legacySave = createSave(legacyContent); legacySave.currencies.tickets = 40;
  legacySave.rngState = expandedSave.rngState;
  const expandedResults = performGacha(expandedSave, content, 'beginner', 40);
  const legacyResults = performGacha(legacySave, legacyContent, 'beginner', 40);
  assert.deepEqual(expandedResults.map((result) => result.rarity), legacyResults.map((result) => result.rarity));
});

test('each settled gacha batch gets a unique presentation id without consuming game RNG', () => {
  const a = createSave(content); const b = structuredClone(a);
  a.currencies.tickets = 10;
  b.currencies.tickets = 10;
  const first = performGacha(a, content, 'beginner', 10);
  const second = performGacha(b, content, 'beginner', 10);
  assert.deepEqual(first.map((result) => [result.characterId, result.rarity]), second.map((result) => [result.characterId, result.rarity]));
  assert.ok(a.gacha.lastBatchId);
  assert.ok(b.gacha.lastBatchId);
  assert.notEqual(a.gacha.lastBatchId, b.gacha.lastBatchId);
});

test('new low-rarity characters can enter and advance a battle', () => {
  const save = createSave(content);
  unlockFirstBattle(save);
  save.party = ['L13', 'L24', 'L35', 'L46', 'L57'];
  for (const id of save.party) save.owned[id] = { level: 1, breakthrough: 0, dupes: 0, investedXp: 0, investedCoins: 0 };
  startBattle(save, content, 'prologue_1');
  for (let index = 0; index < 20 && save.battle?.status === 'active'; index++) stepBattle(save, content);
  assert.ok(save.battle.actionCount > 0);
  assert.deepEqual(save.battle.players.map((actor) => actor.characterId), save.party);
});

test('collection discovery persists independently from duplicates and recycling', () => {
  const save = createSave(content);
  assert.deepEqual(save.collection.discovered, ['L01', 'L02', 'L03', 'L04', 'L05']);
  save.gacha.selectors.common = 2;
  chooseSelector(save, 'C01', 'common', content);
  assert.ok(save.collection.discovered.includes('C01'));
  assert.ok(save.collection.new.includes('C01'));
  const discoveredCount = save.collection.discovered.length;
  chooseSelector(save, 'C01', 'common', content);
  assert.equal(save.collection.discovered.length, discoveredCount);
  recycleDupe(save, 'C01', content);
  assert.ok(save.collection.discovered.includes('C01'));
  viewCollectionEntry(save, 'C01', content);
  assert.ok(!save.collection.new.includes('C01'));
});

test('legacy saves rebuild discovery from owned characters without inventing NEW flags', () => {
  const legacy = createSave(content);
  delete legacy.collection;
  validateImportedSave(legacy, content);
  assert.deepEqual(new Set(legacy.collection.discovered), new Set(Object.keys(legacy.owned)));
  assert.deepEqual(legacy.collection.new, []);
});

test('same battle seed and decisions produce identical outcomes independent of presentation speed', () => {
  const a = createSave(content); const b = structuredClone(a);
  unlockFirstBattle(a); unlockFirstBattle(b);
  startBattle(a, content, 'prologue_1'); startBattle(b, content, 'prologue_1');
  // Battle IDs are presentation metadata and intentionally differ.
  while (a.battle.status === 'active') stepBattle(a, content, a.battle.focusId, 'balanced');
  while (b.battle.status === 'active') stepBattle(b, content, b.battle.focusId, 'balanced');
  assert.equal(a.battle.status, b.battle.status);
  assert.equal(a.battle.actionCount, b.battle.actionCount);
  assert.deepEqual(a.battle.players.map((u) => [u.hp, u.shield, u.energy]), b.battle.players.map((u) => [u.hp, u.shield, u.energy]));
  assert.equal(a.currencies.tickets, b.currencies.tickets);
});

test('battle supports focus and strategy as explicit next-decision inputs', () => {
  const save = createSave(content);
  unlockFirstBattle(save);
  startBattle(save, content, 'prologue_1');
  const secondEnemy = save.battle.enemies[1].id;
  stepBattle(save, content, secondEnemy, 'survive');
  assert.equal(save.battle.focusId, secondEnemy);
  assert.equal(save.battle.strategy, 'survive');
});

test('all duplicate recycling uses contract shards and leaves equipment dust unchanged', () => {
  const save = createSave(content);
  save.owned.L03.dupes = 1;
  save.owned.L01.dupes = 1;
  save.owned.C01 = { level: 1, breakthrough: 0, dupes: 1, investedXp: 0, investedCoins: 0 };
  const dust = save.currencies.equipmentDust;
  recycleDupe(save, 'L03', content);
  assert.equal(save.currencies.contractShards, 2);
  recycleDupe(save, 'L01', content);
  recycleDupe(save, 'C01', content);
  assert.equal(save.currencies.contractShards, 112);
  assert.equal(save.currencies.equipmentDust, dust);
});

test('equipped main stats are applied to the next battle snapshot', () => {
  const save = createSave(content);
  unlockFirstBattle(save);
  const withoutGear = startBattle(save, content, 'prologue_1').players[0].attack;
  save.battle = null;
  save.equipped.starter_1 = 'L01';
  const withGear = startBattle(save, content, 'prologue_1').players[0].attack;
  assert.equal(withGear, withoutGear + 12);
});

test('character progress preview shares battle stats, includes gear, and excludes formation', () => {
  const save = createSave(content);
  unlockFirstBattle(save);
  save.equipped.starter_1 = 'L04';
  save.formation = ['L01', null, null, 'L05', 'protagonist', null, 'L02', 'L03', 'L04'];
  const preview = characterProgressPreview(save, content, 'L04');
  const battle = startBattle(save, content, 'prologue_1');
  const unit = battle.players.find((candidate) => candidate.characterId === 'L04');
  assert.deepEqual(preview.current, { hp: unit.maxHp, attack: unit.attack, defense: unit.defense, speed: unit.speed });
  assert.equal(preview.equippedCount, 1);
  assert.equal(preview.excludesFormation, true);
  assert.ok(preview.nextLevel.delta.hp > 0);
  assert.ok(preview.nextLevel.delta.attack > 0);
  assert.ok(preview.nextLevel.delta.defense >= 0);
  assert.equal(preview.nextLevel.delta.speed, 0);
  assert.deepEqual(preview.nextLevel.cost, { xp: 50, coins: 80 });
  assert.deepEqual(preview.nextLevel.shortage, { xp: 0, coins: 0 });
  assert.equal(preview.nextLevel.canAfford, true);
});

test('batch B uses non-compounding partner growth and snapshots the battle balance', () => {
  const save = createSave(content);
  const character = content.characters.find((candidate) => candidate.id === 'L04');
  const owned = save.owned.L04;
  const levelOne = characterProgressPreview(save, content, 'L04').current;
  owned.level = 10;
  const levelTen = characterProgressPreview(save, content, 'L04').current;
  assert.equal(levelTen.hp, Math.round(character.hp * 1.18));
  assert.equal(levelTen.attack, Math.round(character.attack * 1.18));
  assert.equal(levelTen.defense, Math.round(character.defense * 1.09));
  assert.equal(levelTen.speed, levelOne.speed);

  const fresh = createSave(content);
  unlockFirstBattle(fresh);
  const battle = startBattle(fresh, content, 'prologue_1');
  assert.deepEqual(battle.balance, { version: 'batch-b-v1', playerDamageMultiplier: 1.2, enemyDamageMultiplier: 2 });
  assert.deepEqual(battle.metrics, { playerDamage: 0, enemyDamage: 0, playerDotDamage: 0, enemyDotDamage: 0, healing: 0, shieldProvided: 0, shieldAbsorbed: 0, minimumPlayerHpRatio: 1 });
});

test('an in-progress legacy battle without balance metadata keeps the old damage scale', () => {
  const candidate = createSave(content);
  const legacy = structuredClone(candidate);
  const setup = (save, legacyBalance = false) => {
    unlockFirstBattle(save);
    startBattle(save, content, 'prologue_1');
    if (legacyBalance) delete save.battle.balance;
    for (const unit of [...save.battle.players, ...save.battle.enemies]) unit.gauge = 0;
    const actor = save.battle.players.find((unit) => unit.characterId === 'L04');
    actor.gauge = 10000;
    stepBattle(save, content, save.battle.enemies[0].id);
    return save.battle.lastEvent.effects.find((effect) => effect.kind === 'damage').amount;
  };
  const candidateAmount = setup(candidate);
  const legacyAmount = setup(legacy, true);
  assert.ok(candidateAmount > legacyAmount);
  assert.ok(Math.abs(candidateAmount / legacyAmount - 1.2) < 0.02);
});

test('level preview and level-up share the documented cost calculation and expose independent shortages', () => {
  const save = createSave(content);
  save.currencies.xp = 30;
  save.currencies.coins = 100;
  const preview = characterProgressPreview(save, content, 'L01');
  assert.deepEqual(preview.nextLevel.cost, { xp: 50, coins: 80 });
  assert.deepEqual(preview.nextLevel.available, { xp: 30, coins: 100 });
  assert.deepEqual(preview.nextLevel.shortage, { xp: 20, coins: 0 });
  assert.deepEqual(preview.nextLevel.affordable, { xp: false, coins: true });
  assert.equal(preview.nextLevel.canAfford, false);
  const before = structuredClone(save);
  assert.throws(() => levelUp(save, 'L01'), /经验或金币不足/);
  assert.deepEqual(save.currencies, before.currencies);
  save.currencies.xp = 50;
  const result = levelUp(save, 'L01');
  assert.deepEqual(result, { level: 2, xp: 50, coins: 80 });
  assert.deepEqual(save.currencies, { ...before.currencies, xp: 0, coins: 20 });
});

test('breakthrough preview reports only implemented stat nodes and explicit caps', () => {
  const save = createSave(content);
  let preview = characterProgressPreview(save, content, 'L01');
  assert.equal(preview.nextBreakthrough.target, 1);
  assert.equal(preview.nextBreakthrough.skillUpgradePending, false);
  assert.ok(preview.nextBreakthrough.delta.hp > 0);
  save.owned.L01.breakthrough = 1;
  preview = characterProgressPreview(save, content, 'L01');
  assert.equal(preview.nextBreakthrough.target, 2);
  assert.equal(preview.nextBreakthrough.skillUpgradePending, true);
  assert.deepEqual(preview.nextBreakthrough.delta, { hp: 0, attack: 0, defense: 0, speed: 0 });
  save.owned.L01.level = 20; save.owned.L01.breakthrough = 7;
  preview = characterProgressPreview(save, content, 'L01');
  assert.equal(preview.nextLevel, null);
  assert.equal(preview.nextBreakthrough, null);
});
