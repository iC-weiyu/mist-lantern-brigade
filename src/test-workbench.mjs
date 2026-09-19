import { createSave, TUTORIAL_STAGES } from './engine.mjs';

export const TEST_RESOURCES = ['tickets', 'coins', 'xp', 'notes', 'contractShards', 'equipmentDust'];
export function createTestSave(content) {
  const save = createSave(content);
  Object.assign(save.currencies, { tickets: 999, coins: 99999999, contractShards: 9999 });
  save.profile.name = '测试会馆';
  save.story.prologue = { ...save.story.prologue, status: 'completed', currentSceneId: null, nextSceneId: null, backgroundSeen: true, completedScenes: content.prologue.scenes.map(scene => scene.id) };
  save.story.clearedStages = TUTORIAL_STAGES.map(stage => stage.id);
  Object.assign(save.unlocks, { themePool: true, autoRepeat: true, equipment: true });
  return save;
}

export function setTestResources(save, resources) {
  if (!resources || typeof resources !== 'object' || Array.isArray(resources)) throw new Error('资源格式无效');
  const entries = Object.entries(resources);
  if (!entries.length || entries.some(([key, value]) => !TEST_RESOURCES.includes(key) || !Number.isSafeInteger(value) || value < 0 || value > 9999999999)) throw new Error('资源须为 0～9,999,999,999 的整数');
  for (const [key, value] of entries) save.currencies[key] = value;
  return { resources: { ...save.currencies } };
}

export function grantTestCharacter(save, content, characterId, count) {
  const character = content.characters.find(entry => entry.id === characterId);
  if (!character) throw new Error('请选择有效角色');
  if (!Number.isSafeInteger(count) || count < 1 || count > 1000) throw new Error('领取数量须为 1～1000 的整数');
  const isNew = !save.owned[characterId];
  if (isNew) save.owned[characterId] = { level: 1, breakthrough: 0, dupes: count - 1, investedXp: 0, investedCoins: 0 };
  else save.owned[characterId].dupes += count;
  save.collection ||= { discovered: [], new: [] };
  if (!save.collection.discovered.includes(characterId)) save.collection.discovered.push(characterId);
  if (isNew && !save.collection.new.includes(characterId)) save.collection.new.push(characterId);
  return { characterId, name: character.name, count, isNew };
}
