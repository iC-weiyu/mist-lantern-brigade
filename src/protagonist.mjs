// The protagonist has a separate growth record, not a sixth battle unit.
const BASE = { hp: 850, attack: 102, defense: 51, speed: 1000 };
const MILESTONES = [
  { id: 'first_lantern', stageId: 'prologue_1', name: '点亮第一盏灯', bonus: .10 },
  { id: 'first_receipt', stageId: 'prologue_3', name: '护送队伍归来', bonus: .25 },
];

export const DEFAULT_PROTAGONIST_NAME = '浪人';
export const PROTAGONIST_NAME_LIMIT = 12;

export function ensureProtagonist(save) {
  save.profile ||= { name: DEFAULT_PROTAGONIST_NAME };
  save.profile.protagonist ||= { level: 1 };
  const level = save.profile.protagonist.level;
  if (!Number.isSafeInteger(level) || level < 1) throw new Error('主角等级数据无效');
  return save.profile.protagonist;
}

// 序章开场由玩家给"我"取名：去掉控制字符、限长，并记下"已经取过名"，保证只问一次。
export function setProtagonistName(save, rawName) {
  const name = String(rawName ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, PROTAGONIST_NAME_LIMIT);
  if (!name) throw new Error(`请先给主角取个名字（1～${PROTAGONIST_NAME_LIMIT} 个字）`);
  ensureProtagonist(save);
  save.profile.name = name;
  save.profile.nameConfirmed = true;
  return { name };
}

export function protagonistSummary(save) {
  if (!save) return null;
  const level = save.profile?.protagonist?.level || 1;
  const cleared = new Set(save.story?.clearedStages || []);
  const milestones = MILESTONES.map((entry) => ({ ...entry, unlocked: cleared.has(entry.stageId) }));
  const storyBonus = milestones.reduce((total, entry) => total + (entry.unlocked ? entry.bonus : 0), 0);
  // Same early level curve as companions, with no content-level ceiling.
  const factor = (1 + 5 * (level - 1) / 79) * (1 + storyBonus);
  return {
    name: save.profile?.name || DEFAULT_PROTAGONIST_NAME,
    nameConfirmed: Boolean(save.profile?.nameConfirmed),
    level, initialRarity: 'SR',
    hp: Math.round(BASE.hp * factor), attack: Math.round(BASE.attack * factor),
    defense: Math.round(BASE.defense * factor), speed: BASE.speed,
    storyBonus: Math.round(storyBonus * 100), milestones,
  };
}
