import fs from 'node:fs';
import path from 'node:path';
import { STARTER_PROFILES } from './starter-profiles.mjs';
import { withPositioning } from './positioning.mjs';

const TEMPLATE_STATS = {
  A: { hp: 1000, attack: 120, defense: 60, role: '单体输出' },
  B: { hp: 1080, attack: 100, defense: 65, role: '群体输出' },
  D: { hp: 1100, attack: 95, defense: 65, role: '持续伤害' },
  T: { hp: 1600, attack: 55, defense: 110, role: '保护' },
  H: { hp: 1150, attack: 90, defense: 75, role: '治疗' },
  S: { hp: 1100, attack: 85, defense: 75, role: '支援' },
  V: { hp: 950, attack: 75, defense: 60, role: '高速专精' },
};

const THEMES = [
  { id: 'standard', name: '雾港常驻', characterIds: range('C', 1, 30) },
  { id: 'past_banquet', name: '绯月晚宴', characterIds: range('C', 31, 33) },
  { id: 'past_stars', name: '星轨观测', characterIds: range('C', 34, 36) },
  { id: 'past_forest', name: '森夜茶会', characterIds: range('C', 37, 39) },
  { id: 'current_rain', name: '雨灯归途', characterIds: ['N40', 'N41', 'N42'] },
];

function range(prefix, start, end) {
  return Array.from({ length: end - start + 1 }, (_, i) => `${prefix}${String(start + i).padStart(2, '0')}`);
}

function sectionOf(id) {
  const n = Number(id.slice(1));
  if (id.startsWith('N')) return 'current';
  if (id.startsWith('L')) return 'low';
  if (n <= 30) return 'standard';
  return 'past';
}

function parseSsr(markdown) {
  const heading = /^###\s+((?:C|N)\d{2})\s+([^｜\r\n]+)｜([^｜\r\n]+)｜([^\r\n]+)$/gm;
  const matches = [...markdown.matchAll(heading)];
  return matches.map((match, index) => {
    const block = markdown.slice(match.index + match[0].length, matches[index + 1]?.index ?? markdown.indexOf('## R/SR 过渡角色'));
    const look = block.match(/- 外观：([^\r\n]+?)。模板\s+([ABDHSTV])，速度\s+(\d+)/);
    const skills = block.match(/- P：([^\r\n]+?)(?=\n- T：|\r\n- T：)/)?.[1] ?? '';
    const passive = block.match(/- T：([^\r\n]+)/)?.[1] ?? '';
    const breakthrough = block.match(/- 突破\s+2：([^\r\n]+)/)?.[1] ?? '';
    if (!look) throw new Error(`角色 ${match[1]} 缺少可解析的模板或速度`);
    const template = look[2];
    return {
      id: match[1], name: match[2].trim(), gender: match[3].trim(), title: match[4].trim(),
      rarity: 'SSR', pool: sectionOf(match[1]), template, speed: Number(look[3]),
      appearance: look[1].trim(), skillText: skills.trim(), passiveText: passive.trim(),
      breakthroughText: breakthrough.trim(), ...TEMPLATE_STATS[template],
    };
  });
}

function parseSsrProfiles(markdown) {
  const rows = markdown.split(/\r?\n/).filter((line) => /^\| (?:C|N)\d{2} \|/.test(line));
  const profiles = rows.map((line) => {
    const [id, title, oldName, name, namingType, memory] = line.split('|').slice(1, -1).map((cell) => cell.trim());
    return { id, title, oldName, name, namingType, memory };
  });
  if (profiles.length !== 42) throw new Error(`SSR 命名表必须包含 42 人，当前为 ${profiles.length}`);
  if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) throw new Error('SSR 命名表包含重复 ID');
  if (new Set(profiles.map((profile) => profile.name)).size !== profiles.length) throw new Error('SSR 新显示名必须唯一');
  const changed = profiles.filter((profile) => profile.oldName !== profile.name).length;
  if (changed !== 38) throw new Error(`SSR 命名表应为 38 人换名、4 人保留，当前换名 ${changed} 人`);
  return new Map(profiles.map((profile) => [profile.id, profile]));
}

function applySsrProfiles(characters, profiles) {
  return characters.map((character) => {
    const profile = profiles.get(character.id);
    if (!profile) throw new Error(`SSR 命名表缺少角色 ${character.id}`);
    if (profile.title !== character.title) throw new Error(`角色 ${character.id} 的称号与原始设定不一致`);
    if (profile.oldName !== character.name) throw new Error(`角色 ${character.id} 的旧名与原始设定不一致`);
    const rename = (value) => value ? value.split(profile.oldName).join(profile.name) : value;
    return {
      ...character,
      name: profile.name,
      oldName: profile.oldName,
      aliases: profile.oldName === profile.name ? [] : [profile.oldName],
      namingType: profile.namingType,
      memory: profile.memory,
      appearance: rename(character.appearance),
      skillText: rename(character.skillText),
      passiveText: rename(character.passiveText),
      breakthroughText: rename(character.breakthroughText),
    };
  });
}

function applyCardSummaries(rootDir, characters) {
  const payload = JSON.parse(fs.readFileSync(path.join(rootDir, '规划补充', 'SSR卡面摘要_v0.3.json'), 'utf8'));
  if (payload.version !== '0.3.0' || !Array.isArray(payload.characters) || payload.characters.length !== 42) {
    throw new Error('SSR 卡面摘要必须是 v0.3.0 且包含 42 人');
  }
  const summaries = new Map(payload.characters.map((entry) => [entry.id, entry]));
  const lowSummary = {
    A: ['单体', '集中攻击一个目标，适合尽快减少敌人数。'], B: ['群攻', '攻击多个敌人，适合处理成群目标。'],
    D: ['持续伤害', '叠加持续伤害，让压力逐步累积。'], T: ['保护', '承受火力并为队友提供防护。'],
    H: ['治疗', '照顾低血量伙伴，稳定队伍状态。'], S: ['支援', '强化队友，让关键行动更有效。'],
  };
  return characters.map((character) => {
    const entry = summaries.get(character.id);
    if (character.rarity === 'SSR') {
      if (!entry || !Array.isArray(entry.tags) || !entry.summary) throw new Error(`SSR 卡面摘要缺少 ${character.id}`);
      return { ...character, cardTags: entry.tags, cardSummary: entry.summary };
    }
    const [tag, summary] = lowSummary[character.template] || [character.role, character.skillText];
    return { ...character, cardTags: [tag], cardSummary: summary };
  });
}

function parseLow(markdown) {
  const table = markdown.slice(markdown.indexOf('| L01 |'), markdown.indexOf('开局赠送 L01'));
  return table.split(/\r?\n/).filter((line) => /^\| L\d{2,3} \|/.test(line)).map((line) => {
    const cells = line.split('|').map((x) => x.trim()).filter(Boolean);
    const id = cells[0];
    const [name, gender] = cells[1].split('/');
    const [rarity, template] = cells[2].split('/');
    const factor = rarity === 'SR' ? 0.85 : 0.75;
    const base = TEMPLATE_STATS[template];
    return {
      id, name, gender, title: `${rarity}旅团成员`, rarity, pool: 'low', template, speed: 1000,
      appearance: '序章过渡角色，使用简洁姓名卡。', skillText: cells[3], passiveText: cells[3].split('/').at(-1),
      breakthroughText: '每次突破提升生命与主职能属性 3%。', role: base.role,
      hp: Math.round(base.hp * factor), attack: Math.round(base.attack * factor), defense: Math.round(base.defense * factor),
    };
  });
}

function parseLowExpansion(rootDir, baseLow) {
  const expansionPath = path.join(rootDir, '规划补充', '低稀有度角色扩充_v0.1.json');
  const payload = JSON.parse(fs.readFileSync(expansionPath, 'utf8'));
  if (payload.mode !== 'append' || !Array.isArray(payload.characters)) throw new Error('低稀有度扩充必须是 append 角色列表');
  const sources = new Map(baseLow.map((character) => [character.id, character]));
  return payload.characters.map((raw) => {
    if (!/^L\d{2,3}$/.test(raw.id)) throw new Error(`低稀有度扩充 ID 无效：${raw.id}`);
    if (!['R', 'SR'].includes(raw.rarity)) throw new Error(`低稀有度扩充稀有度无效：${raw.id}`);
    if (!TEMPLATE_STATS[raw.template] || raw.template === 'V') throw new Error(`低稀有度扩充模板无效：${raw.id}`);
    const source = sources.get(raw.skillTemplateId);
    if (!source) throw new Error(`角色 ${raw.id} 引用了不存在的技能模板 ${raw.skillTemplateId}`);
    if (source.rarity !== raw.rarity || source.template !== raw.template) throw new Error(`角色 ${raw.id} 的技能模板与稀有度或职能不匹配`);
    for (const key of ['hp', 'attack', 'defense', 'speed']) {
      if (!Number.isInteger(raw[key]) || raw[key] <= 0) throw new Error(`角色 ${raw.id} 的 ${key} 无效`);
    }
    return {
      id: raw.id, name: raw.name, gender: raw.gender, title: raw.title,
      rarity: raw.rarity, pool: 'low', template: raw.template, skillTemplateId: raw.skillTemplateId,
      speed: raw.speed, hp: raw.hp, attack: raw.attack, defense: raw.defense,
      role: raw.role || TEMPLATE_STATS[raw.template].role,
      appearance: raw.appearance, skillText: raw.skillText || source.skillText,
      passiveText: raw.passiveText || source.passiveText,
      breakthroughText: raw.breakthroughText || source.breakthroughText,
    };
  });
}

function parseEquipmentSets(markdown) {
  const table = markdown.slice(markdown.indexOf('| E01 游锋'), markdown.indexOf('套装同名同源'));
  return table.split(/\r?\n/).filter((line) => /^\| E\d{2}/.test(line)).map((line) => {
    const cells = line.split('|').map((x) => x.trim()).filter(Boolean);
    const [id, ...name] = cells[0].split(' ');
    return { id, name: name.join(' '), twoPiece: cells[1], fourPiece: cells[2] };
  });
}

function loadPrologue(rootDir) {
  const prologuePath = path.join(rootDir, '规划补充', '序章演出脚本_v0.2.json');
  const prologue = JSON.parse(fs.readFileSync(prologuePath, 'utf8'));
  if (prologue.version !== '0.2.0' || !Array.isArray(prologue.scenes)) throw new Error('序章脚本版本或场景列表无效');
  const sceneIds = prologue.scenes.map((scene) => scene.id);
  if (new Set(sceneIds).size !== sceneIds.length) throw new Error('序章脚本包含重复场景 ID');
  if (prologue.integration?.order?.join('|') !== sceneIds.join('|')) throw new Error('序章场景顺序与 integration.order 不一致');
  for (const scene of prologue.scenes) {
    if (!scene.title || !scene.trigger || !scene.nextAction || !Array.isArray(scene.beats) || !scene.beats.length) {
      throw new Error(`序章场景 ${scene.id} 缺少必要字段`);
    }
  }
  return prologue;
}

export function loadContent(rootDir) {
  const roleDoc = fs.readFileSync(path.join(rootDir, '角色设计_v0.1.md'), 'utf8');
  const designDoc = fs.readFileSync(path.join(rootDir, '设计方案_v0.1.md'), 'utf8');
  const namingDoc = fs.readFileSync(path.join(rootDir, '规划补充', 'SSR命名与人物记忆点_v0.2.md'), 'utf8');
  const baseLow = parseLow(roleDoc);
  const ssrProfiles = parseSsrProfiles(namingDoc);
  const characters = applyCardSummaries(rootDir, [...applySsrProfiles(parseSsr(roleDoc), ssrProfiles), ...baseLow, ...parseLowExpansion(rootDir, baseLow)]).map((character) => {
    const profile = STARTER_PROFILES.find((entry) => entry.id === character.id);
    return withPositioning(profile ? { ...character, ...profile, aliases: [profile.oldName] } : character);
  });
  const equipmentSets = parseEquipmentSets(designDoc);
  const prologue = loadPrologue(rootDir);
  const ids = characters.map((x) => x.id);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicates.length) throw new Error(`重复角色 ID：${duplicates.join(', ')}`);
  if (characters.filter((x) => x.rarity === 'SSR').length !== 42) throw new Error('SSR 注册数量必须为 42');
  if (characters.filter((x) => x.rarity === 'R').length !== 72) throw new Error('R 注册数量必须为 72');
  if (characters.filter((x) => x.rarity === 'SR').length !== 48) throw new Error('SR 注册数量必须为 48');
  if (characters.length !== 162) throw new Error('角色注册总数必须为 162');
  if (equipmentSets.length !== 12) throw new Error('装备套装注册数量必须为 12');
  for (const theme of THEMES) for (const id of theme.characterIds) {
    if (!ids.includes(id)) throw new Error(`主题 ${theme.id} 引用了不存在的角色 ${id}`);
  }
  return { version: '0.2.0', characters, equipmentSets, themes: THEMES, templates: TEMPLATE_STATS, prologue };
}
