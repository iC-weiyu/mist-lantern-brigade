import crypto from 'node:crypto';
import { ensureProtagonist, DEFAULT_PROTAGONIST_NAME } from './protagonist.mjs';
import { ensureFormation, applyFormationBonus, formationRowIndex, FORMATION_ROW_KEYS } from './formation.mjs';

export const SAVE_VERSION = 1;
export const BATTLE_BALANCE = Object.freeze({
  version: 'batch-b-v1',
  playerDamageMultiplier: 1.2,
  enemyDamageMultiplier: 2.0,
});
export const COVER_RULES = Object.freeze({
  version: 'batch-d-cover-v1',
  rowWeights: Object.freeze({ front: 0.60, middle: 0.25, back: 0.15 }),
  attenuation: Object.freeze({ front: 1.00, middle: 0.85, back: 0.70 }),
  appliesTo: 'enemy-ordinary-single-direct',
  bypassTags: Object.freeze(['bypassCover', 'piercing']),
});
export const TUTORIAL_STAGES = [
  { id: 'prologue_1', name: '没有灯的路口', enemyNames: ['雾鬃兽', '雾鬃兽'], level: 1, ticketReward: 10 },
  { id: 'prologue_2', name: '伞下的药箱', enemyNames: ['雾鬃兽', '雾兽头领', '雾鬃兽'], level: 2, ticketReward: 10 },
  { id: 'prologue_3', name: '带他们回去', enemyNames: ['雾兽幼崽', '雾兽头领', '雾兽幼崽'], level: 3, ticketReward: 10 },
  { id: 'old_road_1', name: '旧驿道巡灯', enemyNames: ['失控灯偶', '守灯傀儡', '失控灯偶'], level: 5, ticketReward: 0 },
];
export const MAX_EQUIPMENT = 1000;

const PROLOGUE_STAGE_REQUIREMENTS = {
  prologue_1: { previousStage: null, storyScene: 'before_bridge' },
  prologue_2: { previousStage: 'prologue_1', storyScene: 'before_shelter' },
  prologue_3: { previousStage: 'prologue_2', storyScene: 'before_return' },
  old_road_1: { previousStage: 'prologue_3', storyScene: null },
};

function storyOrder(content) {
  return content.prologue?.integration?.order || content.prologue?.scenes?.map((scene) => scene.id) || [];
}

function storyScene(content, sceneId) {
  return content.prologue?.scenes?.find((scene) => scene.id === sceneId);
}

export function ensureStoryProgress(save, content, legacy = true) {
  save.story ||= {};
  save.story.clearedStages = [...new Set(save.story.clearedStages || [])];
  save.story.claimedRewards = [...new Set(save.story.claimedRewards || [])];
  save.story.archive = [...new Set(save.story.archive || [])];
  const order = storyOrder(content);
  if (!save.story.prologue) {
    const oldSave = legacy && Boolean(save.story.introSeen);
    save.story.prologue = oldSave
      ? { version: content.prologue?.version || '0.2.0', status: 'legacy', currentSceneId: null, nextSceneId: null, beatIndex: 0, completedScenes: [], skippedScenes: [] }
      : { version: content.prologue?.version || '0.2.0', status: 'reading', currentSceneId: order[0] || null, nextSceneId: order[0] || null, beatIndex: 0, completedScenes: [], skippedScenes: [] };
  }
  const progress = save.story.prologue;
  progress.version = content.prologue?.version || progress.version || '0.2.0';
  progress.completedScenes = [...new Set(progress.completedScenes || [])].filter((id) => order.includes(id));
  progress.skippedScenes = [...new Set(progress.skippedScenes || [])].filter((id) => order.includes(id));
  progress.beatIndex = Number.isInteger(progress.beatIndex) && progress.beatIndex >= 0 ? progress.beatIndex : 0;
  if (!['reading', 'idle', 'completed', 'legacy'].includes(progress.status)) progress.status = 'idle';
  if (progress.status === 'reading' && !storyScene(content, progress.currentSceneId)) {
    progress.status = 'idle'; progress.currentSceneId = null; progress.beatIndex = 0;
  }
  if (progress.nextSceneId && !order.includes(progress.nextSceneId)) progress.nextSceneId = null;
  return progress;
}

function canBeginStoryScene(save, content, scene) {
  const progress = ensureStoryProgress(save, content);
  if (!scene || progress.nextSceneId !== scene.id || progress.completedScenes.includes(scene.id)) return false;
  if (scene.requiresScene && !progress.completedScenes.includes(scene.requiresScene)) return false;
  if (scene.trigger === 'after_victory' && !save.story.clearedStages.includes(scene.stageId)) return false;
  return true;
}

export function beginStoryScene(save, content, sceneId) {
  const progress = ensureStoryProgress(save, content);
  const scene = storyScene(content, sceneId);
  if (progress.status === 'legacy' || progress.status === 'completed') throw new Error('当前序章仅可在剧情档案中回看');
  if (!canBeginStoryScene(save, content, scene)) throw new Error('当前剧情段落尚未开放');
  progress.status = 'reading'; progress.currentSceneId = scene.id;
  progress.beatIndex = Math.min(progress.beatIndex, scene.beats.length - 1);
  return { sceneId: scene.id, beatIndex: progress.beatIndex };
}

export function advanceStoryBeat(save, content, sceneId) {
  const progress = ensureStoryProgress(save, content);
  const scene = storyScene(content, sceneId);
  if (!scene || progress.status !== 'reading' || progress.currentSceneId !== sceneId) throw new Error('剧情断点与当前段落不一致');
  if (progress.beatIndex >= scene.beats.length - 1) throw new Error('当前段落已经读到结尾');
  progress.beatIndex += 1;
  return { sceneId, beatIndex: progress.beatIndex };
}

export function finishStoryScene(save, content, sceneId, skipped = false) {
  const progress = ensureStoryProgress(save, content);
  const scene = storyScene(content, sceneId);
  if (!scene || progress.status !== 'reading' || progress.currentSceneId !== sceneId) throw new Error('剧情断点与当前段落不一致');
  if (!skipped && progress.beatIndex !== scene.beats.length - 1) throw new Error('当前段落尚未读完');
  if (!progress.completedScenes.includes(sceneId)) progress.completedScenes.push(sceneId);
  if (skipped && !progress.skippedScenes.includes(sceneId)) progress.skippedScenes.push(sceneId);
  const order = storyOrder(content); const nextSceneId = order[order.indexOf(sceneId) + 1] || null;
  progress.status = nextSceneId ? 'idle' : 'completed';
  progress.currentSceneId = null; progress.nextSceneId = nextSceneId; progress.beatIndex = 0;
  if (sceneId === 'opening') save.story.introSeen = true;
  if (!nextSceneId) {
    save.story.introSeen = true;
    const archiveEntry = `${content.prologue.title}：送药队平安返回，会馆收到第一张回执。`;
    if (!save.story.archive.includes(archiveEntry)) save.story.archive.push(archiveEntry);
  }
  return { sceneId, nextSceneId, nextAction: scene.nextAction, status: progress.status };
}

export function createSave(content) {
  const owned = {};
  const starterIds = ['L01', 'L02', 'L03', 'L04', 'L05'];
  for (const id of starterIds) owned[id] = { level: 1, breakthrough: 0, dupes: 0, investedXp: 0, investedCoins: 0 };
  return {
    version: SAVE_VERSION, updatedAt: new Date().toISOString(), profile: { name: DEFAULT_PROTAGONIST_NAME, protagonist: { level: 1 } },
    currencies: { tickets: 10, coins: 12000, xp: 3000, notes: 10, equipmentDust: 80, contractShards: 0 },
    owned, party: ['L01', 'L02', 'L03', 'L04', 'L05'],
    formation: ['L01', null, null, 'L04', 'protagonist', 'L05', 'L02', 'L03', null],
    collection: { discovered: [...starterIds], new: [...starterIds] },
    gacha: {
      totalPulls: 0, regularPity: 0, beginnerPity: 0, srPity: 0, beginnerPulls: 0,
      commonWishes: ['', '', ''], beginnerWishes: ['', '', ''], pastMode: false,
      selectors: { common: 0, past: 0 }, lastResults: [], lastBatchId: null,
    },
    story: {
      introSeen: false, clearedStages: [], claimedRewards: ['open_door_10'], archive: [],
      prologue: { version: content.prologue?.version || '0.2.0', status: 'reading', currentSceneId: 'opening', nextSceneId: 'opening', beatIndex: 0, completedScenes: [], skippedScenes: [] },
    },
    unlocks: { commonPool: true, beginnerPool: true, themePool: false, autoRepeat: false, equipment: false },
    strategies: Object.fromEntries(content.characters.map((c) => [c.id, 'balanced'])),
    equipment: starterEquipment(), equipped: {}, battle: null, repeatSession: null, repeatSummary: null,
    rngState: crypto.randomBytes(4).readUInt32LE() || 0x6d2b79f5, transactions: {},
  };
}

function ensureCollection(save) {
  const ownedIds = Object.keys(save.owned || {});
  const discovered = new Set([...(save.collection?.discovered || []), ...ownedIds]);
  save.collection = {
    discovered: [...discovered],
    new: [...new Set(save.collection?.new || [])].filter((id) => discovered.has(id)),
  };
  return save.collection;
}

function discoverCharacter(save, characterId, isNew) {
  const collection = ensureCollection(save);
  if (!collection.discovered.includes(characterId)) collection.discovered.push(characterId);
  if (isNew && !collection.new.includes(characterId)) collection.new.push(characterId);
}

function starterEquipment() {
  return ['weapon', 'armor', 'accessory', 'relic', 'weapon'].map((slot, i) => ({
    id: `starter_${i + 1}`, name: ['旧铜短刃', '补缀旅衣', '雾玻璃坠', '旧会馆徽章', '练习短弓'][i],
    setId: i < 2 ? 'E01' : 'E04', slot, rarity: '精良', level: 0, locked: false,
    main: slot === 'armor' ? '生命 +120' : slot === 'weapon' ? '攻击 +12' : '攻击 +4%',
  }));
}

function repeatRewardLedger() {
  return { tickets: 0, coins: 0, xp: 0, notes: 0, equipmentDust: 0, contractShards: 0 };
}

function ensureRepeatState(save) {
  save.repeatSession ||= null;
  save.repeatSummary ||= null;
  if (save.repeatSession) {
    save.repeatSession.reward ||= repeatRewardLedger();
    save.repeatSession.battleIds ||= [];
    save.repeatSession.equipmentIds ||= [];
    save.repeatSession.equipmentDrops ||= [];
    save.repeatSession.wins ||= 0;
    save.repeatSession.losses ||= 0;
    save.repeatSession.onlineMs ||= 0;
  }
  return save;
}

function repeatSummary(session) {
  if (!session) return null;
  const summary = structuredClone(session);
  summary.lastActiveAt = null;
  return summary;
}

function sessionForBattle(save, battle) {
  const session = save.repeatSession;
  return session && battle?.repeatSessionId === session.id ? session : null;
}

function accrueRepeatTime(session, now = Date.now()) {
  if (!session || session.status !== 'active' || session.lastActiveAt == null) return;
  session.onlineMs += Math.max(0, now - session.lastActiveAt);
  session.lastActiveAt = now;
  session.updatedAt = new Date(now).toISOString();
}

function markRepeatPaused(save, reason = '玩家暂停', now = Date.now()) {
  const session = sessionForBattle(save, save.battle);
  if (!session || !['active', 'stopping'].includes(session.status)) return;
  accrueRepeatTime(session, now);
  session.status = 'paused';
  session.pauseReason = reason;
  session.lastActiveAt = null;
  session.updatedAt = new Date(now).toISOString();
}

function markRepeatResumed(save, now = Date.now()) {
  const session = sessionForBattle(save, save.battle);
  if (!session || session.status !== 'paused') return;
  session.status = 'active';
  session.pauseReason = null;
  session.lastActiveAt = now;
  session.updatedAt = new Date(now).toISOString();
}

function closeRepeatSession(save, status, reason, now = Date.now()) {
  const session = sessionForBattle(save, save.battle) || save.repeatSession;
  if (!session || ['completed', 'failed', 'stopped'].includes(session.status)) return;
  if (session.status === 'active') accrueRepeatTime(session, now);
  session.status = status;
  session.reason = reason;
  session.lastActiveAt = null;
  session.updatedAt = new Date(now).toISOString();
  save.repeatSummary = repeatSummary(session);
}

function addRepeatVictory(save, battle, reward, now = Date.now()) {
  const session = sessionForBattle(save, battle);
  if (!session || session.battleIds.includes(battle.id)) return;
  session.battleIds.push(battle.id);
  session.wins += 1;
  for (const key of Object.keys(session.reward)) session.reward[key] += Number(reward[key] || 0);
  if (reward.equipment) {
    session.equipmentIds.push(reward.equipment.id);
    session.equipmentDrops.push({ ...structuredClone(reward.equipment), battleId: battle.id, stageId: battle.stageId, receivedAt: new Date(now).toISOString() });
  }
  session.currentBattleId = null;
  session.updatedAt = new Date(now).toISOString();
}

function addRepeatDefeat(save, battle, now = Date.now()) {
  const session = sessionForBattle(save, battle);
  if (!session || session.battleIds.includes(battle.id)) return;
  session.battleIds.push(battle.id);
  session.losses += 1;
  session.currentBattleId = null;
  session.updatedAt = new Date(now).toISOString();
}

function createRepeatSession(save, stage, now = Date.now()) {
  ensureRepeatState(save);
  if (save.repeatSession && !['completed', 'failed', 'stopped'].includes(save.repeatSession.status)) throw new Error('已有刷关会话正在进行');
  if (save.repeatSession) save.repeatSummary = repeatSummary(save.repeatSession);
  const id = crypto.randomUUID();
  save.repeatSession = {
    id, stageId: stage.id, stageName: stage.name, status: 'active', reason: null, pauseReason: null,
    wins: 0, losses: 0, reward: repeatRewardLedger(), equipmentIds: [], equipmentDrops: [], battleIds: [],
    currentBattleId: null, stopAfterBattle: false, onlineMs: 0, startedAt: new Date(now).toISOString(),
    lastActiveAt: now, updatedAt: new Date(now).toISOString(),
  };
  return save.repeatSession;
}

export function enableRepeatSession(save, now = Date.now()) {
  const battle = save.battle;
  if (!battle || !['active', 'paused'].includes(battle.status)) throw new Error('请先进入一场可继续的战斗');
  if (!save.story.clearedStages.includes(battle.stageId)) throw new Error('首次挑战最高支持 2×，请先完成本关首胜');
  ensureRepeatState(save);
  if (save.repeatSession && !['completed', 'failed', 'stopped'].includes(save.repeatSession.status)) throw new Error('已有刷关会话正在进行');
  const stage = TUTORIAL_STAGES.find((item) => item.id === battle.stageId);
  const session = createRepeatSession(save, stage, now);
  session.currentBattleId = battle.id;
  if (battle.status === 'paused') { session.status = 'paused'; session.lastActiveAt = null; session.pauseReason = '玩家暂停'; }
  battle.repeatSessionId = session.id;
  return session;
}

export function randomFloat(save) {
  let x = save.rngState >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  save.rngState = x >>> 0;
  return save.rngState / 4294967296;
}

function pick(list, save) { return list[Math.floor(randomFloat(save) * list.length)]; }

export function pityRate(counter, base) {
  if (counter < 30) return base;
  return Math.min(1, (counter - 29) * 0.1);
}

function wishPick(save, wishes, share, candidates) {
  const roll = randomFloat(save);
  let cursor = 0;
  for (const wish of wishes) {
    if (wish) {
      cursor += share;
      if (roll < cursor) return wish;
    }
  }
  return pick(candidates, save);
}

function ssrForPool(save, content, pool) {
  const standard = content.characters.filter((c) => c.pool === 'standard').map((c) => c.id);
  const past = content.characters.filter((c) => c.pool === 'past').map((c) => c.id);
  const current = content.characters.filter((c) => c.pool === 'current').map((c) => c.id);
  if (pool === 'common') return wishPick(save, save.gacha.commonWishes, 0.1, standard);
  if (pool === 'beginner') return wishPick(save, save.gacha.beginnerWishes, 0.3, standard);
  const r = randomFloat(save);
  if (save.gacha.pastMode) return r < 0.3 ? pick(standard, save) : pick(past, save);
  if (r < 0.4) return pick(current, save);
  if (r < 0.7) return pick(standard, save);
  return pick(past, save);
}

export function performGacha(save, content, pool, requestedCount, { free = false } = {}) {
  ensureCollection(save);
  if (!['common', 'beginner', 'theme'].includes(pool)) throw new Error('未知招募池');
  if (pool === 'theme' && !save.unlocks.themePool) throw new Error('雨灯归途主题池需完成序章后开放');
  if (!Number.isInteger(requestedCount) || requestedCount < 1) throw new Error('招募数量须为正整数');
  let count = free ? requestedCount : Math.min(requestedCount, save.currencies.tickets);
  if (pool === 'beginner') count = Math.min(count, 40 - save.gacha.beginnerPulls);
  if (count <= 0) throw new Error(pool === 'beginner' ? '新手招募次数已用完或招募券不足' : '招募券不足');
  const low = content.characters.filter((c) => c.pool === 'low');
  const sr = low.filter((c) => c.rarity === 'SR').map((c) => c.id);
  const r = low.filter((c) => c.rarity === 'R').map((c) => c.id);
  const results = [];
  for (let i = 0; i < count; i++) {
    const pityKey = pool === 'beginner' ? 'beginnerPity' : 'regularPity';
    const base = pool === 'beginner' ? 0.1 : 0.05;
    const ssr = randomFloat(save) < pityRate(save.gacha[pityKey], base);
    let rarity; let characterId;
    if (ssr) {
      rarity = 'SSR'; characterId = ssrForPool(save, content, pool); save.gacha[pityKey] = 0; save.gacha.srPity = 0;
    } else {
      save.gacha[pityKey] += 1;
      const guaranteedSr = save.gacha.srPity >= 9;
      const srChance = Math.min(0.15, 1 - pityRate(save.gacha[pityKey] - 1, base));
      if (guaranteedSr || randomFloat(save) < srChance) {
        rarity = 'SR'; characterId = pick(sr, save); save.gacha.srPity = 0;
      } else {
        rarity = 'R'; characterId = pick(r, save); save.gacha.srPity += 1;
      }
    }
    const isNew = !save.owned[characterId];
    if (isNew) save.owned[characterId] = { level: 1, breakthrough: 0, dupes: 0, investedXp: 0, investedCoins: 0 };
    else save.owned[characterId].dupes += 1;
    discoverCharacter(save, characterId, isNew);
    results.push({ characterId, rarity, isNew });
    save.gacha.totalPulls += 1;
    if (pool === 'beginner') save.gacha.beginnerPulls += 1;
    if (save.gacha.totalPulls % 200 === 0) save.gacha.selectors.common += 1;
    if (save.gacha.totalPulls % 500 === 0) save.gacha.selectors.past += 1;
  }
  if (!free) save.currencies.tickets -= count;
  save.gacha.lastResults = results;
  save.gacha.lastBatchId = crypto.randomUUID();
  return results;
}

function equipmentStatBonus(items = []) {
  return items.reduce((sum, item) => {
    if (item.main.startsWith('攻击 +12')) sum.attackFlat += 12;
    if (item.main.startsWith('生命 +120')) sum.hpFlat += 120;
    if (item.main.startsWith('攻击 +4%')) sum.attackPct += 0.04;
    return sum;
  }, { hpFlat: 0, attackFlat: 0, attackPct: 0 });
}

export function calculateCharacterStats(character, owned, equipmentItems = []) {
  if (!character || !owned) throw new Error('角色属性数据无效');
  const equipmentBonus = equipmentStatBonus(equipmentItems);
  const level = owned.level ?? 1;
  const hpAttackGrowth = 1 + 0.02 * (level - 1);
  const defenseGrowth = 1 + 0.01 * (level - 1);
  const b = owned.breakthrough ?? 0;
  const hpBonus = [1, 3, 5, 6].filter((x) => b >= x).length * 0.04;
  const mainBonus = [1, 3, 5, 6].filter((x) => b >= x).length * 0.05;
  const hp = Math.round(character.hp * hpAttackGrowth * (1 + hpBonus) + equipmentBonus.hpFlat);
  const mainIsDefense = character.template === 'T';
  return {
    hp,
    attack: Math.round((character.attack * hpAttackGrowth * (mainIsDefense ? 1 : 1 + mainBonus) + equipmentBonus.attackFlat) * (1 + equipmentBonus.attackPct)),
    defense: Math.round(character.defense * defenseGrowth * (mainIsDefense ? 1 + mainBonus : 1)),
    speed: character.speed,
  };
}

const EQUIPMENT_SLOTS = Object.freeze(['weapon', 'armor', 'accessory', 'relic']);

function equipmentMap(save) {
  const items = new Map((save.equipment || []).map((item) => [item.id, item]));
  const byCharacter = new Map();
  for (const [equipmentId, characterId] of Object.entries(save.equipped || {})) {
    const item = items.get(equipmentId);
    if (!item) continue;
    if (!byCharacter.has(characterId)) byCharacter.set(characterId, {});
    byCharacter.get(characterId)[item.slot] = equipmentId;
  }
  return { items, byCharacter };
}

export function validateEquipmentRelations(save) {
  if (!Array.isArray(save.equipment)) throw new Error('存档装备数据无效');
  const ids = new Set();
  for (const item of save.equipment) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw new Error('存档包含重复装备 ID');
    if (!EQUIPMENT_SLOTS.includes(item.slot)) throw new Error(`存档包含无效装备槽位：${item.id}`);
    ids.add(item.id);
  }
  save.equipped ||= {};
  const occupied = new Set();
  for (const [equipmentId, characterId] of Object.entries(save.equipped)) {
    const item = save.equipment.find((candidate) => candidate.id === equipmentId);
    if (!item || !save.owned?.[characterId]) throw new Error(`存档包含无效穿戴关系：${equipmentId}`);
    const key = `${characterId}:${item.slot}`;
    if (occupied.has(key)) throw new Error(`存档包含同角色重复装备槽：${characterId}/${item.slot}`);
    occupied.add(key);
  }
  return save.equipped;
}

export function equipmentOverview(save, content) {
  validateEquipmentRelations(save);
  const { items, byCharacter } = equipmentMap(save);
  const characterIds = Object.keys(save.owned || {});
  const characters = Object.fromEntries(characterIds.map((characterId) => {
    const character = content.characters.find((candidate) => candidate.id === characterId);
    const owned = save.owned[characterId];
    const idsBySlot = byCharacter.get(characterId) || {};
    const equipmentIds = EQUIPMENT_SLOTS.map((slot) => idsBySlot[slot]).filter(Boolean);
    return [characterId, {
      characterId, name: character?.name || characterId, rarity: character?.rarity || 'R',
      role: character?.role || '', equipmentIds, equipmentBySlot: Object.fromEntries(EQUIPMENT_SLOTS.map((slot) => [slot, idsBySlot[slot] || null])),
      stats: calculateCharacterStats(character, owned, equipmentIds.map((id) => items.get(id))),
    }];
  }));
  const partySet = new Set(save.party || []);
  return {
    party: (save.party || []).map((characterId) => characters[characterId]).filter(Boolean),
    otherCharacterIds: characterIds.filter((characterId) => !partySet.has(characterId)),
    characters,
    battleUsesOpeningSnapshot: Boolean(save.battle && ['active', 'paused'].includes(save.battle.status)),
  };
}

export function updateEquipment(save, content, { equipmentId, targetCharacterId, targetSlot, remove = false }) {
  validateEquipmentRelations(save);
  const { items } = equipmentMap(save);
  const item = items.get(equipmentId);
  if (!item) throw new Error('装备不存在');
  const currentOwner = save.equipped[equipmentId] || null;
  if (remove) {
    if (!currentOwner) throw new Error('该装备当前未穿戴');
    if (targetCharacterId && currentOwner !== targetCharacterId) throw new Error('装备穿戴者已变化，请刷新后重试');
    delete save.equipped[equipmentId];
    return { action: 'unequip', equipmentId, previousCharacterId: currentOwner };
  }
  if (!save.owned?.[targetCharacterId]) throw new Error('尚未招募该角色');
  if (targetSlot && targetSlot !== item.slot) throw new Error('装备槽位不匹配');
  const slot = targetSlot || item.slot;
  const targetOccupant = Object.entries(save.equipped).find(([otherId, owner]) => {
    return owner === targetCharacterId && otherId !== equipmentId && items.get(otherId)?.slot === slot;
  })?.[0] || null;
  if (currentOwner === targetCharacterId && !targetOccupant) {
    return { action: 'noop', equipmentId, characterId: targetCharacterId };
  }
  if (targetOccupant) {
    if (currentOwner) save.equipped[targetOccupant] = currentOwner;
    else delete save.equipped[targetOccupant];
  }
  save.equipped[equipmentId] = targetCharacterId;
  save.unlocks.equipment = true;
  return {
    action: targetOccupant ? (currentOwner ? 'swap' : 'replace') : currentOwner ? 'move' : 'equip',
    equipmentId, characterId: targetCharacterId, previousCharacterId: currentOwner, replacedEquipmentId: targetOccupant,
  };
}

function statDelta(next, current) {
  return Object.fromEntries(['hp', 'attack', 'defense', 'speed'].map((key) => [key, next[key] - current[key]]));
}

export function levelUpCost(level) {
  if (!Number.isInteger(level) || level < 1 || level >= 20) throw new Error('等级不在可升级范围');
  return { xp: 40 + 8 * level + 2 * level * level, coins: 50 + 20 * level + 10 * level * level };
}

function resourceCheck(available, cost) {
  const shortage = Object.fromEntries(Object.keys(cost).map((key) => [key, Math.max(0, cost[key] - (available[key] ?? 0))]));
  const affordable = Object.fromEntries(Object.keys(cost).map((key) => [key, shortage[key] === 0]));
  return { available, cost, shortage, affordable, canAfford: Object.values(affordable).every(Boolean) };
}

export function characterProgressPreview(save, content, characterId) {
  const character = content.characters.find((candidate) => candidate.id === characterId);
  const owned = save.owned[characterId];
  if (!character || !owned) throw new Error('尚未招募该角色');
  const equippedIds = Object.entries(save.equipped).filter(([, owner]) => owner === characterId).map(([equipmentId]) => equipmentId);
  const items = save.equipment.filter((item) => equippedIds.includes(item.id));
  const current = calculateCharacterStats(character, owned, items);
  const nextLevel = owned.level >= 20 ? null : (() => {
    const stats = calculateCharacterStats(character, { ...owned, level: owned.level + 1 }, items);
    const resources = resourceCheck({ xp: save.currencies.xp, coins: save.currencies.coins }, levelUpCost(owned.level));
    return { target: owned.level + 1, stats, delta: statDelta(stats, current), ...resources };
  })();
  const nextBreakthrough = owned.breakthrough >= 7 ? null : (() => {
    const target = owned.breakthrough + 1;
    const stats = calculateCharacterStats(character, { ...owned, breakthrough: target }, items);
    return { target, stats, delta: statDelta(stats, current), skillUpgradePending: [2, 4, 7].includes(target) };
  })();
  return { current, nextLevel, nextBreakthrough, equippedCount: items.length, excludesFormation: true };
}

function unitFromCharacter(character, owned, team, position, equipmentItems = []) {
  const stats = calculateCharacterStats(character, owned, equipmentItems);
  return {
    id: `${team}_${character.id}_${position}`, characterId: character.id, name: character.name, team, position,
    template: character.template, role: character.role, maxHp: stats.hp, hp: stats.hp, attack: stats.attack,
    defense: stats.defense, speed: stats.speed,
    gauge: 0, energy: 30, cooldown: 0, shield: 0, dots: [], attackBuff: 0, damageReduction: 0, alive: true,
  };
}

function enemyUnit(name, level, position, healthScale = 1) {
  const boss = name.includes('头领') || name.includes('傀儡');
  const hp = Math.round((boss ? 1450 : 760) * (1 + level * 0.18) * healthScale);
  return {
    id: `enemy_${position}`, characterId: `enemy_${position}`, name, team: 'enemy', position,
    template: boss ? 'T' : 'A', role: boss ? '首领' : '敌人', maxHp: hp, hp,
    attack: Math.round((boss ? 92 : 70) * (1 + level * 0.12)), defense: Math.round((boss ? 72 : 48) * (1 + level * 0.08)),
    speed: boss ? 970 : 990 + position * 5, gauge: 0, energy: 30, cooldown: 0, shield: 0, dots: [], attackBuff: 0,
    damageReduction: 0, alive: true,
  };
}

export function startBattle(save, content, stageId, { repeat = false, repeatSessionId = null, now = Date.now() } = {}) {
  const stage = TUTORIAL_STAGES.find((x) => x.id === stageId);
  if (!stage) throw new Error('未知战斗关卡');
  ensureRepeatState(save);
  if (save.equipment.length >= MAX_EQUIPMENT) throw new Error('行装室已满，请先处理装备后再继续刷关');
  const requirement = PROLOGUE_STAGE_REQUIREMENTS[stageId];
  if (requirement?.previousStage && !save.story.clearedStages.includes(requirement.previousStage)) throw new Error('请先完成前一段序章战斗');
  const progress = ensureStoryProgress(save, content);
  if (requirement?.storyScene && !['legacy', 'completed'].includes(progress.status) && !progress.completedScenes.includes(requirement.storyScene)) {
    throw new Error('请先阅读本场战斗前的剧情');
  }
  if (save.party.length !== 5) throw new Error('队伍必须有五名角色');
  let session = null;
  if (repeat) {
    if (!save.story.clearedStages.includes(stageId)) throw new Error('首次挑战最高支持 2×，请先完成本关首胜');
    session = repeatSessionId && save.repeatSession?.id === repeatSessionId ? save.repeatSession : createRepeatSession(save, stage, now);
    if (session.stageId !== stageId || !['active', 'stopping'].includes(session.status)) throw new Error('刷关会话与当前关卡不一致');
    session.status = 'active'; session.pauseReason = null; session.lastActiveAt = now; session.updatedAt = new Date(now).toISOString();
  } else if (save.repeatSession && ['active', 'stopping'].includes(save.repeatSession.status)) {
    throw new Error('请先结束当前刷关会话');
  }
  const formation = ensureFormation(save);
  const players = save.party.map((id, i) => {
    const equippedIds = Object.entries(save.equipped).filter(([, owner]) => owner === id).map(([equipmentId]) => equipmentId);
    const items = save.equipment.filter((item) => equippedIds.includes(item.id));
    return applyFormationBonus(unitFromCharacter(content.characters.find((c) => c.id === id), save.owned[id], 'player', i + 1, items), formation.indexOf(id));
  });
  const healthScale = stageId === 'prologue_1' ? 0.55 : stageId.startsWith('prologue_') ? 0.7 : 1;
  const enemies = stage.enemyNames.map((name, i) => enemyUnit(name, stage.level, i + 1, healthScale));
  save.battle = {
    id: crypto.randomUUID(), stageId, stageName: stage.name, seed: save.rngState, status: 'active', actionCount: 0,
    balance: { ...BATTLE_BALANCE },
    metrics: { playerDamage: 0, enemyDamage: 0, playerDotDamage: 0, enemyDotDamage: 0, healing: 0, shieldProvided: 0, shieldAbsorbed: 0, minimumPlayerHpRatio: 1 },
    players, enemies, formation: [...formation],
    positioning: {
      version: COVER_RULES.version,
      appliesTo: COVER_RULES.appliesTo,
      rowWeights: { ...COVER_RULES.rowWeights },
      attenuation: { ...COVER_RULES.attenuation },
      bypassTags: [...COVER_RULES.bypassTags],
    },
    focusId: enemies[0].id, strategy: 'balanced', logs: [`进入「${stage.name}」，行动条开始推进。`], lastEvent: null,
    repeatSessionId: session?.id || null, stopAfterBattle: false,
  };
  if (session) session.currentBattleId = save.battle.id;
  return save.battle;
}

function alive(units) { return units.filter((u) => u.alive); }
function ratio(u) { return u.hp / u.maxHp; }
function lowest(units) { return [...alive(units)].sort((a, b) => ratio(a) - ratio(b))[0]; }
function positioningRules(battle) {
  const rules = battle?.positioning;
  if (!rules || rules.version !== COVER_RULES.version || rules.appliesTo !== COVER_RULES.appliesTo) return null;
  if (!rules.rowWeights || !rules.attenuation) return null;
  return rules;
}

function rowKey(row) { return FORMATION_ROW_KEYS[row] || null; }

function unitFormationRow(battle, unit) {
  if (Number.isInteger(unit.formationCell)) return formationRowIndex(unit.formationCell);
  const cell = battle.formation?.findIndex((id) => id === unit.characterId);
  return cell >= 0 ? formationRowIndex(cell) : null;
}

function hasCoverBypass(actor, skill) {
  if (actor.bypassCover === true || actor.piercing === true) return true;
  if (Array.isArray(actor.coverTags) && actor.coverTags.some((tag) => COVER_RULES.bypassTags.includes(tag))) return true;
  const skillMeta = actor.skills?.[skill] || actor.skillTags?.[skill];
  return skillMeta === 'bypassCover' || skillMeta === 'piercing' || Boolean(skillMeta?.bypassCover || skillMeta?.piercing);
}

function chooseCoveredTarget(battle, opponents, save, rules) {
  const rows = Object.fromEntries(FORMATION_ROW_KEYS.map((key) => [key, []]));
  for (const unit of alive(opponents)) {
    const key = rowKey(unitFormationRow(battle, unit));
    if (key) rows[key].push(unit);
  }
  const available = FORMATION_ROW_KEYS.filter((key) => rows[key].length && Number(rules.rowWeights[key]) > 0);
  if (!available.length) return null;
  const totalWeight = available.reduce((sum, key) => sum + Number(rules.rowWeights[key]), 0);
  let draw = randomFloat(save) * totalWeight;
  let selected = available[available.length - 1];
  for (const key of available) {
    draw -= Number(rules.rowWeights[key]);
    if (draw < 0) { selected = key; break; }
  }
  const candidates = rows[selected].slice().sort((a, b) => (unitFormationRow(battle, a) - unitFormationRow(battle, b)) || a.id.localeCompare(b.id));
  const target = candidates[Math.floor(randomFloat(save) * candidates.length)];
  const frontAlive = rows.front.length > 0;
  return {
    target,
    row: selected,
    frontAlive,
    multiplier: frontAlive ? Number(rules.attenuation[selected] ?? 1) : 1,
  };
}
function battleBalance(battle) {
  return battle.balance || { playerDamageMultiplier: 1, enemyDamageMultiplier: 1 };
}

function damageMultiplier(actor, battle) {
  const balance = battleBalance(battle);
  return actor.team === 'player' ? balance.playerDamageMultiplier : balance.enemyDamageMultiplier;
}

function ensureMetrics(battle) {
  battle.metrics ||= { playerDamage: 0, enemyDamage: 0, playerDotDamage: 0, enemyDotDamage: 0, healing: 0, shieldProvided: 0, shieldAbsorbed: 0, minimumPlayerHpRatio: 1 };
  return battle.metrics;
}

function recordDamage(battle, actor, result, kind = 'direct') {
  const metrics = ensureMetrics(battle);
  const side = actor.team === 'player' ? 'player' : 'enemy';
  metrics[`${side}Damage`] += result.hpDamage;
  if (kind === 'dot') metrics[`${side}DotDamage`] += result.hpDamage;
  metrics.shieldAbsorbed += result.absorbed;
}

function recordMinimumPlayerHp(battle) {
  const metrics = ensureMetrics(battle);
  const players = alive(battle.players);
  if (players.length) metrics.minimumPlayerHpRatio = Math.min(metrics.minimumPlayerHpRatio, ...players.map(ratio));
  else metrics.minimumPlayerHpRatio = 0;
}

function damageAmount(actor, target, coefficient, battle, coverMultiplier = 1) {
  const raw = actor.attack * (1 + actor.attackBuff) * coefficient;
  const mitigation = (110) / (110 + target.defense);
  return Math.max(1, Math.round(raw * mitigation * (1 - target.damageReduction) * damageMultiplier(actor, battle) * coverMultiplier));
}

function applyDamage(target, amount) {
  const absorbed = Math.min(target.shield, amount);
  target.shield -= absorbed;
  const hpDamage = Math.min(target.hp, amount - absorbed);
  target.hp = Math.max(0, target.hp - hpDamage);
  if (target.hp === 0) target.alive = false;
  return { amount, absorbed, hpDamage };
}

function heal(target, amount) {
  const actual = Math.min(amount, target.maxHp - target.hp);
  target.hp += actual;
  return actual;
}

function resolveDots(unit, battle) {
  if (!unit.dots.length || !unit.alive) return;
  const sourceTeam = unit.dots[0]?.sourceTeam || (unit.team === 'player' ? 'enemy' : 'player');
  let total = 0;
  for (const dot of unit.dots) {
    total += Math.max(1, Math.round(dot.amount)); dot.turns -= 1;
  }
  unit.dots = unit.dots.filter((dot) => dot.turns > 0);
  const result = applyDamage(unit, total);
  recordDamage(battle, { team: sourceTeam }, result, 'dot');
  battle.lastEvent.effects.push({ kind: 'dot', targetId: unit.id, ...result });
  battle.logs.push(`${unit.name}受到持续伤害 ${result.hpDamage}${result.absorbed ? `（护盾吸收 ${result.absorbed}）` : ''}。`);
}

function chooseSkill(actor, strategy, allies) {
  const skill = actor.energy >= 100 ? 'U' : actor.cooldown === 0 ? 'A' : 'P';
  if (skill === 'P') return skill;
  if (strategy === 'offense' && skill === 'A' && ['H', 'T', 'S'].includes(actor.template)) return 'P';
  // Keep healing/energy for actual injuries; existing buffs do not need refreshing.
  if (actor.template === 'H' && alive(allies).every(unit => ratio(unit) >= (strategy === 'survive' ? 0.98 : 0.9))) return 'P';
  if (actor.template === 'S' && alive(allies).every(unit => unit.attackBuff >= (skill === 'U' ? 0.2 : 0.15))) return 'P';
  if (actor.template === 'T') {
    const targets = actor.team === 'enemy' && skill === 'A' ? [actor] : alive(allies);
    const amount = actor.defense * (skill === 'U' ? 2.4 : 1.6) * (actor.shieldMultiplier || 1);
    if (targets.every(unit => unit.shield >= Math.min(unit.maxHp * 0.5, amount * 0.75))) return 'P';
  }
  return skill;
}

function executeAction(battle, actor, save) {
  const allies = actor.team === 'player' ? battle.players : battle.enemies;
  const opponents = actor.team === 'player' ? battle.enemies : battle.players;
  const skill = chooseSkill(actor, actor.team === 'player' ? battle.strategy : 'balanced', allies);
  const focus = actor.team === 'player' ? opponents.find((u) => u.id === battle.focusId && u.alive) : null;
  let target = focus ?? lowest(opponents);
  const targets = [];
  const events = [];
  const effects = battle.lastEvent.effects;
  if (!target) return;
  const power = skill === 'U' ? 2.2 : skill === 'A' ? 1.45 : 0.85;
  if (skill === 'U') actor.energy -= 100;

  const directSupport = (actor.template === 'H' || actor.template === 'T' || actor.template === 'S') && skill !== 'P';
  const multiTarget = (['B', 'D'].includes(actor.template) && skill !== 'P') || (skill === 'U' && actor.template === 'V');
  const coverRules = positioningRules(battle);
  const coverChoice = actor.team === 'enemy' && coverRules && !directSupport && !multiTarget && !hasCoverBypass(actor, skill)
    ? chooseCoveredTarget(battle, opponents, save, coverRules)
    : null;
  if (coverChoice) target = coverChoice.target;

  if (actor.template === 'H' && skill !== 'P') {
    const healTargets = skill === 'U' ? alive(allies) : [lowest(allies)];
    for (const ally of healTargets) {
      const actual = heal(ally, Math.round(actor.attack * (skill === 'U' ? 1.8 : 2.2) * (actor.healingMultiplier || 1)));
      ensureMetrics(battle).healing += actual;
      targets.push(ally.id); events.push(`${ally.name}恢复 ${actual}`);
      effects.push({ kind: 'heal', targetId: ally.id, amount: actual });
    }
  } else if (actor.template === 'T' && skill !== 'P') {
    const shieldTargets = actor.team === 'enemy' && skill === 'A' ? [actor] : alive(allies);
    for (const ally of shieldTargets) {
      const amount = Math.round(actor.defense * (skill === 'U' ? 2.4 : 1.6) * (actor.shieldMultiplier || 1));
      const actual = Math.min(Math.round(ally.maxHp * 0.5) - ally.shield, amount);
      ally.shield += actual;
      ensureMetrics(battle).shieldProvided += actual;
      targets.push(ally.id); events.push(`${ally.name}获得护盾 ${actual}`);
      effects.push({ kind: 'shield', targetId: ally.id, amount: actual });
    }
  } else if (actor.template === 'S' && skill !== 'P') {
    for (const ally of alive(allies)) {
      const previous = ally.attackBuff;
      ally.attackBuff = Math.max(ally.attackBuff, skill === 'U' ? 0.2 : 0.15); targets.push(ally.id);
      if (ally.attackBuff > previous) effects.push({ kind: 'buff', targetId: ally.id, amount: ally.attackBuff });
    }
    events.push(`全队攻击提升 ${skill === 'U' ? '20%' : '15%'}`);
  } else {
    const hitTargets = multiTarget ? alive(opponents) : [target];
    for (const victim of hitTargets) {
      const coefficient = actor.template === 'V' ? power * 0.9 : power;
      const victimCover = coverChoice && victim.id === coverChoice.target.id ? coverChoice : null;
      const result = applyDamage(victim, damageAmount(actor, victim, coefficient, battle, victimCover?.multiplier || 1));
      recordDamage(battle, actor, result);
      targets.push(victim.id);
      const coverText = victimCover
        ? victimCover.frontAlive ? `，前排掩护（${{ front: '前排', middle: '中排', back: '后排' }[victimCover.row]}×${victimCover.multiplier.toFixed(2)}）`
          : '，前排已倒下，掩护失效（×1.00）'
        : '';
      events.push(`${victim.name}受到 ${result.hpDamage}${result.absorbed ? `，护盾吸收 ${result.absorbed}` : ''}${coverText}`);
      effects.push({ kind: 'damage', targetId: victim.id, coverMultiplier: victimCover?.multiplier || 1, coverRow: victimCover?.row || null, ...result });
      if (actor.template === 'D' && skill !== 'P' && victim.alive) victim.dots.push({ source: actor.id, sourceTeam: actor.team, amount: actor.attack * 0.12 * damageMultiplier(actor, battle), turns: 3 });
    }
  }
  actor.energy = Math.min(100, actor.energy + 20);
  if (skill === 'A') actor.cooldown = 3;
  else if (actor.cooldown > 0) actor.cooldown -= 1;
  actor.gauge = Math.max(0, actor.gauge - 10000);
  const skillName = skill === 'P' ? '普攻' : skill === 'A' ? '主动技' : '终极技';
  battle.logs.push(`${actor.name}施放${skillName}：${events.join('；')}。`);
  Object.assign(battle.lastEvent, { actorId: actor.id, targetIds: targets, skill, text: events.join('；') });
}

function grantBattleReward(save, content, battle) {
  const stage = TUTORIAL_STAGES.find((x) => x.id === battle.stageId);
  if (save.equipment.length >= MAX_EQUIPMENT) throw new Error('行装室已满，战利品未发放；请先处理装备');
  const first = !save.story.clearedStages.includes(stage.id);
  if (first) {
    save.story.clearedStages.push(stage.id);
    save.currencies.tickets += stage.ticketReward;
    if (stage.id === 'prologue_2') save.unlocks.equipment = true;
    if (stage.id === 'prologue_3') { save.unlocks.themePool = true; save.unlocks.autoRepeat = true; }
  }
  save.currencies.coins += 500 + stage.level * 250;
  save.currencies.xp += 240 + stage.level * 120;
  const sets = stage.id.startsWith('prologue') ? ['E01', 'E04'] : ['E01', 'E02', 'E12'];
  const setId = pick(sets, save);
  const slot = pick(['weapon', 'armor', 'accessory', 'relic'], save);
  const equipment = {
    id: crypto.randomUUID(), name: `${content.equipmentSets.find((s) => s.id === setId)?.name ?? '旅装'}·${{ weapon: '武器', armor: '防具', accessory: '饰品', relic: '遗物' }[slot]}`,
    setId, slot, rarity: stage.level >= 5 && randomFloat(save) < 0.15 ? '传说' : randomFloat(save) < 0.4 ? '史诗' : '精良',
    level: 0, locked: false, main: slot === 'weapon' ? '攻击 +12' : slot === 'armor' ? '生命 +120' : '攻击 +4%',
  };
  save.equipment.push(equipment);
  return { first, tickets: first ? stage.ticketReward : 0, coins: 500 + stage.level * 250, xp: 240 + stage.level * 120, equipment };
}

export function stepBattle(save, content, focusId, strategy, { now = Date.now() } = {}) {
  const battle = save.battle;
  if (!battle || battle.status !== 'active') throw new Error('没有可推进的战斗');
  ensureRepeatState(save);
  const session = sessionForBattle(save, battle);
  if (session) accrueRepeatTime(session, now);
  if (focusId && alive(battle.enemies).some((u) => u.id === focusId)) battle.focusId = focusId;
  if (['balanced', 'offense', 'survive'].includes(strategy)) battle.strategy = strategy;
  const all = [...alive(battle.players), ...alive(battle.enemies)];
  const time = Math.min(...all.map((u) => Math.max(0, 10000 - u.gauge) / u.speed));
  for (const unit of all) unit.gauge = Math.min(10000, unit.gauge + unit.speed * time);
  const ready = all.filter((u) => u.gauge >= 9999.999).sort((a, b) => b.speed - a.speed || a.position - b.position);
  const actor = ready[0];
  battle.lastEvent = { actorId: actor.id, targetIds: [], skill: null, text: '', effects: [] };
  resolveDots(actor, battle);
  if (actor.alive) executeAction(battle, actor, save); else actor.gauge = 0;
  battle.actionCount += 1;
  recordMinimumPlayerHp(battle);
  if (!alive(battle.enemies).length) {
    if (save.equipment.length >= MAX_EQUIPMENT) {
      battle.status = 'stopped'; battle.stopReason = 'backpack_full'; battle.logs.push('行装室已满，未删除或丢弃战利品；刷关已停止。');
      closeRepeatSession(save, 'stopped', '行装室已满', now);
    } else {
      battle.status = 'victory'; battle.reward = grantBattleReward(save, content, battle); battle.logs.push('战斗胜利，结算已保存。');
      addRepeatVictory(save, battle, battle.reward, now);
      if (session?.stopAfterBattle) closeRepeatSession(save, 'completed', '本场结束后汇总', now);
    }
  } else if (!alive(battle.players).length || battle.actionCount >= 300) {
    battle.status = 'defeat'; battle.logs.push(battle.actionCount >= 300 ? '超过 300 次正常行动，判定失败。' : '队伍失去战斗能力。');
    addRepeatDefeat(save, battle, now);
    if (session) closeRepeatSession(save, 'failed', battle.actionCount >= 300 ? '超过行动上限' : '战斗失败', now);
  }
  if (battle.logs.length > 80) battle.logs = battle.logs.slice(-80);
  return battle;
}

export function pauseBattle(save, reason = '玩家暂停', now = Date.now()) {
  if (!save.battle || !['active', 'paused'].includes(save.battle.status)) return save.battle;
  if (save.battle.status === 'active') save.battle.status = 'paused';
  markRepeatPaused(save, reason, now);
  return save.battle;
}

export function resumeBattle(save, now = Date.now()) {
  if (!save.battle || save.battle.status !== 'paused') return save.battle;
  save.battle.status = 'active';
  markRepeatResumed(save, now);
  return save.battle;
}

export function stopAfterBattle(save, now = Date.now()) {
  const battle = save.battle;
  const session = sessionForBattle(save, battle);
  if (!session) return battle;
  session.stopAfterBattle = true;
  if (battle.status === 'victory') closeRepeatSession(save, 'completed', '本场结束后汇总', now);
  else if (battle.status === 'active') session.status = 'active';
  return battle;
}

export function abandonBattle(save, reason = '离开战斗页', now = Date.now()) {
  if (!save.battle) return null;
  const battle = save.battle;
  if (sessionForBattle(save, battle)) closeRepeatSession(save, 'stopped', reason, now);
  battle.status = 'stopped'; battle.stopReason = reason;
  save.battle = null;
  return null;
}

export function suspendInterruptedBattle(save, reason = '刷新或关闭页面中断', now = Date.now()) {
  const battle = save.battle;
  const session = sessionForBattle(save, battle);
  if (!battle || !session || battle.status !== 'active' || session.status !== 'active') return false;
  battle.status = 'paused';
  session.status = 'paused'; session.pauseReason = reason; session.lastActiveAt = null; session.updatedAt = new Date(now).toISOString();
  return true;
}

export function levelUp(save, characterId) {
  const owned = save.owned[characterId];
  if (!owned) throw new Error('尚未招募该角色');
  if (owned.level >= 20) throw new Error('当前首版等级上限为 20');
  const L = owned.level;
  const { xp, coins } = levelUpCost(L);
  if (save.currencies.xp < xp || save.currencies.coins < coins) throw new Error('经验或金币不足');
  save.currencies.xp -= xp; save.currencies.coins -= coins; owned.level += 1;
  owned.investedXp += xp; owned.investedCoins += coins;
  return { level: owned.level, xp, coins };
}

export function breakthrough(save, characterId) {
  const owned = save.owned[characterId];
  if (!owned || owned.dupes < 1) throw new Error('没有可用的同名凭证');
  if (owned.breakthrough >= 7) throw new Error('该角色已经 7 突');
  owned.dupes -= 1; owned.breakthrough += 1; return owned.breakthrough;
}

export function recycleDupe(save, characterId, content) {
  const owned = save.owned[characterId];
  if (!owned || owned.dupes < 1) throw new Error('没有可回收凭证');
  const isSsr = /^(C|N)/.test(characterId);
  owned.dupes -= 1;
  if (isSsr) save.currencies.contractShards += 100;
  else save.currencies.equipmentDust += content.characters.find((c) => c.id === characterId)?.rarity === 'SR' ? 40 : 10;
  return isSsr ? 100 : 0;
}

export function chooseSelector(save, characterId, kind, content) {
  const character = content.characters.find((c) => c.id === characterId);
  if (!character || (kind === 'common' && character.pool !== 'standard') || (kind === 'past' && character.pool !== 'past')) throw new Error('角色不在该自选范围');
  if (save.gacha.selectors[kind] < 1) throw new Error('没有可用自选包');
  save.gacha.selectors[kind] -= 1;
  const isNew = !save.owned[characterId];
  if (isNew) save.owned[characterId] = { level: 1, breakthrough: 0, dupes: 0, investedXp: 0, investedCoins: 0 };
  else save.owned[characterId].dupes += 1;
  discoverCharacter(save, characterId, isNew);
}

export function viewCollectionEntry(save, characterId, content) {
  if (!content.characters.some((character) => character.id === characterId)) throw new Error('图鉴角色不存在');
  const collection = ensureCollection(save);
  collection.new = collection.new.filter((id) => id !== characterId);
  return { characterId };
}

export function buySelector(save, kind) {
  const cost = kind === 'common' ? 500 : 1000;
  if (save.currencies.contractShards < cost) throw new Error('契约碎片不足');
  save.currencies.contractShards -= cost; save.gacha.selectors[kind] += 1;
}

export function validateImportedSave(save, content) {
  if (!save || save.version !== SAVE_VERSION) throw new Error('存档版本不兼容');
  if (!Array.isArray(save.party) || save.party.length !== 5) throw new Error('存档队伍数据无效');
  const ids = new Set(content.characters.map((c) => c.id));
  if (save.party.some((id) => !ids.has(id) || !save.owned[id])) throw new Error('存档包含无效的队伍角色');
  ensureCollection(save);
  ensureStoryProgress(save, content, true);
  ensureProtagonist(save);
  ensureFormation(save);
  validateEquipmentRelations(save);
  save.transactions ||= {};
  ensureRepeatState(save);
  save.gacha.lastBatchId ||= null;
  if (save.battle?.players) {
    for (const unit of save.battle.players) {
      const character = content.characters.find((candidate) => candidate.id === unit.characterId);
      if (character) unit.name = character.name;
    }
  }
  save.collection.discovered = save.collection.discovered.filter((id) => ids.has(id));
  save.collection.new = save.collection.new.filter((id) => ids.has(id) && save.collection.discovered.includes(id));
  return save;
}

export function idempotent(save, txId, operation) {
  if (!txId) throw new Error('请求缺少交易 ID');
  if (save.transactions[txId]) return save.transactions[txId];
  const result = operation();
  save.transactions[txId] = result ?? { ok: true };
  const keys = Object.keys(save.transactions);
  if (keys.length > 300) for (const key of keys.slice(0, keys.length - 300)) delete save.transactions[key];
  return save.transactions[txId];
}
