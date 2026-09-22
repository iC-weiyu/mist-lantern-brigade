import { roleCrestArt, cardBackArt, cardEdgeLightning } from './card-art.js';
import { buildAutoTeam } from './auto-team.js';
import { BATTLE_ACTION_MS, playBattleEffects, clearBattleEffects } from './battle-fx.js';

const app = document.querySelector('#app');
const clientId = sessionStorage.getItem('mist-lantern-tab-client') || crypto.randomUUID();
sessionStorage.setItem('mist-lantern-tab-client', clientId);

let model = null;
let view = 'home';
let pool = 'beginner';
let speed = Number(sessionStorage.getItem('mist-speed') || 1);
if (![1, 2, 3, 5].includes(speed)) speed = 1;
let focusId = null;
let strategy = 'balanced';
let storyPage = 0;
let pending = false;
let queuedStopAfter = false;
let timer = null;
let autoRepeat = sessionStorage.getItem('mist-auto-repeat') === 'true';
let gachaPresentation = null;
let gachaTimers = [];
let gachaRaf = null;
const systemReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let gachaMode = localStorage.getItem('mist-gacha-mode') || (systemReduceMotion ? 'direct' : 'full');
let gachaSound = localStorage.getItem('mist-gacha-sound') !== 'off';
let gachaReduceMotion = localStorage.getItem('mist-gacha-reduce') === 'true' || systemReduceMotion;
let audioContext = null;
let rainEnabled = localStorage.getItem('mist-rain') !== 'off';
let bgmEnabled = localStorage.getItem('mist-bgm') !== 'off';
let bgmVolume = Number(localStorage.getItem('mist-bgm-volume') ?? 55);
if (!Number.isFinite(bgmVolume) || bgmVolume < 0 || bgmVolume > 100) bgmVolume = 55;
let goldSfx = null;
let hallMusic = null;
let hallMusicState = 'idle';   // idle：未检查 | probing：检查中 | ready：已载入 | missing：没有文件
let hallMusicGapTimer = null;
let rainAudio = null;
let rainFadeTimer = null;
let rainUnlockBound = false;
let rainActive = false;
let thunderTimer = null;
let thunderFlashTimer = null;
let titleFocusSelector = null;
let collectionSearch = '';
let collectionRarity = 'all';
let collectionRole = 'all';
let collectionOwned = 'all';
let collectionGroup = 'all';
let collectionUnownedFirst = false;
let collectionSort = 'rarity';
let collectionDetailId = null;
let storyDisplayBeat = null;
let storyReplay = null;
let storyArchiveOpen = false;
let clockOffset = 0;
let freeRefreshing = false;
let freeRetryAt = 0;
let gachaTransition = null;
const commonReveals = new Map();
let arrivalAnimations = [];
let partyDraft = null;
let formationDraft = null;
let formationSelection = null;
let formationDrag = null;
let suppressFormationClick = false;
let deleteSlotId = null;
let equipmentSlotFilter = 'all';
let equipmentRarityFilter = 'all';
let equipmentSetFilter = 'all';
let equipmentUnwornFirst = true;
let equipmentTargetId = null;
let equipmentOtherOpen = false;
let equipmentSelection = null;
let equipmentDrag = null;
let titlePanel = null;      // 初始界面内的存档面板：null | 'slots'
let newSaveSlotId = null;   // “新建存档”命名弹窗锁定的档位
let quitConfirm = false;    // “退出游戏”确认弹窗
let quitState = false;      // 已退出：停雨声并显示告别画面

const pageTitles = {
  workbench: ['测试工作台', '独立沙盒'],
  home: ['会馆总览', '第一盏灯'], battle: ['冒险', '旧驿道'], recruit: ['招募', '契约册'], roster: ['角色与编队', '旅团名册'],
  collection: ['角色图鉴', '会馆藏册'], equipment: ['装备', '行装室'], settings: ['设置', '本地档案'], slots: ['选择存档', '三份旅团手记'],
};

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}
function formatAmount(value) { return Number(value ?? 0).toLocaleString('zh-CN'); }
function storyText(value = '') { return esc(value).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'); }
function char(id) { return model.content.characters.find((c) => c.id === id); }
function equipmentSet(id) { return model.content.equipmentSets.find((s) => s.id === id); }
function equipmentSlotName(slot) { return ({ weapon: '武器', armor: '防具', accessory: '饰品', relic: '遗物' }[slot] || slot); }
function tx() { return crypto.randomUUID(); }
function prologueScene(id) { return model.content.prologue?.scenes?.find((scene) => scene.id === id); }
function prologueProgress() { return model?.save?.story?.prologue || {}; }
// 序章开场由玩家给"我"取的名字；未取名时退回占位称呼。
function heroName() { return model?.protagonist?.name || '主角'; }

const equipmentSlots = ['weapon', 'armor', 'accessory', 'relic'];
function equipmentById(id) { return model.save.equipment.find((item) => item.id === id); }
function equipmentWearer(id) { return model.save.equipped?.[id] || null; }
function equipmentInfo(id) { return model.equipmentState?.characters?.[id]; }
function equipmentIdsForCharacter(id, equipped = model.save.equipped || {}) {
  return Object.entries(equipped).filter(([, owner]) => owner === id).map(([equipmentId]) => equipmentId);
}
function equipmentPreviewStats(characterId, equipmentIds) {
  const character = char(characterId); const owned = model.save.owned[characterId];
  if (!character || !owned) return null;
  const bonus = equipmentIds.map(equipmentById).filter(Boolean).reduce((sum, item) => {
    if (item.main?.startsWith('攻击 +12')) sum.attackFlat += 12;
    if (item.main?.startsWith('生命 +120')) sum.hpFlat += 120;
    if (item.main?.startsWith('攻击 +4%')) sum.attackPct += 0.04;
    return sum;
  }, { hpFlat: 0, attackFlat: 0, attackPct: 0 });
  const growth = 1 + 0.02 * ((owned.level ?? 1) - 1); const defenseGrowth = 1 + 0.01 * ((owned.level ?? 1) - 1);
  const breakthrough = owned.breakthrough ?? 0; const breaks = [1, 3, 5, 6].filter((value) => breakthrough >= value).length;
  const hp = Math.round(character.hp * growth * (1 + breaks * 0.04) + bonus.hpFlat);
  const mainIsDefense = character.template === 'T';
  return {
    hp,
    attack: Math.round((character.attack * growth * (mainIsDefense ? 1 : 1 + breaks * 0.05) + bonus.attackFlat) * (1 + bonus.attackPct)),
    defense: Math.round(character.defense * defenseGrowth * (mainIsDefense ? 1 + breaks * 0.05 : 1)),
    speed: character.speed,
  };
}
function equipmentDelta(next, current) { return Object.fromEntries(['hp', 'attack', 'defense', 'speed'].map((key) => [key, (next?.[key] ?? 0) - (current?.[key] ?? 0)])); }
function equipmentPreview(equipmentId, targetCharacterId, targetSlot, remove = false) {
  const item = equipmentById(equipmentId); if (!item) return [];
  const equipped = { ...(model.save.equipped || {}) }; const currentOwner = equipped[equipmentId] || null;
  const affected = new Set([targetCharacterId, currentOwner].filter(Boolean));
  if (remove) delete equipped[equipmentId];
  else {
    const occupant = Object.entries(equipped).find(([otherId, owner]) => owner === targetCharacterId && otherId !== equipmentId && equipmentById(otherId)?.slot === (targetSlot || item.slot))?.[0];
    if (occupant) { affected.add(equipped[occupant]); if (currentOwner) equipped[occupant] = currentOwner; else delete equipped[occupant]; }
    equipped[equipmentId] = targetCharacterId;
  }
  return [...affected].map((characterId) => {
    const info = equipmentInfo(characterId); const beforeIds = equipmentIdsForCharacter(characterId); const afterIds = equipmentIdsForCharacter(characterId, equipped);
    const current = info?.stats || equipmentPreviewStats(characterId, beforeIds); const next = equipmentPreviewStats(characterId, afterIds);
    return { characterId, name: char(characterId)?.name || characterId, current, next, delta: equipmentDelta(next, current), beforeIds, afterIds };
  });
}
function signedStat(value) { return value > 0 ? `+${value}` : String(value); }
function equipmentStatLine(stats, delta = null) {
  if (!stats) return '';
  return `<span class="equipment-stat-line"><span>生命 ${stats.hp}${delta ? ` <b class="${delta.hp >= 0 ? 'up' : 'down'}">${signedStat(delta.hp)}</b>` : ''}</span><span>攻击 ${stats.attack}${delta ? ` <b class="${delta.attack >= 0 ? 'up' : 'down'}">${signedStat(delta.attack)}</b>` : ''}</span><span>防御 ${stats.defense}${delta ? ` <b class="${delta.defense >= 0 ? 'up' : 'down'}">${signedStat(delta.defense)}</b>` : ''}</span><span>速度 ${stats.speed}${delta ? ` <b class="${delta.speed >= 0 ? 'up' : 'down'}">${signedStat(delta.speed)}</b>` : ''}</span></span>`;
}

function canReadNextStoryScene() {
  const progress = prologueProgress(); const scene = prologueScene(progress.nextSceneId);
  if (!scene || ['legacy', 'completed'].includes(progress.status)) return false;
  if (scene.requiresScene && !progress.completedScenes?.includes(scene.requiresScene)) return false;
  if (scene.trigger === 'after_victory' && !model.save.story.clearedStages.includes(scene.stageId)) return false;
  return true;
}

function storyArchiveScenes() {
  const progress = prologueProgress();
  if (progress.status === 'legacy') return model.content.prologue?.scenes || [];
  const completed = new Set(progress.completedScenes || []);
  return (model.content.prologue?.scenes || []).filter((scene) => completed.has(scene.id));
}

function clearGachaTimers() {
  arrivalAnimations.forEach(animation => animation.cancel()); arrivalAnimations = [];
  for (const reveal of commonReveals.values()) { reveal.animations.forEach(animation => animation.cancel()); reveal.ghost.remove(); reveal.source.style.visibility = ''; }
  commonReveals.clear();
  gachaTransition?.cancel(); gachaTransition = null;
  for (const id of gachaTimers) clearTimeout(id);
  gachaTimers = [];
  if (gachaRaf) cancelAnimationFrame(gachaRaf);
  gachaRaf = null;
}

function later(fn, delay) {
  const id = setTimeout(fn, delay); gachaTimers.push(id); return id;
}

function rarityRank(rarity) { return rarity === 'SSR' ? 3 : rarity === 'SR' ? 2 : 1; }
function bestRarity(results) { return results.reduce((best, item) => rarityRank(item.rarity) > rarityRank(best) ? item.rarity : best, 'R'); }
function gachaBatchKey(results = model.save.gacha.lastResults) {
  return model.save.gacha.lastBatchId || `legacy:${model.save.gacha.totalPulls}:${results.map((item) => `${item.characterId}-${item.rarity}-${Number(item.isNew)}`).join('|')}`;
}

function gachaProgressKey() { return `mist-gacha-reveal-v4-slot-${model.activeSlotId}`; }

function readGachaProgress(results = model.save.gacha.lastResults) {
  try {
    const saved = JSON.parse(localStorage.getItem(gachaProgressKey()) || (model.activeSlotId === '1' ? localStorage.getItem('mist-gacha-reveal-v3') : null) || 'null');
    return saved?.batchKey === gachaBatchKey(results) ? saved : null;
  } catch { return null; }
}

function persistGachaProgress(accepted = false) {
  if (!gachaPresentation) return;
  localStorage.setItem(gachaProgressKey(), JSON.stringify({
    batchKey: gachaPresentation.batchKey,
    revealedIndices: [...gachaPresentation.revealedIndices].sort((a, b) => a - b),
    accepted,
  }));
}

function pendingGachaResults() {
  const results = model.save.gacha.lastResults || []; const progress = results.length ? readGachaProgress(results) : null;
  return results.length && progress && !progress.accepted ? results : null;
}

function ensureAudio() {
  if (!gachaSound) return;
  const context = getAudioContext(); if (!context) return;
  if (context.state === 'suspended') context.resume().catch(() => {});
}

// 合成音效统一入口：返回可用的 AudioContext（关闭提示音时返回 null）。
function soundContext() {
  if (!gachaSound) return null;
  const context = getAudioContext(); if (!context) return null;
  if (context.state === 'suspended') context.resume().catch(() => {});
  return context;
}

function chime(kind) {
  const context = soundContext(); if (!context) return;
  const now = context.currentTime;
  const notes = kind === 'SSR' ? [220, 440, 659, 880] : kind === 'SR' ? [330, 494] : [392];
  notes.forEach((frequency, index) => {
    const oscillator = context.createOscillator(); const gain = context.createGain();
    oscillator.type = kind === 'SSR' ? 'sine' : 'triangle'; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now + index * .055);
    gain.gain.exponentialRampToValueAtTime(kind === 'SSR' ? .07 : .035, now + index * .055 + .018);
    gain.gain.exponentialRampToValueAtTime(.0001, now + index * .055 + .34);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now + index * .055); oscillator.stop(now + index * .055 + .36);
  });
}

/* ── 金卡专属音效：public/assets/gold-reveal.m4a ──
   点击金卡的那一刻开始播放并渐入；提前跳过或返回卡阵时立刻渐出停止；自然播完前也做一次渐出。 */
const GOLD_SFX_SRC = '/assets/gold-reveal.m4a';
const GOLD_SFX_LEVEL = 0.85;
const GOLD_SFX_FADE_IN = 0.8;
const GOLD_SFX_FADE_OUT = 0.5;

function goldSfxPlayer() {
  if (goldSfx) return goldSfx;
  const AudioCtor = window.Audio; if (!AudioCtor) return null;
  const element = new AudioCtor();
  element.preload = 'auto';
  element.volume = 0;
  element.src = GOLD_SFX_SRC;
  goldSfx = { element, fadeTimer: null, endTimer: null };
  return goldSfx;
}

function fadeGoldSfx(target, seconds) {
  const sfx = goldSfx; if (!sfx) return;
  clearInterval(sfx.fadeTimer);
  const from = sfx.element.volume;
  const rising = target > from;
  const steps = Math.max(1, Math.round(seconds * 20));
  let step = 0;
  sfx.fadeTimer = setInterval(() => {
    step += 1;
    const t = step / steps;
    sfx.element.volume = Math.min(1, Math.max(0, from + (target - from) * (rising ? t * t : t)));
    if (step < steps) return;
    clearInterval(sfx.fadeTimer); sfx.fadeTimer = null;
    if (target <= 0.001) sfx.element.pause();
  }, 50);
}

function playGoldSfx() {
  if (!gachaSound) return;
  const sfx = goldSfxPlayer(); if (!sfx) return;
  clearTimeout(sfx.endTimer);
  sfx.element.currentTime = 0;
  sfx.element.volume = 0;
  const started = sfx.element.play();
  if (started?.catch) started.catch(() => {});   // 浏览器没给播放许可时静默跳过
  fadeGoldSfx(GOLD_SFX_LEVEL, GOLD_SFX_FADE_IN);
  const total = Number.isFinite(sfx.element.duration) && sfx.element.duration > 0 ? sfx.element.duration : 7.7;
  sfx.endTimer = setTimeout(() => fadeGoldSfx(0.0001, 0.6), Math.max(1000, (total - 0.6) * 1000));
}

// 提前退出（快进 / 返回卡阵 / 关闭演出）时立刻淡出停止
function stopGoldSfx() {
  const sfx = goldSfx; if (!sfx) return;
  clearTimeout(sfx.endTimer);
  if (sfx.element.paused) return;
  fadeGoldSfx(0.0001, GOLD_SFX_FADE_OUT);
}

/* ── 程序合成的环境音：初始界面（雨·风·雷），不依赖任何外部音频素材 ──
   会馆背景乐不在这里，它由 public/assets/hall-bgm.mp3 播放，见下方 syncHallMusic。 */
const AMBIENT_LEVEL = 0.07;

function audioSupported() { return Boolean(window.AudioContext || window.webkitAudioContext); }

// 全局共用一个 AudioContext，避免浏览器上下文数量上限，也让雨声与背景乐各自独立淡入淡出。
function getAudioContext() {
  if (!audioSupported()) return null;
  try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); return audioContext; } catch { audioContext = null; return null; }
}

// 棕噪声打底 + 少量白噪声：低通后听感偏“闷”，接近雾里隔着一层的小雨。
function noiseBuffer(ctx, seconds = 4) {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let brown = 0;
  for (let i = 0; i < data.length; i += 1) {
    const white = Math.random() * 2 - 1;
    brown = (brown + 0.02 * white) / 1.02;
    data[i] = brown * 3.5 + white * 0.3;
  }
  return buffer;
}

function buildRainAudio() {
  const ctx = getAudioContext(); if (!ctx) return null;
  const buffer = noiseBuffer(ctx);
  const master = ctx.createGain(); master.gain.value = 0.0001; master.connect(ctx.destination);

  const bed = ctx.createBufferSource(); bed.buffer = buffer; bed.loop = true;
  const bedFilter = ctx.createBiquadFilter(); bedFilter.type = 'lowpass'; bedFilter.frequency.value = 520; bedFilter.Q.value = 0.7;
  const bedGain = ctx.createGain(); bedGain.gain.value = 0.85;
  bed.connect(bedFilter).connect(bedGain).connect(master);

  const drizzle = ctx.createBufferSource(); drizzle.buffer = buffer; drizzle.loop = true;
  const drizzleFilter = ctx.createBiquadFilter(); drizzleFilter.type = 'bandpass'; drizzleFilter.frequency.value = 1300; drizzleFilter.Q.value = 0.5;
  const drizzleGain = ctx.createGain(); drizzleGain.gain.value = 0.16;
  drizzle.connect(drizzleFilter).connect(drizzleGain).connect(master);

  const hiss = ctx.createBufferSource(); hiss.buffer = buffer; hiss.loop = true;
  const hissFilter = ctx.createBiquadFilter(); hissFilter.type = 'bandpass'; hissFilter.frequency.value = 3400; hissFilter.Q.value = 0.9;
  const hissGain = ctx.createGain(); hissGain.gain.value = 0.035;
  hiss.connect(hissFilter).connect(hissGain).connect(master);

  // 风：低通噪声打底，再叠两层极慢的阵风起伏，只有呼与吸，不出现尖啸。
  const wind = ctx.createBufferSource(); wind.buffer = buffer; wind.loop = true;
  const windFilter = ctx.createBiquadFilter(); windFilter.type = 'lowpass'; windFilter.frequency.value = 420; windFilter.Q.value = 0.9;
  const windGain = ctx.createGain(); windGain.gain.value = 0.16;
  wind.connect(windFilter).connect(windGain).connect(master);

  const gust = ctx.createOscillator(); gust.type = 'sine'; gust.frequency.value = 0.037;
  const gustDepth = ctx.createGain(); gustDepth.gain.value = 0.09;
  gust.connect(gustDepth).connect(windGain.gain);
  const gustSlow = ctx.createOscillator(); gustSlow.type = 'sine'; gustSlow.frequency.value = 0.011;
  const gustSlowDepth = ctx.createGain(); gustSlowDepth.gain.value = 0.06;
  gustSlow.connect(gustSlowDepth).connect(windGain.gain);

  // 屋檐间的气声，比雨更轻，负责“远处有风”的层次。
  const breeze = ctx.createBufferSource(); breeze.buffer = buffer; breeze.loop = true;
  const breezeFilter = ctx.createBiquadFilter(); breezeFilter.type = 'bandpass'; breezeFilter.frequency.value = 760; breezeFilter.Q.value = 0.6;
  const breezeGain = ctx.createGain(); breezeGain.gain.value = 0.05;
  breeze.connect(breezeFilter).connect(breezeGain).connect(master);
  const breezeDrift = ctx.createOscillator(); breezeDrift.type = 'sine'; breezeDrift.frequency.value = 0.023;
  const breezeDriftDepth = ctx.createGain(); breezeDriftDepth.gain.value = 240;
  breezeDrift.connect(breezeDriftDepth).connect(breezeFilter.frequency);

  // 极慢的雨势起伏：像隔着雾一样忽远忽近。
  const swell = ctx.createOscillator(); swell.type = 'sine'; swell.frequency.value = 0.05;
  const swellDepth = ctx.createGain(); swellDepth.gain.value = 150;
  swell.connect(swellDepth).connect(bedFilter.frequency);

  bed.start(); drizzle.start(); hiss.start(); wind.start(); breeze.start(); swell.start(); gust.start(); gustSlow.start(); breezeDrift.start();
  return { ctx, buffer, master, timer: null };
}

// 偶尔落下的雨点，让“淅淅”有一点颗粒感。
function rainDroplet() {
  if (!rainAudio || rainAudio.ctx.state !== 'running') return;
  const { ctx, buffer, master } = rainAudio;
  const now = ctx.currentTime;
  const source = ctx.createBufferSource(); source.buffer = buffer; source.playbackRate.value = 1.4 + Math.random() * 1.4;
  const filter = ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 1400 + Math.random() * 2800; filter.Q.value = 3.5;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.018 + Math.random() * 0.012, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1 + Math.random() * 0.08);
  source.connect(filter).connect(gain).connect(master);
  source.start(now, Math.random() * 3, 0.24);
  source.stop(now + 0.26);
}

// 闷雷：慢起音、长衰减、被压到很低的低频，只当背景里的远处滚动。
function strikeThunder() {
  if (!rainAudio || rainAudio.ctx.state !== 'running') return;
  const { ctx, buffer, master } = rainAudio;
  const now = ctx.currentTime;
  const attack = 0.45 + Math.random() * 0.6;
  const hold = 0.6 + Math.random() * 0.9;
  const release = 2.6 + Math.random() * 2.8;
  const layers = [
    { peak: 0.05 + Math.random() * 0.04, cutoff: 150 + Math.random() * 70, rate: 0.55, offset: 0, length: 1 },
    { peak: 0.03, cutoff: 95, rate: 0.35, offset: 0.8 + Math.random() * 0.9, length: 1.5 },
  ];
  layers.forEach((layer) => {
    const start = now + layer.offset;
    const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true; source.playbackRate.value = layer.rate;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = layer.cutoff; filter.Q.value = 1.1;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(layer.peak, start + attack * layer.length);
    gain.gain.linearRampToValueAtTime(layer.peak * 0.7, start + attack * layer.length + hold * layer.length);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + (attack + hold + release) * layer.length);
    source.connect(filter).connect(gain).connect(master);
    source.start(start, Math.random() * 3);
    source.stop(start + (attack + hold + release) * layer.length + 0.4);
  });
  flashThunder(attack + hold + 0.5);
}

// 伴随闷雷的一次很轻的画面提亮。
function flashThunder(seconds) {
  if (systemReduceMotion) return;
  const screen = document.querySelector('.title-screen');
  if (!screen) return;
  screen.classList.add('thunder-strike');
  clearTimeout(thunderFlashTimer);
  thunderFlashTimer = setTimeout(() => screen.classList.remove('thunder-strike'), Math.max(700, seconds * 1000));
}

// 第一声闷雷等雨声渐入完成（约 6 秒）后再来，之后每 24～66 秒一次
function scheduleThunder(delay = 15000 + Math.random() * 9000) {
  clearTimeout(thunderTimer);
  thunderTimer = setTimeout(() => {
    if (rainEnabled && !quitState && view === 'title' && !document.hidden && rainAudio?.ctx.state === 'running') {
      strikeThunder();
      scheduleThunder(24000 + Math.random() * 42000);
    } else scheduleThunder(7000);
  }, delay);
}

function ensureRainAudio() {
  if (rainAudio) return rainAudio;
  if (!rainEnabled || !audioSupported()) return null;
  rainAudio = buildRainAudio(); if (!rainAudio) return null;
  rainAudio.timer = setInterval(() => {
    if (!rainEnabled || document.hidden || !rainAudio || rainAudio.ctx.state !== 'running') return;
    const drops = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < drops; i += 1) setTimeout(rainDroplet, Math.random() * 500);
  }, 1100);
  scheduleThunder();
  return rainAudio;
}

// 淡入用指数逼近（setTargetAtTime）：起手极轻、慢慢靠拢目标，不会在末尾"涨"上来；
// 淡出仍用指数斜坡，收得干净利落。
function fadeRain(level, seconds = 2.4) {
  const audio = rainAudio; if (!audio) return;
  const now = audio.ctx.currentTime;
  clearTimeout(rainFadeTimer);
  try { audio.master.gain.cancelScheduledValues(now); } catch { /* 上下文已关闭时忽略 */ }
  const current = Math.max(0.0001, audio.master.gain.value);
  const target = Math.max(0.0001, level);
  if (target > current) {
    // 时间常数取总时长的三分之一：约 1 个常数到 63%，3 个常数基本到位
    audio.master.gain.setValueAtTime(current, now);
    audio.master.gain.setTargetAtTime(target, now, Math.max(0.4, seconds / 3));
  } else {
    audio.master.gain.setValueAtTime(current, now);
    audio.master.gain.exponentialRampToValueAtTime(target, now + seconds);
  }
}

// 浏览器要求先有一次用户手势才能出声，这里挂一次性解锁。
function bindAudioUnlock() {
  if (rainUnlockBound) return;
  rainUnlockBound = true;
  const unlock = () => {
    document.removeEventListener('pointerdown', unlock, true);
    document.removeEventListener('keydown', unlock, true);
    if (view === 'title') syncRain(true); else syncBgm(true);
  };
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);
}

function syncRain(active) {
  const want = Boolean(active) && rainEnabled && !quitState;
  if (!want) {
    if (rainActive) { rainActive = false; fadeRain(0.0001, 0.9); }
    return;
  }
  const audio = ensureRainAudio(); if (!audio) return;
  // 渐入约 6 秒：第一次点击/按键后雨声慢慢渗进来，不会突然压上耳朵
  const rise = () => { if (rainEnabled && !quitState && view === 'title' && !rainActive) { rainActive = true; fadeRain(AMBIENT_LEVEL, 6); } };
  if (audio.ctx.state === 'running') rise();
  else { audio.ctx.resume().then(rise).catch(() => {}); bindAudioUnlock(); }
}

/* ── 会馆背景乐：播放列表 ──
   优先按 hall-bgm-1 / -2 / … 顺序探测（每个序号依次试 mp3 → m4a → ogg → wav → flac），
   一组序号都不存在时退回单曲 hall-bgm.*；固定顺序循环，每首放完等 30 秒再放下首。
   离开会馆或回到初始界面时淡出并暂停，再进入时从上一首的中断处继续。 */
const HALL_MUSIC_FILES = ['mp3', 'm4a', 'ogg', 'wav', 'flac'];
const HALL_MUSIC_GAP_MS = 30_000;
const HALL_MUSIC_MAX_TRACKS = 12;

function hallMusicLevel() { return Math.min(1, Math.max(0, bgmVolume / 100)); }

// 试一个候选地址能否当音频加载；成功就把元素交回去复用。
function tryLoadTrack(element, src) {
  return new Promise((resolve) => {
    const onLoaded = () => { cleanup(); resolve(src); };
    const onError = () => { cleanup(); resolve(null); };
    const cleanup = () => {
      element.removeEventListener('loadedmetadata', onLoaded);
      element.removeEventListener('error', onError);
    };
    element.addEventListener('loadedmetadata', onLoaded, { once: true });
    element.addEventListener('error', onError, { once: true });
    element.src = src;
  });
}

// 探测播放列表：先按序号，序号断档就停；一个都没有时退回单曲。
async function probeHallMusic() {
  const AudioCtor = window.Audio;
  if (!AudioCtor) { hallMusicState = 'missing'; render(); return; }
  const element = new AudioCtor();
  element.preload = 'auto';
  element.volume = 0;

  const tracks = [];
  for (let number = 1; number <= HALL_MUSIC_MAX_TRACKS; number += 1) {
    let found = null;
    for (const extension of HALL_MUSIC_FILES) {
      found = await tryLoadTrack(element, `/assets/hall-bgm-${number}.${extension}`);
      if (found) break;
    }
    if (!found) break;                       // 序号断档：认为播放列表到此为止
    tracks.push(found);
  }
  if (!tracks.length) {
    for (const extension of HALL_MUSIC_FILES) {
      const single = await tryLoadTrack(element, `/assets/hall-bgm.${extension}`);
      if (single) { tracks.push(single); break; }
    }
  }

  if (!tracks.length) { hallMusicState = 'missing'; render(); return; }

  element.addEventListener('ended', onHallMusicEnded);
  element.addEventListener('error', onHallMusicPlaybackError);
  hallMusic = { element, tracks, index: 0, duration: 0, fadeTimer: null, autoPaused: false, errorStreak: 0 };
  hallMusicState = 'ready';
  render();
  syncHallMusic(!quitState && view !== 'title');
}

function hallMusicFade(target, seconds = 1.6) {
  const music = hallMusic; if (!music) return;
  clearInterval(music.fadeTimer);
  const from = music.element.volume;
  const rising = target > from;
  const steps = Math.max(1, Math.round(seconds * 20));
  let step = 0;
  music.fadeTimer = setInterval(() => {
    step += 1;
    const t = step / steps;
    // 渐入走二次曲线（起手很轻、后段才跟上），渐出保持线性
    const eased = rising ? t * t : t;
    music.element.volume = Math.min(1, Math.max(0, from + (target - from) * eased));
    if (step < steps) return;
    clearInterval(music.fadeTimer); music.fadeTimer = null;
    if (target <= 0.001) music.element.pause();
  }, 50);
}

// 播放指定序号的曲目；src 未变时保持播放位置（用于"回到会馆续播"）。
function playHallTrack(index) {
  const music = hallMusic; if (!music) return;
  const total = music.tracks.length;
  music.index = ((index % total) + total) % total;
  const src = music.tracks[music.index];
  const absolute = new URL(src, window.location?.href || 'http://localhost/').href;
  if (music.element.src !== absolute) { music.element.src = src; music.duration = 0; music.element.currentTime = 0; }
  music.element.volume = 0;
  const started = music.element.play();
  if (started?.catch) started.catch(() => { bindAudioUnlock(); });   // 还没拿到用户手势
  hallMusicFade(hallMusicLevel(), 4.5);   // 4.5 秒渐入，换曲/进会馆都不会突然响起
}

function startHallMusic() {
  const music = hallMusic; if (!music) return;
  clearTimeout(hallMusicGapTimer); hallMusicGapTimer = null;
  music.errorStreak = 0;
  playHallTrack(music.index);
}

function stopHallMusic() {
  clearTimeout(hallMusicGapTimer); hallMusicGapTimer = null;
  if (hallMusic) hallMusicFade(0, 1.2);
}

// 一曲放完：等 30 秒再放下首（最后一首接回第一首）。
function onHallMusicEnded() {
  const music = hallMusic;
  if (!music || !bgmEnabled || quitState || view === 'title') return;
  clearTimeout(hallMusicGapTimer);
  hallMusicGapTimer = setTimeout(() => {
    hallMusicGapTimer = null;
    if (bgmEnabled && !quitState && view !== 'title' && !document.hidden) playHallTrack(music.index + 1);
  }, HALL_MUSIC_GAP_MS);
}

// 某首歌加载/播放失败：跳到下一首，连续失败到超过曲目数就停，避免死循环。
function onHallMusicPlaybackError() {
  const music = hallMusic;
  if (!music || music.element.paused) return;
  music.errorStreak = (music.errorStreak || 0) + 1;
  if (music.errorStreak > music.tracks.length) { stopHallMusic(); return; }
  playHallTrack(music.index + 1);
}

function syncHallMusic(active) {
  const want = Boolean(active) && bgmEnabled;
  if (!want) { stopHallMusic(); return; }
  if (hallMusicState === 'idle') { hallMusicState = 'probing'; probeHallMusic(); return; }
  if (hallMusicState !== 'ready') return;
  if (hallMusic?.element.paused && !hallMusicGapTimer) startHallMusic();
}

// 只有会馆内才放背景乐：初始界面、退出画面、没有存档时都停下。
function syncBgm(active) { syncHallMusic(Boolean(active) && !quitState && view !== 'title'); }

function startGachaPresentation(results, { resume = false } = {}) {
  clearGachaTimers();
  const saved = readGachaProgress(results);
  const revealedIndices = new Set(saved?.revealedIndices?.filter((index) => index >= 0 && index < results.length) || []);
  const phase = resume || gachaMode === 'direct' || gachaReduceMotion ? 'grid' : 'flight';
  gachaPresentation = { results, phase, focusIndex: null, best: bestRarity(results), batchKey: gachaBatchKey(results), revealedIndices };
  persistGachaProgress(false); render();
  if (phase === 'flight') {
    chime('R');
    startContractArrival();
  }
}

function ritualMarkup() {
  return `<div class="gacha-ritual" aria-hidden="true"><div class="ritual-haze"></div>${riftLayers()}<div class="ritual-dust"></div><p class="ritual-message">雾海深处，有人回应了你</p></div>`;
}

function riftLayers() {
  return `<div class="rift-depth"><div class="rift-window"><div class="rift-current"></div><div class="rift-stars"></div></div><svg class="ritual-fractures" viewBox="0 0 600 600"><g class="rift-branches"><path d="M300 70 280 155 305 205 268 280 285 340 254 397 300 545 M300 70 320 165 311 226 350 291 326 360 340 409 300 545 M280 155 244 183 219 172 194 204 M268 280 221 276 188 325 159 332 M350 291 393 254 409 203 453 184 M340 409 384 425 416 478"/><path d="m244 183-35 51-32-6m184 59 58 29 36-9m-189 48-41 53-50 17m225-185 37 18 41-28"/></g><path class="rift-edge left" d="m300 70-20 85 25 50-37 75 17 60-31 57 46 148-20-144 26-59-17-59 35-75-20-55z"/><path class="rift-edge right" d="m300 70 20 95-9 61 39 65-24 69 14 49-40 136 17-136-11-52 24-64-40-65 12-67z"/><path class="rift-core" d="m300 70-5 82 17 55-32 76 23 57-25 61 22 144"/></svg><div class="rift-fragments">${Array.from({length:18},(_,i)=>`<i style="--n:${i};--side:${i%2 ? 1 : -1};--drift:${90 + i%5*35}px;--delay:${i%6*90}ms;--height:${8+i%4*9}px;--turn:${i*37}deg"></i>`).join('')}</div></div>`;
}

function finishContractArrival() {
  if (gachaPresentation?.phase !== 'flight') return;
  clearGachaTimers(); gachaPresentation.phase = 'grid';
  const overlay = document.querySelector('.gacha-overlay');
  overlay.classList.remove('phase-flight', 'ritual-color', 'ritual-release'); overlay.classList.add('phase-grid');
  overlay.querySelector('.gacha-ritual')?.remove(); overlay.querySelector('[data-gacha-skip]')?.remove();
  const grid = overlay.querySelector('.gacha-card-grid'); grid.inert = false; grid.removeAttribute('aria-hidden');
  updateGachaGridControls(); initGachaCanvas();
}

function startContractArrival() {
  const overlay = document.querySelector('.gacha-overlay'); const grid = overlay.querySelector('.gacha-card-grid');
  grid.inert = true; grid.setAttribute('aria-hidden', 'true');
  const stage = overlay.querySelector('.gacha-stage').getBoundingClientRect();
  const centerX = stage.x + stage.width / 2; const centerY = stage.y + stage.height * .46;
  const cards = [...grid.querySelectorAll('[data-gacha-card]')];
  cards.forEach((card, index) => {
    const box = card.getBoundingClientRect(); const dx = centerX - box.x - box.width / 2; const dy = centerY - box.y - box.height / 2;
    arrivalAnimations.push(card.animate([
      { opacity:0, transform:`translate(${dx}px,${dy}px) scale(.035) rotateY(72deg) rotateZ(-15deg)`, offset:0 },
      { opacity:1, transform:`translate(${dx * .85}px,${dy * .85}px) scale(.3) rotateY(42deg) rotateZ(-9deg)`, offset:.25 },
      { opacity:1, transform:`translate(${dx * .12}px,${dy * .12 - 10}px) scale(1.03) rotateY(-5deg) rotateZ(1deg)`, offset:.78 },
      { opacity:1, transform:'translate(0,0) scale(1) rotateY(0) rotateZ(0)', offset:1 },
    ], { duration:1200, delay:2900 + index * 110, easing:'cubic-bezier(.2,.55,.28,1)', fill:'both' }));
  });
  later(() => {
    if (gachaPresentation?.phase !== 'flight') return;
    overlay.classList.add('ritual-color'); initGachaCanvas(); chime(gachaPresentation.best);
    overlay.querySelector('.ritual-message').textContent = gachaPresentation.best === 'SSR' ? '烁烁金光万丈，一道身影从中浮现' : gachaPresentation.best === 'SR' ? '一抹紫色辉光穿透深渊裂隙' : '回应越来越近';
  }, 1700);
  later(() => { overlay.classList.add('ritual-release'); }, 2850);
  later(finishContractArrival, 4150 + (cards.length - 1) * 110);
}

function gachaGridActions() {
  const remaining = gachaPresentation.results.some((item, index) => item.rarity !== 'SSR' && !gachaPresentation.revealedIndices.has(index));
  const complete = gachaPresentation.revealedIndices.size === gachaPresentation.results.length;
  return `<div class="gacha-grid-actions"><button class="btn ghost" data-gacha-common ${remaining ? '' : 'disabled'}>快速翻开 R / SR</button>${complete ? `<button class="btn primary" data-gacha-accept ${commonReveals.size ? 'disabled' : ''}>收下契约</button>` : ''}</div><span>点击空白处翻开 R / SR · 金色契约请亲自揭晓</span>`;
}

function updateGachaGridControls() {
  const overlay = document.querySelector('.gacha-overlay');
  if (!overlay || gachaPresentation?.phase !== 'grid') return;
  overlay.querySelector('.gacha-footer').innerHTML = gachaGridActions();
  overlay.querySelector('.eyebrow').textContent = `雾海契约 · 已揭晓 ${gachaPresentation.revealedIndices.size}/${gachaPresentation.results.length}`;
}

function revealCommonCard(index, delay = 0, fast = false) {
  if (gachaPresentation?.phase !== 'grid' || gachaPresentation.revealedIndices.has(index)) return;
  const item = gachaPresentation.results[index]; if (item.rarity === 'SSR') return;
  const source = document.querySelector(`[data-gacha-card="${index}"]`); if (!source) return;
  const rect = source.getBoundingClientRect(); const ghost = source.cloneNode(true);
  ghost.removeAttribute('data-gacha-card'); ghost.setAttribute('aria-hidden', 'true'); ghost.tabIndex = -1;
  ghost.classList.add('common-reveal-ghost');
  Object.assign(ghost.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  document.querySelector('.gacha-overlay').append(ghost);
  source.style.visibility = 'hidden'; source.classList.add('revealed');
  source.setAttribute('aria-label', `${item.rarity} · ${char(item.characterId).name}`);
  source.querySelector('.contract-back').setAttribute('aria-hidden', 'true');
  source.querySelector('.contract-front').setAttribute('aria-hidden', 'false');
  gachaPresentation.revealedIndices.add(index); persistGachaProgress(false);
  const duration = gachaReduceMotion ? 100 : fast ? 680 : 900;
  const lift = item.rarity === 'SR' ? -26 : -16; const scale = item.rarity === 'SR' ? 1.15 : 1.09;
  const outer = ghost.animate(gachaReduceMotion ? [{ opacity: 0 }, { opacity: 1 }] : [
    { transform: 'translateY(0) scale(1)', offset: 0 },
    { transform: `translateY(${lift}px) scale(${scale})`, offset: .32 },
    { transform: `translateY(${lift}px) scale(${scale})`, offset: .72 },
    { transform: 'translateY(0) scale(1)', offset: 1 },
  ], { duration, delay, easing: 'cubic-bezier(.25,.6,.25,1)', fill: 'both' });
  const inner = ghost.querySelector('.contract-card-inner').animate([
    { transform: 'rotateY(0deg)', offset: 0 }, { transform: 'rotateY(-12deg)', offset: .22 },
    { transform: 'rotateY(180deg)', offset: .76 }, { transform: 'rotateY(180deg)', offset: 1 },
  ], { duration, delay, easing: 'cubic-bezier(.3,.05,.2,1)', fill: 'both' });
  commonReveals.set(index, { source, ghost, animations: [outer, inner] });
  later(() => chime(item.rarity), delay + duration * .5);
  updateGachaGridControls();
  outer.finished.then(() => {
    ghost.remove(); source.style.visibility = ''; commonReveals.delete(index); updateGachaGridControls();
  }).catch(() => {});
}

function gachaFastForwardMarkup() {
  return '<button class="btn ghost gacha-fast-forward" data-gacha-skip>快进 <span aria-hidden="true">❯❯</span><kbd>空格</kbd></button>';
}

function gachaReturnMarkup() {
  return '<button class="btn primary gacha-return-control" data-gacha-return>返回卡阵 <kbd>空格</kbd></button>';
}

function summonIntelMarkup(character) {
  const row = character.recommendedRow || '中排';
  return `<aside class="summon-intel summon-intel-position"><small>战斗定位</small><div class="summon-intel-crest" aria-hidden="true">${roleCrestArt(character.template)}</div><h3>${esc(character.role)}</h3><p>${esc(character.combatStyle || character.role)}</p><div class="summon-intel-row"><span>推荐</span><strong>${row}</strong></div></aside><aside class="summon-intel summon-intel-strength"><small>擅长</small><div class="summon-intel-tags">${(character.cardTags || []).slice(0, 3).map(tag => `<span>${esc(tag)}</span>`).join('')}</div></aside>`;
}

function revealGachaCard(index) {
  if (!gachaPresentation || gachaPresentation.phase !== 'grid' || !Number.isInteger(index) || index < 0 || index >= gachaPresentation.results.length) return;
  const item = gachaPresentation.results[index]; const alreadyRevealed = gachaPresentation.revealedIndices.has(index);
  if (commonReveals.size) return;
  if (item.rarity !== 'SSR' && !alreadyRevealed) { revealCommonCard(index); return; }
  const source = document.querySelector(`[data-gacha-card="${index}"]`);
  const origin = source?.getBoundingClientRect();
  gachaPresentation.revealedIndices.add(index); persistGachaProgress(false);
  if (!alreadyRevealed && item.rarity !== 'SSR') chime(item.rarity);   // 金卡交给专属音效
  for (const timer of gachaTimers) clearTimeout(timer); gachaTimers = [];
  gachaPresentation.focusIndex = index;
  gachaPresentation.phase = gachaReduceMotion ? 'focus' : 'ssr-turn';
  gachaPresentation.gridScroll = document.querySelector('.gacha-card-grid')?.scrollTop || 0;
  const template = document.createElement('template'); template.innerHTML = renderGachaOverlay();
  const layer = document.createElement('div'); layer.className = 'gacha-focus-layer';
  if (item.rarity === 'SSR' && !alreadyRevealed) {
    layer.classList.add('ssr-summoning');
    layer.innerHTML = `<div class="ssr-summon-space" aria-hidden="true"><div class="ssr-mist"></div><div class="ssr-rift">${riftLayers()}</div><div class="ssr-rift-slit"></div><div class="ssr-emerge-flash"></div><div class="ssr-rays"></div><div class="ssr-convergence"></div></div>${summonIntelMarkup(char(item.characterId))}`;
    playGoldSfx();   // 点击金卡的那一刻起播，带渐入
  }
  layer.append(template.content.querySelector('.gacha-focus'));
  const overlay = document.querySelector('.gacha-overlay');
  const grid = document.querySelector('.gacha-card-grid');
  grid.inert = true; grid.setAttribute('aria-hidden', 'true');
  source.style.visibility = 'hidden';
  const footer = overlay.querySelector('.gacha-footer'); footer.inert = true;
  overlay.querySelector('.gacha-stage').append(layer);
  overlay.classList.remove('phase-grid'); overlay.classList.add('has-focus', `phase-${gachaPresentation.phase}`);
  overlay.querySelector('.eyebrow').textContent = '雾海契约 · 契约揭晓';
  if (!gachaReduceMotion) overlay.insertAdjacentHTML('beforeend', gachaFastForwardMarkup());
  overlay.querySelector('[data-gacha-skip]')?.focus({ preventScroll: true });
  if (gachaReduceMotion) settleGachaFocus();
  else animateSsrReveal(origin, !alreadyRevealed);
}

function settleGachaFocus() {
  if (!gachaPresentation) return;
  gachaPresentation.phase = 'focus';
  const overlay = document.querySelector('.gacha-overlay'); if (!overlay) return;
  overlay.classList.remove('phase-ssr-turn', 'phase-ssr-burst'); overlay.classList.add('phase-focus');
  overlay.querySelector('[data-gacha-skip]')?.remove();
  if (!overlay.querySelector('[data-gacha-return]')) overlay.insertAdjacentHTML('beforeend', gachaReturnMarkup());
  overlay.querySelector('[data-gacha-return]')?.focus({ preventScroll: true });
}

function animateSsrReveal(origin, flip = true) {
  const flipper = document.querySelector('.gacha-focus-flipper'); if (!flipper) return;
  const destination = flipper.getBoundingClientRect();
  const dx = origin ? origin.x + origin.width / 2 - destination.x - destination.width / 2 : 0;
  const dy = origin ? origin.y + origin.height / 2 - destination.y - destination.height / 2 : 80;
  const sx = origin ? origin.width / destination.width : .5;
  const sy = origin ? origin.height / destination.height : .5;
  const summon = Boolean(document.querySelector('.ssr-summoning'));
  // 金卡出场：先从裂隙的细缝里探出（横向被压扁），再撑开、上浮、转向正面。
  gachaTransition = flipper.animate(summon ? [
    { transform: 'translateY(-40px) scale(.03, .88) rotateY(215deg) rotateZ(-7deg)', offset: 0 },
    { transform: 'translateY(-40px) scale(.03, .88) rotateY(215deg) rotateZ(-7deg)', offset: .10 },
    { transform: 'translateY(-36px) scale(.26, .95) rotateY(209deg) rotateZ(-4deg)', offset: .19 },
    { transform: 'translateY(-20px) scale(.84, 1.02) rotateY(191deg) rotateZ(1deg)', offset: .28 },
    { transform: 'translateY(-12px) scale(1.03) rotateY(180deg) rotateZ(-1deg)', offset: .40 },
    { transform: 'translateY(-16px) scale(.98) rotateY(178deg) rotateZ(1deg)', offset: .60 },
    { transform: 'translateY(-10px) scale(.99) rotateY(176deg) rotateZ(-1deg)', offset: .78 },
    { transform: 'translateY(-15px) scale(1.05) rotateY(88deg)', offset: .89 },
    { transform: 'translateY(0) scale(1) rotateY(0deg)', offset: 1 },
  ] : [
    { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy}) rotateY(${flip ? 180 : 0}deg)`, offset: 0 },
    { transform: `translate(${dx * .65}px,${dy * .65}px) scale(${sx + (1 - sx) * .3},${sy + (1 - sy) * .3}) rotateY(${flip ? 100 : 0}deg)`, offset: .42 },
    { transform: 'translate(0,0) scale(1) rotateY(0deg)', offset: 1 },
  ], { duration: summon ? 4400 : flip ? 1250 : 650, easing: summon ? 'linear' : 'cubic-bezier(.22,.68,.24,1)', fill: 'both' });
  if (summon) later(() => { document.querySelector('.ssr-summoning')?.classList.add('ssr-revealing'); }, 3880);
  gachaTransition.finished.then(() => {
    if (gachaPresentation?.phase !== 'ssr-turn') return;
    gachaTransition = null;
    if (!flip) { settleGachaFocus(); return; }
    gachaPresentation.phase = 'ssr-burst';
    const overlay = document.querySelector('.gacha-overlay');
    overlay.classList.remove('phase-ssr-turn'); overlay.classList.add('phase-ssr-burst');
    initGachaCanvas();
    later(() => { if (gachaPresentation?.phase === 'ssr-burst') settleGachaFocus(); }, 500);
  }).catch(() => {});
}

function returnToGachaGrid() {
  if (!gachaPresentation || gachaPresentation.phase === 'returning') return;
  stopGoldSfx();   // 提前返回卡阵：金卡音效立刻淡出
  const index = gachaPresentation.focusIndex;
  const source = document.querySelector(`[data-gacha-card="${index}"]`);
  const flipper = document.querySelector('.gacha-focus-flipper');
  const scrollTop = gachaPresentation.gridScroll || 0;
  const finish = () => {
    if (!gachaPresentation) return;
    clearGachaTimers(); gachaPresentation.phase = 'grid'; gachaPresentation.focusIndex = null; render();
    const grid = document.querySelector('.gacha-card-grid'); if (grid) grid.scrollTop = scrollTop;
    document.querySelector(`[data-gacha-card="${index}"]`)?.focus({ preventScroll: true });
  };
  if (!source || !flipper || gachaReduceMotion) { finish(); return; }
  const currentTransform = getComputedStyle(flipper).transform;
  clearGachaTimers();
  const destination = flipper.getBoundingClientRect(); const target = source.getBoundingClientRect();
  const dx = target.x + target.width / 2 - destination.x - destination.width / 2;
  const dy = target.y + target.height / 2 - destination.y - destination.height / 2;
  gachaPresentation.phase = 'returning';
  const overlay = document.querySelector('.gacha-overlay'); overlay.classList.remove('has-focus','phase-ssr-burst'); overlay.classList.add('phase-returning');
  overlay.querySelector('[data-gacha-skip]')?.remove();
  overlay.querySelector('[data-gacha-return]')?.remove();
  gachaTransition = flipper.animate([{ transform: currentTransform === 'none' ? 'none' : currentTransform, opacity: 1 }, { transform: `translate(${dx}px,${dy}px) scale(${target.width / destination.width},${target.height / destination.height})`, opacity: 1 }], { duration: 560, easing:'cubic-bezier(.22,.68,.24,1)', fill:'both' });
  gachaTransition.finished.then(finish).catch(() => {});
}

function revealCommonGachaCards() {
  if (!gachaPresentation || gachaPresentation.phase !== 'grid') return;
  const targets = gachaPresentation.results.map((item, index) => ({ item, index }))
    .filter(({ item, index }) => item.rarity !== 'SSR' && !gachaPresentation.revealedIndices.has(index));
  targets.forEach(({ index }, order) => revealCommonCard(index, gachaReduceMotion ? 0 : order * 85, true));
}

function skipGachaMotion() {
  if (!gachaPresentation) return;
  if (gachaPresentation.phase === 'flight') { finishContractArrival(); return; }
  clearGachaTimers();
  if (['ssr-turn', 'ssr-burst'].includes(gachaPresentation.phase)) stopGoldSfx();   // 快进跳过：金卡音效立刻淡出
  if (['ssr-turn', 'ssr-burst'].includes(gachaPresentation.phase) && document.querySelector('.gacha-focus-layer')) { document.querySelector('.gacha-focus-layer').classList.add('summon-skip', 'ssr-revealing'); settleGachaFocus(); initGachaCanvas(); return; }
  if (['ssr-turn', 'ssr-burst'].includes(gachaPresentation.phase)) gachaPresentation.phase = 'focus';
  else if (gachaPresentation.phase === 'flight') gachaPresentation.phase = 'grid';
  render();
}

function closeGachaPresentation(accepted = false) {
  if (!gachaPresentation) return;
  stopGoldSfx();   // 收下/关闭演出：金卡音效同步淡出
  persistGachaProgress(accepted); clearGachaTimers(); gachaPresentation = null; render();
}

async function bootstrap() {
  try {
    const response = await fetch(`/api/bootstrap?clientId=${encodeURIComponent(clientId)}`, { cache: 'no-store' });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error);
    model = data;
    clockOffset = data.serverNow - Date.now();
    // 每次打开或刷新都先落在初始界面；战斗进度在“选择存档”后继续。
    if (model.save && ['active', 'paused'].includes(model.save.battle?.status)) { focusId = model.save.battle.focusId; strategy = model.save.battle.strategy; autoRepeat = Boolean(model.save.repeatSession && model.save.battle.repeatSessionId === model.save.repeatSession.id) || autoRepeat; }
    titlePanel = null; newSaveSlotId = null; quitConfirm = false; quitState = false;
    view = 'title';
    render();
  } catch (error) {
    app.innerHTML = `<main class="boot-state"><div class="lantern-mark"><span></span></div><p class="eyebrow">启动失败</p><h1>会馆的灯没有点亮</h1><p>${esc(error.message)}</p><button class="btn primary" data-action="reload">重试</button></main>`;
  }
}

async function act(type, payload = {}, { quiet = false } = {}) {
  if (pending) return null;
  pending = true;
  const previousBattle = type === 'battle_step' ? model.save.battle : null;
  try {
    const response = await fetch('/api/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client-Id': clientId },
      body: JSON.stringify({ type, txId: tx(), slotId: model.activeSlotId, selectionToken: model.selectionToken, ...payload }),
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error);
    Object.assign(model, data); clockOffset = data.serverNow - Date.now();
    if (type === 'import_save') resetTransientState();
    render();
    if (type === 'battle_step' && view === 'battle') playBattleEffects(app, model.save.battle, previousBattle, speed, systemReduceMotion);
    if (!quiet && type !== 'battle_step') toast('操作已保存');
    return data.result;
  } catch (error) {
    if (/存档已切换|另一个标签页/.test(error.message)) { autoRepeat = false; view = 'slots'; }
    if (['battle_start', 'battle_step', 'battle_resume'].includes(type) && model?.save?.repeatSession && model.save.repeatSession.status === 'active') {
      try {
        const stopResponse = await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client-Id': clientId }, body: JSON.stringify({ type: 'battle_error', reason: `接口错误：${error.message}`, txId: tx(), slotId: model.activeSlotId, selectionToken: model.selectionToken }) });
        const stopData = await stopResponse.json();
        if (stopData.ok) Object.assign(model, stopData);
      } catch { /* 页面关闭或服务不可达时，下一次 bootstrap 仍不会按墙钟补算。 */ }
    }
    toast(error.message, true); render(); return null;
  } finally {
    pending = false;
    if (queuedStopAfter) {
      queuedStopAfter = false;
      clearTimeout(timer);
      queueMicrotask(() => act('battle_stop_after', {}, { quiet: true }));
    } else scheduleBattle();
  }
}

function resetTransientState() {
  clearTimeout(timer); clearGachaTimers(); gachaPresentation = null; stopGoldSfx();
  storyReplay = null; storyDisplayBeat = null; storyArchiveOpen = false; collectionDetailId = null;
  deleteSlotId = null;
  titlePanel = null; newSaveSlotId = null; quitConfirm = false; quitState = false;
  focusId = null; strategy = 'balanced'; pool = 'beginner'; autoRepeat = false;
  sessionStorage.setItem('mist-auto-repeat', 'false'); view = 'home';
  equipmentTargetId = null; equipmentOtherOpen = false; equipmentSelection = null; equipmentDrag = null;
  clearFormationDraft();
}

function clearFormationDraft() { cancelFormationDrag(); partyDraft = null; formationDraft = null; formationSelection = null; }

function formationView() {
  const rows = [ ['前排', '生命、防御 +15%'], ['中排', '攻击 +10%'], ['后排', '治疗、护盾效果 +15%'] ];
  return `<div class="formation-editor"><div class="formation-caption"><strong>九宫阵型</strong><span>↑ 敌方方向</span></div><p class="fine">拖动调整位置，落到已有角色的格子会互换。保存编队后，下一场战斗生效。</p>${rows.map(([name, bonus], row) => `<div class="formation-row"><div class="formation-row-label"><strong>${name}</strong><span>${bonus}</span></div><div class="formation-cells">${formationDraft.slice(row * 3, row * 3 + 3).map((id, column) => {
    const index = row * 3 + column; const hero = id === 'protagonist'; const character = hero ? { name: heroName(), rarity: 'SR', role: '独立占位 · 暂不出手' } : id ? char(id) : null;
    return `<button type="button" class="formation-cell ${character ? `rarity-${character.rarity.toLowerCase()}` : 'empty'} ${formationSelection === index ? 'picked' : ''}" data-form-cell="${index}" aria-pressed="${formationSelection === index}" aria-label="${name}${column + 1}格，${character ? `${esc(character.name)}，${character.rarity}${hero ? '起步' : ''}` : '空位'}"><small>${name} ${column + 1}${character ? ` · ${character.rarity}${hero ? '起步' : ''}` : ''}</small><strong>${character ? esc(character.name) : '空位'}</strong><span>${character ? esc(character.role) : '可拖入角色'}</span></button>`;
  }).join('')}</div></div>`).join('')}<p class="formation-feedback" aria-live="polite">${formationSelection === null ? `${esc(heroName())}与五名伙伴自由站位，同一排三个格子的加成相同。` : '已选中角色：点选目标格，或按 Tab 移动后按回车落位。'}</p></div>`;
}

function moveFormation(from, to) {
  if (from === to || !formationDraft?.[from]) return;
  [formationDraft[from], formationDraft[to]] = [formationDraft[to], formationDraft[from]];
  formationSelection = null; render();
  document.querySelector(`[data-form-cell="${to}"]`)?.focus({ preventScroll: true });
}

function cancelFormationDrag() {
  if (!formationDrag) return;
  formationDrag.ghost?.remove(); formationDrag.source.classList.remove('dragging');
  document.querySelectorAll('.formation-cell.drop-target').forEach(el => el.classList.remove('drop-target'));
  if (formationDrag.source.hasPointerCapture?.(formationDrag.pointerId)) formationDrag.source.releasePointerCapture(formationDrag.pointerId);
  formationDrag = null;
}

app.addEventListener('pointerdown', (event) => {
  const source = event.target.closest('[data-form-cell]');
  if (!source || event.button !== 0 || !formationDraft?.[Number(source.dataset.formCell)]) return;
  const rect = source.getBoundingClientRect();
  formationDrag = { source, pointerId: event.pointerId, from: Number(source.dataset.formCell), startX: event.clientX, startY: event.clientY, dx: event.clientX - rect.x, dy: event.clientY - rect.y, rect, ghost: null, target: null };
  source.setPointerCapture(event.pointerId);
});
app.addEventListener('pointermove', (event) => {
  const drag = formationDrag; if (!drag || event.pointerId !== drag.pointerId) return;
  if (!drag.ghost && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
  event.preventDefault();
  if (!drag.ghost) {
    drag.ghost = drag.source.cloneNode(true); drag.ghost.removeAttribute('data-form-cell'); drag.ghost.removeAttribute('aria-pressed');
    drag.ghost.setAttribute('aria-hidden', 'true'); drag.ghost.tabIndex = -1;
    drag.ghost.classList.add('formation-drag-ghost'); drag.ghost.style.width = `${drag.rect.width}px`; drag.ghost.style.height = `${drag.rect.height}px`;
    document.body.append(drag.ghost); drag.source.classList.add('dragging');
  }
  drag.ghost.style.left = `${event.clientX - drag.dx}px`; drag.ghost.style.top = `${event.clientY - drag.dy}px`;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-form-cell]');
  drag.target = target ? Number(target.dataset.formCell) : null;
  document.querySelectorAll('.formation-cell.drop-target').forEach(el => el.classList.remove('drop-target'));
  if (target && drag.target !== drag.from) target.classList.add('drop-target');
}, { passive: false });
app.addEventListener('pointerup', (event) => {
  const drag = formationDrag; if (!drag || event.pointerId !== drag.pointerId) return;
  const moved = Boolean(drag.ghost); const to = drag.target; const from = drag.from;
  cancelFormationDrag();
  if (moved) {
    suppressFormationClick = true; setTimeout(() => { suppressFormationClick = false; }, 0);
    if (to !== null) moveFormation(from, to);
  }
});
app.addEventListener('pointercancel', cancelFormationDrag);

async function switchSave(targetSlotId, create = false, name = null) {
  if (pending) return;
  if (model?.save?.battle && ['active', 'paused'].includes(model.save.battle.status)) await act('battle_abandon', { reason: '切换存档' }, { quiet: true });
  const slotName = name ?? document.querySelector(`[data-slot-name="${targetSlotId}"]`)?.value ?? '';
  pending = true; clearTimeout(timer);
  try {
    const response = await fetch('/api/slots', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client-Id': clientId },
      body: JSON.stringify({ operation: create ? 'create' : 'select', targetSlotId, name: slotName, slotId: model.activeSlotId, selectionToken: model.selectionToken }) });
    const data = await response.json(); if (!data.ok) throw new Error(data.error);
    resetTransientState(); Object.assign(model, data); if (targetSlotId === 'test') view = 'workbench'; clockOffset = data.serverNow - Date.now(); render();
    toast(create ? '新旅团已经建立，从第一段故事开始。' : '已切换存档');
  } catch (error) { toast(error.message, true); }
  finally { pending = false; }
}

async function deleteSaveSlot() {
  const targetSlotId = deleteSlotId;
  const confirmed = Boolean(document.querySelector('[data-delete-confirm]')?.checked);
  if (!targetSlotId || !confirmed || pending) return;
  let successMessage = '';
  pending = true; clearTimeout(timer);
  try {
    const response = await fetch('/api/slots', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client-Id': clientId },
      body: JSON.stringify({ operation: 'delete', targetSlotId, confirmed, slotId: model.activeSlotId, selectionToken: model.selectionToken }) });
    const data = await response.json(); if (!data.ok) throw new Error(data.error);
    localStorage.removeItem(`mist-gacha-reveal-v4-slot-${targetSlotId}`);
    const fromTitle = view === 'title';
    resetTransientState(); Object.assign(model, data); clockOffset = data.serverNow - Date.now();
    if (fromTitle) { view = 'title'; titlePanel = 'slots'; } else view = 'slots';
    successMessage = data.save ? `存档 ${targetSlotId} 已删除，已切换到另一份旅程。` : `存档 ${targetSlotId} 已删除，现在可以建立新旅程。`;
  } catch (error) { toast(error.message, true); }
  finally {
    pending = false; render();
    if (successMessage) toast(successMessage);
  }
}

function toast(message, error = false) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div'); el.className = `toast${error ? ' error' : ''}`; el.textContent = message;
  document.body.append(el); setTimeout(() => el.remove(), 2800);
}

function nav() {
  const links = [
    ['home', '⌂', '会馆'], ['battle', '◇', '冒险'], ['recruit', '✦', '招募'], ['roster', '♙', '角色'], ['collection', '◈', '图鉴'], ['equipment', '▣', '装备'], ['settings', '⚙', '设置'],
  ];
  if (model.activeSlotId === 'test') links.splice(6, 0, ['workbench', '⚒', '测试工作台']);
  return `<aside class="sidebar"><div class="brand"><div class="seal seal-icon" aria-hidden="true"><img src="/assets/icon-192.png" alt=""></div><div><strong>雾灯旅团</strong><small>MIST LANTERN</small></div></div>
    <nav class="nav" aria-label="主导航">${links.map(([id, icon, label]) => `<button class="nav-link ${view === id ? 'active' : ''}" data-view="${id}"><span class="nav-icon">${icon}</span><span>${label}</span></button>`).join('')}</nav>
    <div class="sidebar-bottom"><p><span class="online-dot"></span>本地服务已连接</p><p style="margin-top:8px">关闭网页后不产生离线收益</p></div></aside>`;
}

function topbar() {
  const [title, kicker] = pageTitles[view]; const c = model.save?.currencies;
  return `<header class="topbar"><div><p class="page-kicker">${kicker}</p><h1>${title}</h1></div>${c ? `<div class="resources" aria-label="资源">
    <span class="resource">招募券 <strong>${formatAmount(c.tickets)}</strong></span><span class="resource">金币 <strong>${formatAmount(c.coins)}</strong></span><span class="resource">经验 <strong>${formatAmount(c.xp)}</strong></span><span class="resource">碎片 <strong>${formatAmount(c.contractShards)}</strong></span>
  </div>` : '<span class="tag">尚未建立旅程</span>'}</header>`;
}

function partyStrip() {
  return `<div class="party-strip">${model.save.party.map((id) => { const c = char(id); const own = model.save.owned[id]; return `<article class="party-member rarity-${c.rarity.toLowerCase()}"><div class="portrait">${esc(c.name[0])}</div><strong>${esc(c.name)}</strong><small>${c.rarity} · Lv.${own.level} · ${own.breakthrough}突 · ${esc(c.role)}</small></article>`; }).join('')}</div>`;
}

function storyPrimaryAction() {
  const progress = prologueProgress();
  if (['legacy', 'completed'].includes(progress.status)) {
    if (model.save.battle?.status === 'active' || model.save.battle?.status === 'paused') return '<button class="btn primary" data-view="battle">返回当前战斗</button>';
    const cleared = model.save.story.clearedStages;
    const stage = model.content.stages.slice(0, 3).find((item) => !cleared.includes(item.id)) || model.content.stages.find((item) => item.id === 'old_road_1');
    return stage ? `<button class="btn primary" data-start-stage="${stage.id}">${cleared.includes('prologue_3') ? '前往巡灯' : `继续：${esc(stage.name)}`}</button>` : '';
  }
  if (progress.status === 'reading') return `<button class="btn primary" data-action="resume-story">继续：${esc(prologueScene(progress.currentSceneId)?.title || '序章')}</button>`;
  if (canReadNextStoryScene()) return `<button class="btn primary" data-story-begin="${progress.nextSceneId}">继续：${esc(prologueScene(progress.nextSceneId).title)}</button>`;
  const waiting = prologueScene(progress.nextSceneId);
  if (waiting?.trigger === 'after_victory') {
    const stage = model.content.stages.find((item) => item.id === waiting.stageId);
    return `<button class="btn primary" data-start-stage="${waiting.stageId}">${model.save.battle?.stageId === waiting.stageId && model.save.battle.status === 'active' ? '返回当前战斗' : `继续战斗：${esc(stage?.name || waiting.title)}`}</button>`;
  }
  return '';
}

function storyGoalBanner() {
  const primary = storyPrimaryAction();
  if (!primary || prologueProgress().status === 'reading') return '';
  const next = prologueScene(prologueProgress().nextSceneId);
  if (['legacy', 'completed'].includes(prologueProgress().status)) {
    const finished = model.save.story.clearedStages.includes('prologue_3');
    return `<section class="story-goal"><div><p class="eyebrow">当前主目标</p><strong>${finished ? '巡查旧驿道' : '继续第一号委托'}</strong><small>${finished ? '序章已经完成，可重复巡灯或整理旅团。' : '按顺序完成尚未结束的序章战斗。'}</small></div>${primary}</section>`;
  }
  const waitingForVictory = next?.trigger === 'after_victory' && !model.save.story.clearedStages.includes(next.stageId);
  return `<section class="story-goal"><div><p class="eyebrow">当前主目标</p><strong>${waitingForVictory ? '完成当前战斗' : esc(next?.title || '继续序章')}</strong><small>可以先整理队伍或招募，回来后从这里继续。</small></div>${primary}</section>`;
}

function homeView() {
  const cleared = model.save.story.clearedStages;
  return `<section class="hero"><div class="hero-main"><p class="eyebrow">雾港 · 会馆重新营业</p><h2>${cleared.length ? '灯已经亮了一程，下一段路仍在雾里。' : '第一张委托，在旧驿道等你。'}</h2>
    <p>${cleared.length ? `已经完成 ${cleared.length} 个关卡。可以继续推进、调整队伍，或用刚得到的招募券寻找新伙伴。` : '送药队昨夜失联。五名初始成员已准备好，战斗会自动进行，而集火、策略与速度由你随时调整。'}</p>
    <div class="hero-actions">${storyPrimaryAction()}<button class="btn ghost" data-view="recruit">打开契约册</button><button class="btn ghost" data-action="open-story-archive">剧情档案</button></div></div>
    <aside class="hero-side"><p class="eyebrow">当前进度</p><h3>序章：雨灯归途</h3><div class="steps">${model.content.stages.slice(0,3).map((s, i) => `<div class="step ${cleared.includes(s.id) ? 'done' : ''}"><span class="step-index">${cleared.includes(s.id) ? '✓' : i + 1}</span><div><strong>${esc(s.name)}</strong><small>${cleared.includes(s.id) ? '首胜奖励已领取' : `首胜 ${s.ticketReward} 张招募券`}</small></div><span class="tag ${cleared.includes(s.id) ? 'green' : ''}">${cleared.includes(s.id) ? '完成' : '待出发'}</span></div>`).join('')}</div></aside></section>
    <section class="section"><div class="section-head"><div><h2>出战队伍</h2><p>五人行动条队伍；招募后可在角色页换人。</p></div><button class="btn small ghost" data-view="roster">调整编队</button></div>${partyStrip()}</section>
    <section class="section grid two"><article class="card"><p class="eyebrow">在线连战</p><h3>${model.save.unlocks.autoRepeat ? '已解锁' : '完成序章后开放'}</h3><p class="fine">只在本页面保持打开时继续。刷新或关闭不会按墙钟补算，未完成战斗保留在最后动作边界。</p></article><article class="card"><p class="eyebrow">${cleared.includes('prologue_3') ? '旧灯具铺的线索' : '第一号委托'}</p><h3>${cleared.includes('prologue_3') ? '后续章节尚未开放' : '先找回失联的送药队'}</h3><p class="fine">${cleared.includes('prologue_3') ? '铜扣与旧账册已经收入档案。等后续主线开放时，会馆会在这里给出明确的新目标。' : '沿旧驿道寻找药车与三名送药人；每完成一段，主目标会明确指出下一步。'}</p></article></section>`;
}

function unitCard(u, focused = false) {
  const hp = Math.max(0, Math.round(u.hp / u.maxHp * 100)); const gauge = Math.round(u.gauge / 100);
  return `<article data-unit-id="${esc(u.id)}" class="unit ${u.team === 'enemy' ? 'enemy' : ''} ${focused ? 'focused' : ''} ${!u.alive ? 'dead' : ''}" ${u.team === 'enemy' && u.alive ? `data-focus="${u.id}" role="button" tabindex="0"` : ''}>
    <div class="unit-top"><div><h3>${esc(u.name)}</h3><div class="role">${esc(u.role)}${u.formationRow ? ` · ${u.formationRow}` : ''}</div></div><span class="energy">${u.energy}/100</span></div>
    <div class="bar hp"><span style="width:${hp}%"></span></div><div class="bar shield"><span style="width:${Math.min(100, Math.round(u.shield / u.maxHp * 200))}%"></span></div>
    <div class="unit-numbers">${Math.round(u.hp)} / ${u.maxHp}${u.shield ? ` · 盾 ${Math.round(u.shield)}` : ''}</div><div class="bar action"><span style="width:${gauge}%"></span></div>
    <div class="unit-numbers">行动 ${gauge}% · A冷却 ${u.cooldown}</div></article>`;
}

function battleView() {
  const b = model.save.battle;
  if (!b) {
    return `${repeatLedgerView(model.save.repeatSummary, '最近一次刷关摘要')}<div class="section-head"><div><h2>选择出发地点</h2><p>序章三段道路会依次开放；完成护送后可重复巡灯。</p></div></div><div class="grid two">${model.content.stages.map((s, index) => {
      const previous = index > 0 ? model.content.stages[index - 1] : null;
      const progress = prologueProgress();
      const requiredScene = { prologue_1: 'before_bridge', prologue_2: 'before_shelter', prologue_3: 'before_return' }[s.id];
      const storyLocked = requiredScene && !['legacy', 'completed'].includes(progress.status) && !progress.completedScenes?.includes(requiredScene);
      const locked = Boolean(previous && !model.save.story.clearedStages.includes(previous.id)) || storyLocked;
      const lockedLabel = storyLocked ? '先继续序章剧情' : '完成前一地点后开放';
    return `<article class="card"><span class="tag ${model.save.story.clearedStages.includes(s.id) ? 'green' : ''}">${model.save.story.clearedStages.includes(s.id) ? '已首胜 · 可 5×' : '未首胜 · 最高 3×'}</span><h3 style="margin-top:14px">${esc(s.name)}</h3><p class="meta">敌方 ${s.enemyNames.length} 人 · 首胜招募券 ${s.ticketReward}</p><div class="character-actions"><button class="btn primary small" data-start-stage="${s.id}" ${locked ? 'disabled' : ''}>${locked ? lockedLabel : '开始战斗'}</button></div></article>`;
    }).join('')}</div>`;
  }
  focusId ||= b.focusId; strategy = b.strategy || strategy;
  const ended = ['victory', 'defeat', 'stopped'].includes(b.status);
  return `<div class="battle-layout"><section class="battlefield"><div class="battle-head"><div><p class="eyebrow">${esc(b.stageName)}</p><h2>${b.status === 'victory' ? '战斗胜利' : b.status === 'defeat' ? '战斗失败' : b.status === 'stopped' ? '刷关已停止' : b.status === 'paused' ? '战斗已暂停' : '行动条正在推进'}</h2></div><div class="battle-controls">
    ${[1,2,3].map((x) => `<button class="btn small ${speed === x ? 'selected' : 'ghost'}" data-speed="${x}">${x}×</button>`).join('')}<button class="btn small ${speed === 5 ? 'selected' : 'ghost'}" data-speed="5" ${!model.save.story.clearedStages.includes(b.stageId) ? 'disabled title="完成本关首胜后开放 5×"' : ''}>5×${!model.save.story.clearedStages.includes(b.stageId) ? ' · 首胜后开放' : ''}</button>
    ${!ended ? `<button class="btn small ghost" data-action="${b.status === 'paused' ? 'resume-battle' : 'pause-battle'}">${b.status === 'paused' ? '继续推进' : '立即暂停'}</button>${model.save.repeatSession?.id === b.repeatSessionId && b.status === 'active' ? `<button class="btn small ghost" data-action="battle-stop-after" ${b.stopAfterBattle ? 'disabled' : ''}>${b.stopAfterBattle ? '本场结束后汇总中' : '打完本场并汇总'}</button>` : ''}` : ''}</div></div>
    <div class="units enemies">${b.enemies.map((u) => unitCard(u, u.id === focusId)).join('')}</div><div class="battle-rail">五盏雾灯依速度蓄满；点击敌人可改变下一次自由选敌技能的集火</div>${battleFormationView(b)}
    ${ended ? `<div class="hero-actions">${b.status === 'victory' && canReadNextStoryScene() ? `<button class="btn primary" data-story-begin="${prologueProgress().nextSceneId}">继续序章</button>` : '<button class="btn primary" data-action="leave-battle">查看本轮收获 / 返回关卡</button>'}<button class="btn ghost" data-start-stage="${b.stageId}">再次挑战</button>${b.status === 'victory' && b.reward ? `<span class="tag gold">${b.reward.first ? `首胜 +${b.reward.tickets} 券 · ` : ''}+${b.reward.coins} 金币 · 装备已入库</span>` : ''}${b.status === 'stopped' ? `<span class="tag danger">已停止：${esc(b.stopReason || '未完成')}</span>` : ''}</div>${b.repeatSessionId ? repeatLedgerView(model.save.repeatSession, '本次刷关') : ''}</section>` : ''}
    <aside class="battle-side"><article class="card"><h3>战斗策略</h3><div class="form-row" style="margin-top:12px"><label for="strategy">下一次行动决策生效</label><select id="strategy" data-strategy><option value="balanced" ${strategy === 'balanced' ? 'selected' : ''}>均衡：按职责使用技能</option><option value="offense" ${strategy === 'offense' ? 'selected' : ''}>强攻：辅助倾向普攻</option><option value="survive" ${strategy === 'survive' ? 'selected' : ''}>保守：治疗与护盾优先</option></select></div>
      <label class="fine" style="display:flex;gap:8px;align-items:center;margin-top:14px"><input type="checkbox" data-auto-repeat ${autoRepeat ? 'checked' : ''} ${!model.save.unlocks.autoRepeat ? 'disabled' : ''}> 在线自动连战${model.save.unlocks.autoRepeat ? '' : '（序章后开放）'}</label>${model.save.repeatSession?.id === b.repeatSessionId && model.save.repeatSession.pauseReason ? `<p class="banner repeat-paused">${esc(model.save.repeatSession.pauseReason)}；不会补算离线时间，请选择继续或查看。</p>` : ''}<p class="fine">本场已进行 ${b.actionCount} 次行动</p></article>
      <article class="card"><h3>动作记录</h3><ol class="log">${b.logs.slice().reverse().map((line) => `<li>${esc(line)}</li>`).join('')}</ol></article></aside></div>`;
}

function repeatLedgerView(session, title) {
  if (!session) return '';
  const reward = session.reward || {};
  const drops = [...(session.equipmentDrops || [])].sort((a, b) => ({ '传说': 3, '史诗': 2, '精良': 1 }[b.rarity] || 0) - ({ '传说': 3, '史诗': 2, '精良': 1 }[a.rarity] || 0));
  return `<article class="card repeat-ledger"><div class="section-head"><div><p class="eyebrow">${esc(title)}</p><h3>${session.status === 'paused' ? '已暂停' : session.status === 'active' ? '在线进行中' : '已结束'} · ${session.wins} 胜 / ${session.losses} 败</h3></div><span class="tag">${formatAmount(session.onlineMs || 0)} ms 在线推进</span></div><p class="fine">实际到账：金币 +${formatAmount(reward.coins)} · 经验 +${formatAmount(reward.xp)}${reward.tickets ? ` · 招募券 +${formatAmount(reward.tickets)}` : ''}${reward.notes ? ` · 笔记 +${formatAmount(reward.notes)}` : ''}</p><p class="fine">装备 ${drops.length} 件${drops.length ? ` · 传说 ${drops.filter(x => x.rarity === '传说').length} · 史诗 ${drops.filter(x => x.rarity === '史诗').length} · 精良 ${drops.filter(x => x.rarity === '精良').length}` : ''}</p>${session.reason ? `<p class="fine">结束原因：${esc(session.reason)}</p>` : ''}${drops.length ? `<details><summary>查看本轮装备（已到账，不重复领取）</summary><ul class="repeat-equipment-list">${drops.map(item => `<li><span class="tag ${item.rarity === '传说' ? 'gold' : ''}">${esc(item.rarity)}</span> ${esc(item.name)} · ${esc(equipmentSlotName(item.slot))} <small>${esc(item.id)}</small></li>`).join('')}</ul></details>` : ''}</article>`;
}

function battleFormationView(battle) {
  if (!battle.formation) return `<div class="units">${battle.players.map(unit => unitCard(unit)).join('')}</div>`;
  const coverNote = battle.positioning?.version ? '<p class="fine battle-cover-note">前排掩护：敌方普通单体直伤按前/中/后排 60%/25%/15% 选行；前排存活时中排×0.85、后排×0.70，前排倒下后恢复×1.00。全体与穿透/刺杀类标记不适用。</p>' : '';
  return `<div class="battle-formation"><p class="fine">我方阵型 · 前排朝向敌方 · 站位加成已计入本场属性</p>${coverNote}${['前排','中排','后排'].map((name, row) => `<div class="battle-formation-label">${name}</div><div class="battle-formation-row">${battle.formation.slice(row * 3, row * 3 + 3).map(id => {
    if (id === 'protagonist') return `<article class="battle-hero-placeholder"><strong>${esc(heroName())}</strong><span>独立占位 · 暂不出手</span></article>`;
    const unit = battle.players.find(candidate => candidate.characterId === id);
    return unit ? unitCard(unit) : '<div class="battle-empty-cell" aria-label="空位"></div>';
  }).join('')}</div>`).join('')}</div>`;
}

function wishSelect(value, index, kind) {
  const standard = model.content.characters.filter((c) => c.pool === 'standard');
  return `<div class="form-row"><label>心愿格 ${index + 1}</label><select data-wish="${index}" data-wish-kind="${kind}"><option value="">随机 · 来者不拒</option>${standard.map((c) => `<option value="${c.id}" ${value === c.id ? 'selected' : ''}>${esc(c.name)} · ${esc(c.title)}</option>`).join('')}</select></div>`;
}

function recruitView() {
  if (pool === 'theme' && !model.save.unlocks.themePool) pool = 'common';
  const g = model.save.gacha;
  const pendingReveal = pendingGachaResults();
  const info = {
    beginner: ['新手招募', '基础 SSR 10% · 最多 40 次 · 三个 30% 心愿格', `剩余 ${40 - g.beginnerPulls} 次招募`],
    common: ['雾港常驻', '基础 SSR 5% · 三个 10% 心愿格 · 与主题共享软保底', `保底计数 ${g.regularPity}`],
    theme: ['雨灯归途', g.pastMode ? '往期许愿：0% 当期 / 30% 常驻 / 70% 往期' : '默认：40% 当期 / 30% 常驻 / 30% 往期', `保底计数 ${g.regularPity}`],
  }[pool];
  const wishes = pool === 'beginner' ? g.beginnerWishes : g.commonWishes;
  return `<div class="battle-controls" style="margin-bottom:12px"><button class="btn small ${pool === 'beginner' ? 'selected' : 'ghost'}" data-pool="beginner" ${g.beginnerPulls >= 40 ? 'disabled' : ''}>新手 ${g.beginnerPulls}/40</button><button class="btn small ${pool === 'common' ? 'selected' : 'ghost'}" data-pool="common">常驻</button><button class="btn small ${pool === 'theme' ? 'selected' : 'ghost'}" data-pool="theme" ${!model.save.unlocks.themePool ? 'disabled' : ''}>主题${model.save.unlocks.themePool ? '' : ' · 未开放'}</button></div>
    <section class="pool-banner"><div><p class="eyebrow">${esc(info[2])}</p><h2>${esc(info[0])}</h2><p class="pool-rules">${esc(info[1])}<br>第 31～40 次招募的 SSR 率依次为 10%～100%；每十次招募至少 SR。所有实际招募计入 200/500 全池累计奖励。</p><div class="hero-actions"><button class="btn primary" data-pull="10" ${model.save.currencies.tickets < 1 ? 'disabled' : ''}>招募十次</button><button class="btn ghost" data-pull="1" ${model.save.currencies.tickets < 1 ? 'disabled' : ''}>招募一次</button></div></div>
      <div>${pool !== 'theme' ? `<div class="wish-grid">${wishes.map((x, i) => wishSelect(x, i, pool)).join('')}</div><button class="btn small ghost" style="margin-top:10px" data-action="save-wishes">保存心愿</button>` : `<article class="card"><h3>SSR 类别开关</h3><label class="fine" style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" data-past-mode ${g.pastMode ? 'checked' : ''}> 启用往期许愿 0/30/70</label><p class="fine">关闭时严格使用 40/30/30；类别内角色等权。此开关不会重置保底。</p></article>`}</div></section>
    ${freeRecruitView()}<section class="section"><div class="section-head"><div><h2>最近招募记录</h2><p>重复卡保留为凭证，不会自动突破。</p></div><div class="character-actions">${pendingReveal ? '<button class="btn small primary" data-gacha-continue>继续揭晓</button>' : ''}<button class="btn small ghost" data-view="roster">去换人上场</button></div></div>${g.lastResults.length ? `<div class="pull-results">${g.lastResults.map((r) => { const c = char(r.characterId); return `<article class="pull-card rarity-${r.rarity.toLowerCase()} ${r.rarity === 'SSR' ? 'ssr' : ''} ${r.isNew ? 'new' : ''}"><span class="tag ${r.rarity === 'SSR' ? 'gold' : ''}">${r.rarity}</span><strong>${esc(c.name)}</strong><small>${r.isNew ? '新伙伴已加入' : '同名凭证 +1'}</small></article>`; }).join('')}</div>` : `<div class="empty-state"><strong>契约册还没有招募记录</strong>第一次招募结果会保存在这里，刷新后不会再次生成结果。</div>`}</section>
    <section class="section grid two"><article class="card"><p class="eyebrow">全池累计招募 ${g.totalPulls} 次</p><h3>常驻自选：每 200 次招募</h3><div class="progress" style="margin-top:12px"><span style="width:${g.totalPulls % 200 / 2}%"></span></div><p class="fine">可用 ${g.selectors.common} 份 · 距下一份 ${200 - g.totalPulls % 200} 次</p></article><article class="card"><p class="eyebrow">独立里程碑</p><h3>往期自选：每 500 次招募</h3><div class="progress herb" style="margin-top:12px"><span style="width:${g.totalPulls % 500 / 5}%"></span></div><p class="fine">可用 ${g.selectors.past} 份 · 距下一份 ${500 - g.totalPulls % 500} 次</p></article></section>
    <section class="section card"><div class="section-head"><div><h2>契约碎片与自选包</h2><p>SSR 凭证每张回收 100 碎片；常驻 500、往期 1000。购买包后再决定角色。</p></div><span class="tag gold">持有 ${model.save.currencies.contractShards}</span></div><div class="grid two">
      ${selectorPanel('common', '常驻 SSR', 500, model.content.characters.filter((c) => c.pool === 'standard'))}
      ${selectorPanel('past', '往期主题 SSR', 1000, model.content.characters.filter((c) => c.pool === 'past'))}
    </div></section>`;
}

function selectorPanel(kind, title, cost, candidates) {
  const count = model.save.gacha.selectors[kind];
  return `<article class="card"><h3>${title}</h3><p class="fine">自选包 ${count} 份 · 碎片价格 ${cost}</p><div class="form-row"><label>选择角色</label><select data-selector-choice="${kind}">${candidates.map((c) => `<option value="${c.id}">${esc(c.name)} · ${esc(c.title)}</option>`).join('')}</select></div><div class="character-actions"><button class="btn small" data-choose-selector="${kind}" ${count < 1 ? 'disabled' : ''}>使用自选包</button><button class="btn small ghost" data-buy-selector="${kind}" ${model.save.currencies.contractShards < cost ? 'disabled' : ''}>${cost} 碎片购买</button></div></article>`;
}

function rosterView() {
  partyDraft ||= [...model.save.party];
  formationDraft ||= [...model.save.formation];
  const dirty = JSON.stringify(partyDraft) !== JSON.stringify(model.save.party) || JSON.stringify(formationDraft) !== JSON.stringify(model.save.formation);
  const ownedIds = Object.keys(model.save.owned);
  const owned = model.content.characters.filter((c) => ownedIds.includes(c.id));
  const locked = model.content.characters.filter((c) => !ownedIds.includes(c.id));
  const optionHtml = owned.map((c) => `<option class="rarity-${c.rarity.toLowerCase()}" value="${c.id}">${c.rarity} · ${esc(c.name)} · ${esc(c.role)}</option>`).join('');
  return `${protagonistCard()}<section class="card"><div class="section-head"><div><h2>五名出战伙伴</h2><p>${esc(heroName())}独立占位，不占伙伴名额。每个伙伴只能上阵一次；保存后下一场战斗生效。</p></div><div class="party-toolbar"><button class="btn ghost small" data-action="auto-party" title="按品质、等级、突破优先选择，前中后排各至少一名伙伴">一键配队</button><button class="btn primary small" data-action="save-party">${dirty ? '保存编队（有变更）' : '保存编队'}</button></div></div>${dirty ? '<p class="party-unsaved" role="status">编队尚未保存 · 下一场仍会使用之前的队伍，请先保存变更。</p>' : ''}<div class="party-editor">${partyDraft.map((id, i) => `<div class="form-row"><label>${i + 1} 号位</label><select aria-label="${i + 1} 号位" class="rarity-${char(id).rarity.toLowerCase()}" data-party-slot="${i}">${optionHtml.replace(`value="${id}"`, `value="${id}" selected`)}</select></div>`).join('')}</div>${formationView()}</section>
    <section class="section"><div class="section-head"><div><h2>已招募 · ${owned.length}</h2><p>升级返还、技能升级与装备预设后续继续完善；当前支持等级、突破和凭证回收。</p></div></div><div class="roster">${owned.map((c) => characterCard(c, true)).join('')}</div></section>
    <section class="section"><details><summary class="btn ghost" style="display:inline-flex;align-items:center;cursor:pointer">查看未招募图鉴 · ${locked.length}</summary><div class="roster" style="margin-top:12px">${locked.map((c) => characterCard(c, false)).join('')}</div></details></section>`;
}

function protagonistCard() {
  const hero = model.protagonist;
  if (!hero) return '';
  return `<section class="card protagonist-card rarity-sr" aria-label="主角成长档案"><div class="protagonist-heading"><div class="protagonist-portrait" aria-hidden="true">${esc(hero.name[0] || '你')}</div><div><p class="eyebrow">主角 · 独立成长位</p><h2>${esc(hero.name)} <span class="tag">SR 起步</span></h2><p class="fine">Lv.${hero.level} · 成长不设等级上限 · 剧情增幅 +${hero.storyBonus}%</p></div></div><div class="protagonist-stats"><div><span>生命</span><strong>${hero.hp}</strong></div><div><span>攻击</span><strong>${hero.attack}</strong></div><div><span>防御</span><strong>${hero.defense}</strong></div><div><span>速度</span><strong>${hero.speed}</strong></div></div><div class="protagonist-milestones">${hero.milestones.map((entry) => `<span class="${entry.unlocked ? 'unlocked' : ''}">${entry.unlocked ? '✓' : '◇'} ${esc(entry.name)} · 生命 / 攻击 / 防御 +${Math.round(entry.bonus * 100)}%</span>`).join('')}</div><p class="fine protagonist-note">当前为${esc(hero.name)}的成长档案，暂不作为战斗单位出手；五名伙伴照常作战。剧情增幅随首次通关生效，回看不会重复获得。</p></section>`;
}

function characterCard(c, isOwned) {
  const own = model.save.owned[c.id];
  const preview = model.characterPreviews?.[c.id];
  const statLabels = { hp: '生命', attack: '攻击', defense: '防御', speed: '速度' };
  const statKeys = Object.keys(statLabels);
  const deltaRow = (delta) => `<span class="character-delta-row">${statKeys.map((key) => `<span>${statLabels[key]} <strong>${delta[key] >= 0 ? '+' : ''}${delta[key]}</strong></span>`).join('')}</span>`;
  const currentStats = preview ? `<div class="character-current-stats" aria-label="当前实际属性">${statKeys.map((key) => `<div><span>${statLabels[key]}</span><strong>${preview.current[key]}</strong></div>`).join('')}</div><p class="character-stat-scope">含已穿装备 · 不含站位加成</p>` : '';
  const levelCost = preview?.nextLevel;
  const levelResource = (key, label) => {
    const missing = levelCost.shortage[key];
    return `<span class="character-resource ${missing ? 'is-short' : 'is-enough'}"><span>${label} ${formatAmount(levelCost.available[key])} / ${formatAmount(levelCost.cost[key])}</span><strong>${missing ? `还差 ${formatAmount(missing)}` : '足够'}</strong></span>`;
  };
  const levelPreview = preview ? `<div class="character-step"><span>${preview.nextLevel ? `升至 Lv.${preview.nextLevel.target}` : '等级已满'}</span>${preview.nextLevel ? `${deltaRow(preview.nextLevel.delta)}<div class="character-cost"><strong>消耗</strong><span>经验 ${formatAmount(levelCost.cost.xp)} · 金币 ${formatAmount(levelCost.cost.coins)}</span><div class="character-resource-check">${levelResource('xp', '经验')} ${levelResource('coins', '金币')}</div></div>` : '<strong class="character-cap">已达当前上限 Lv.20</strong>'}</div>` : '';
  const breakthroughPreview = preview ? `<div class="character-step"><span>${preview.nextBreakthrough ? `下一突 · ${preview.nextBreakthrough.target}/7` : '突破已满'}</span>${preview.nextBreakthrough ? `${deltaRow(preview.nextBreakthrough.delta)}<small class="breakthrough-cost">消耗：同名凭证 ×1 · 持有 ${formatAmount(own.dupes)}</small>` : '<strong class="character-cap">已达 7 突</strong>'}${preview.nextBreakthrough?.skillUpgradePending ? `<small>第 ${preview.nextBreakthrough.target} 突专属技能强化尚未实装；当前不会额外改变属性。</small>` : ''}</div>` : '';
  const levelDisabled = !isOwned || own.level >= 20 || (levelCost && !levelCost.canAfford);
  return `<article class="card character-card rarity-${c.rarity.toLowerCase()} ${isOwned ? '' : 'locked-card'}"><div class="character-head"><div class="avatar">${esc(c.name[0])}</div><div><h3>${esc(c.name)} <span class="tag ${c.rarity === 'SSR' ? 'gold' : ''}">${c.rarity}</span></h3><p class="meta">${esc(c.title)} · ${esc(c.role)}</p></div></div><p class="skill-summary">${esc(c.skillText || c.passiveText)}</p>
    ${isOwned ? `<div class="stat-row" style="margin-top:12px"><div class="stat"><span>等级</span><strong>${own.level}</strong></div><div class="stat"><span>突破</span><strong>${own.breakthrough}/7</strong></div><div class="stat"><span>凭证</span><strong>${own.dupes}</strong></div></div>${currentStats}<div class="character-step-preview">${levelPreview}${breakthroughPreview}</div><div class="character-actions"><button class="btn small" data-level="${c.id}" ${levelDisabled ? 'disabled' : ''}>${own.level >= 20 ? '已满级' : `升级至 Lv.${own.level + 1}`}</button><button class="btn small ghost" data-breakthrough="${c.id}" ${own.dupes < 1 || own.breakthrough >= 7 ? 'disabled' : ''}>${own.breakthrough >= 7 ? '已 7 突' : `突破至 ${own.breakthrough + 1}`}</button><button class="btn small ghost" data-recycle="${c.id}" ${own.dupes < 1 ? 'disabled' : ''}>回收 1 张</button></div>` : '<p class="fine">未招募 · 可查看技能，不可上阵</p>'}</article>`;
}

function collectionDiscovery() {
  return new Set(model.save.collection?.discovered || Object.keys(model.save.owned));
}

function collectionAcquisition(character) {
  if (character.pool === 'low') return '基础成员：新手、常驻与主题招募的 R / SR 档';
  if (character.pool === 'standard') return '常驻 SSR：新手、常驻，以及主题招募的常驻分组';
  if (character.pool === 'past') return '往期主题 SSR：主题招募的往期分组，或往期自选包';
  return model.save.unlocks.themePool ? '当前主题 SSR：雨灯归途主题招募' : '当前主题 SSR：完成序章后开放雨灯归途主题招募';
}

function stableCharacterSort(a, b) {
  const rarity = { SSR: 3, SR: 2, R: 1 };
  // 1) 稀有度始终是第一关键字
  if (rarity[b.rarity] !== rarity[a.rarity]) return rarity[b.rarity] - rarity[a.rarity];
  // 2) 勾选「未获得优先」时，只在同一稀有度内部把未获得的排前面
  if (collectionUnownedFirst) {
    const ownedDifference = Number(Boolean(model.save.owned[a.id])) - Number(Boolean(model.save.owned[b.id]));
    if (ownedDifference) return ownedDifference;
  }
  // 3) 选「速度」排序时，同一稀有度（与同一拥有状态）内按 SPD 从快到慢
  if (collectionSort === 'spd' && (b.speed ?? 0) !== (a.speed ?? 0)) return (b.speed ?? 0) - (a.speed ?? 0);
  // 4) 稳定 ID 兜底，保证顺序可复现
  const prefix = a.id[0].localeCompare(b.id[0]);
  return prefix || Number(a.id.slice(1)) - Number(b.id.slice(1));
}

function collectionView() {
  const discovered = collectionDiscovery();
  const newIds = new Set(model.save.collection?.new || []);
  const roles = [...new Set(model.content.characters.map((character) => character.role))];
  const counts = Object.fromEntries(['SSR', 'SR', 'R'].map((rarity) => [rarity, {
    found: model.content.characters.filter((character) => character.rarity === rarity && discovered.has(character.id)).length,
    total: model.content.characters.filter((character) => character.rarity === rarity).length,
  }]));
  const query = collectionSearch.trim().toLocaleLowerCase('zh-CN');
  const visible = model.content.characters.filter((character) => {
    const isOwned = Boolean(model.save.owned[character.id]);
    const searchable = [character.name, character.title, ...(character.aliases || [])].join(' ').toLocaleLowerCase('zh-CN');
    return (!query || searchable.includes(query))
      && (collectionRarity === 'all' || character.rarity === collectionRarity)
      && (collectionRole === 'all' || character.role === collectionRole)
      && (collectionOwned === 'all' || (collectionOwned === 'owned') === isOwned)
      && (collectionGroup === 'all' || character.pool === collectionGroup);
  }).sort(stableCharacterSort);
  const cards = visible.map((character) => {
    const own = model.save.owned[character.id]; const isFound = discovered.has(character.id);
    return `<button class="collection-card rarity-${character.rarity.toLowerCase()} ${isFound ? 'found' : 'undiscovered'}" data-collection-id="${character.id}" aria-label="查看 ${esc(character.title)} ${esc(character.name)} 图鉴详情">
      <span class="collection-id">${character.id}</span>${newIds.has(character.id) ? '<span class="collection-new">NEW</span>' : ''}
      <span class="collection-monogram">${esc(character.name[0])}</span><span class="tag ${character.rarity === 'SSR' ? 'gold' : ''}">${character.rarity}</span>
      <strong class="collection-title">${esc(character.title)}</strong><span class="collection-name">${esc(character.name)}</span><small>${esc(character.role)}${collectionSort === 'spd' ? ` · SPD ${character.speed ?? '—'}` : ''} · ${isFound ? '已点亮' : '未获得'}</small>
      ${own ? `<span class="collection-owned">Lv.${own.level} · ${own.breakthrough}突</span>` : '<span class="collection-owned muted">可预览技能与获取途径</span>'}
    </button>`;
  }).join('');
  return `<section class="collection-protagonist card"><div><p class="eyebrow">主角 · 独立档案</p><h2>${esc(model.protagonist.name)}</h2><p>曾经的护送冒险者，如今在雾灯会馆落脚。带领伙伴接委托，在旅途中不断成长。</p><span class="tag">Lv.${model.protagonist.level}</span> <span class="tag">剧情成长 +${model.protagonist.storyBonus}%</span></div><button class="btn primary" data-protagonist-detail>查看主角档案</button></section>
    <section class="collection-hero"><div><p class="eyebrow">伙伴图鉴 · 不提供战力奖励</p><h2>旅团的每一次相遇，都留在这里。</h2><p>回收多余卡不会抹除点亮记录；未拥有角色也可查看完整技能与实际获取途径。</p></div><div class="collection-total"><strong>${discovered.size}<span> / ${model.content.characters.length}</span></strong><small>已点亮伙伴</small></div></section>
    <section class="collection-progress">${['SSR', 'SR', 'R'].map((rarity) => `<article><span class="tag ${rarity === 'SSR' ? 'gold' : ''}">${rarity}</span><strong>${counts[rarity].found} / ${counts[rarity].total}</strong><div class="progress"><span style="width:${counts[rarity].found / counts[rarity].total * 100}%"></span></div></article>`).join('')}</section>
    <section class="collection-toolbar card"><div class="collection-search"><input type="text" value="${esc(collectionSearch)}" placeholder="姓名、称号或旧名" aria-label="搜索姓名、称号或旧名" data-collection-search><button class="btn small" data-action="apply-collection-search">搜索</button></div>
      <select aria-label="稀有度筛选" data-collection-rarity><option value="all">全部稀有度</option>${['SSR', 'SR', 'R'].map((value) => `<option value="${value}" ${collectionRarity === value ? 'selected' : ''}>${value}</option>`).join('')}</select>
      <select aria-label="职能筛选" data-collection-role><option value="all">全部职能</option>${roles.map((value) => `<option value="${esc(value)}" ${collectionRole === value ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select>
      <select aria-label="拥有状态筛选" data-collection-owned><option value="all">全部状态</option><option value="owned" ${collectionOwned === 'owned' ? 'selected' : ''}>已拥有</option><option value="unowned" ${collectionOwned === 'unowned' ? 'selected' : ''}>未拥有</option></select>
      <select aria-label="来源分组筛选" data-collection-group><option value="all">全部分组</option><option value="low" ${collectionGroup === 'low' ? 'selected' : ''}>基础成员</option><option value="standard" ${collectionGroup === 'standard' ? 'selected' : ''}>常驻 SSR</option><option value="past" ${collectionGroup === 'past' ? 'selected' : ''}>往期主题</option><option value="current" ${collectionGroup === 'current' ? 'selected' : ''}>当前主题</option></select>
      <select aria-label="排序方式" data-collection-sort><option value="rarity" ${collectionSort === 'rarity' ? 'selected' : ''}>按稀有度</option><option value="spd" ${collectionSort === 'spd' ? 'selected' : ''}>按速度 SPD</option></select>
      <label class="fine collection-check"><input type="checkbox" data-collection-unowned-first ${collectionUnownedFirst ? 'checked' : ''}> 未获得优先</label><button class="btn small ghost" data-action="clear-collection-filters">清除筛选</button></section>
    <div class="section-head collection-count"><div><h2>角色记录 · ${visible.length}</h2><p>${collectionSort === 'spd' ? '先从 SSR 到 R 分组，组内按速度 SPD 从快到慢' : '默认按 SSR → SR → R 与稳定 ID 排序'}${collectionUnownedFirst ? '；同一稀有度内未获得的排前面' : ''}。</p></div></div>
    ${visible.length ? `<section class="collection-grid">${cards}</section>` : '<section class="empty-state"><strong>没有符合条件的角色</strong>调整条件，或点击“清除筛选”恢复全部图鉴。</section>'}`;
}

function renderCollectionDetail() {
  if (!collectionDetailId) return '';
  if (collectionDetailId === 'protagonist') return `<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="protagonist-detail-title"><section class="protagonist-detail card"><button class="collection-close" data-action="close-collection-detail" aria-label="关闭图鉴详情">×</button><p class="eyebrow">主角 · 独立档案</p><h2 id="protagonist-detail-title">${esc(model.protagonist.name)}</h2><div class="protagonist-biography">${(model.content.prologue.background?.paragraphs || []).slice(0, 3).map(text => `<p>${storyText(text)}</p>`).join('')}</div>${protagonistCard()}<button class="btn primary" data-action="close-collection-detail">返回图鉴 <kbd>空格</kbd></button></section></div>`;
  const character = char(collectionDetailId); if (!character) return '';
  const own = model.save.owned[character.id]; const discovered = collectionDiscovery().has(character.id);
  return `<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="collection-detail-title"><section class="collection-detail rarity-${character.rarity.toLowerCase()}">
    <button class="collection-close" data-action="close-collection-detail" aria-label="关闭图鉴详情">×</button>
    <div class="collection-detail-art"><span>${esc(character.name[0])}</span><small>${character.id}</small></div>
    <div class="collection-detail-copy"><p class="eyebrow">${discovered ? '图鉴已点亮' : '尚未获得 · 预览'}</p><p class="collection-detail-title">${esc(character.title)}</p><h2 id="collection-detail-title">${esc(character.name)} <span class="tag ${character.rarity === 'SSR' ? 'gold' : ''}">${character.rarity}</span></h2><p class="meta">${esc(character.role)} · SPD ${character.speed}</p>
      <div class="collection-base-stats"><span>基础生命 <strong>${character.hp}</strong></span><span>基础攻击 <strong>${character.attack}</strong></span><span>基础防御 <strong>${character.defense}</strong></span></div>
      ${character.memory ? `<article class="character-memory"><h3>人物记忆点</h3><p>${esc(character.memory)}</p></article>` : ''}<article><h3>技能预览</h3><p>${esc(character.skillText || '暂无主动技能说明。')}</p></article><article><h3>被动特性</h3><p>${esc(character.passiveText || '暂无独立被动说明。')}</p></article><article><h3>突破效果</h3><p>${esc(character.breakthroughText || '每次突破提升生命与主职能属性。')}</p></article><article><h3>获取途径</h3><p>${esc(collectionAcquisition(character))}</p></article>
      ${own ? `<div class="collection-current"><span>当前培养状态</span><strong>Lv.${own.level} · ${own.breakthrough}/7 突 · 多余凭证 ${own.dupes}</strong></div><button class="btn primary" data-collection-train="${character.id}">前往角色培养</button>` : '<div class="collection-current locked"><span>持有状态</span><strong>尚未获得</strong></div>'}
    </div></section></div>`;
}

function equipmentView() {
  const party = model.save.party || []; if (!equipmentTargetId || !model.save.owned[equipmentTargetId]) equipmentTargetId = party[0];
  const otherIds = model.equipmentState?.otherCharacterIds || Object.keys(model.save.owned).filter((id) => !party.includes(id));
  const renderSlot = (characterId, slot) => {
    const info = equipmentInfo(characterId); const equipmentId = info?.equipmentBySlot?.[slot]; const item = equipmentId ? equipmentById(equipmentId) : null;
    return `<div class="equipment-slot-wrap"><div class="equipment-slot ${item ? 'filled' : 'empty'} ${equipmentSelection?.type === 'slot' && equipmentSelection.characterId === characterId && equipmentSelection.slot === slot ? 'picked' : ''}" role="button" tabindex="0" data-equipment-slot="${slot}" data-equipment-character="${characterId}" aria-label="${esc(char(characterId)?.name || characterId)}的${equipmentSlotName(slot)}${item ? `：${esc(item.name)}` : '空槽'}" ${item ? 'draggable="true"' : ''}><span class="equipment-slot-name">${equipmentSlotName(slot)}</span><strong>${item ? esc(item.name) : '空槽'}</strong>${item ? `<small>${esc(item.main)}</small>` : '<small>点选装备后可穿戴</small>'}</div>${item ? `<button class="equipment-remove" data-equipment-remove="${equipmentId}" data-equipment-character="${characterId}" aria-label="卸下${esc(item.name)}">卸下</button>` : ''}</div>`;
  };
  const renderMember = (characterId, fixed = false) => {
    const c = char(characterId); const info = equipmentInfo(characterId); const target = equipmentTargetId === characterId;
    return `<article class="equipment-member rarity-${(c?.rarity || 'r').toLowerCase()} ${target ? 'target' : ''}"><button class="equipment-member-head" data-equipment-target="${characterId}" aria-pressed="${target}"><span class="portrait">${esc(c?.name?.[0] || '?')}</span><span><strong>${esc(c?.name || characterId)}</strong><small>${esc(c?.rarity || 'R')} · ${esc(c?.role || '')}${fixed ? ' · 已保存上场' : ' · 替补目标'}</small></span></button><div class="equipment-stats">${equipmentStatLine(info?.stats)}</div><div class="equipment-slots">${equipmentSlots.map((slot) => renderSlot(characterId, slot)).join('')}</div></article>`;
  };
  const selectedItem = equipmentSelection?.type === 'item' ? equipmentById(equipmentSelection.equipmentId) : null;
  const selectedSlotItem = equipmentSelection?.type === 'slot' ? equipmentById(equipmentSelection.equipmentId) : null;
  const previewRows = selectedItem && equipmentTargetId ? equipmentPreview(selectedItem.id, equipmentTargetId, selectedItem.slot) : selectedSlotItem ? equipmentPreview(selectedSlotItem.id, equipmentSelection.characterId, equipmentSelection.slot, true) : [];
  const preview = equipmentSelection ? `<aside class="equipment-preview card" aria-live="polite"><div class="section-head"><div><p class="eyebrow">${selectedItem ? '已选装备 · 请选择同类型槽' : '已选装备槽'}</p><h3>${esc(selectedItem?.name || selectedSlotItem?.name || '空槽')}</h3></div><button class="btn small ghost" data-action="clear-equipment-selection">取消选择</button></div>${selectedItem ? `<p class="fine">${esc(equipmentSlotName(selectedItem.slot))} · ${esc(selectedItem.main)}${equipmentWearer(selectedItem.id) ? ` · 当前穿戴：${esc(char(equipmentWearer(selectedItem.id))?.name || equipmentWearer(selectedItem.id))}` : ' · 当前未穿戴'}</p>` : ''}${previewRows.map((row) => `<div class="equipment-preview-row"><div><strong>${esc(row.name)}</strong><small>${row.beforeIds.map((id) => esc(equipmentById(id)?.name || id)).join('、') || '无'} → ${row.afterIds.map((id) => esc(equipmentById(id)?.name || id)).join('、') || '无'}</small></div>${equipmentStatLine(row.next, row.delta)}</div>`).join('')}${selectedSlotItem ? `<button class="btn danger small" data-equipment-remove="${selectedSlotItem.id}" data-equipment-character="${equipmentSelection.characterId}">卸下选中装备</button>` : ''}<p class="fine equipment-limit-note">差值仅按当前已实现主词条计算；套装效果与随机副词条尚未实装，不计入提升。</p></aside>` : '';
  const filtered = model.save.equipment.filter((item) => (equipmentSlotFilter === 'all' || item.slot === equipmentSlotFilter) && (equipmentRarityFilter === 'all' || item.rarity === equipmentRarityFilter) && (equipmentSetFilter === 'all' || item.setId === equipmentSetFilter));
  const sorted = [...filtered].sort((a, b) => (equipmentUnwornFirst ? Number(!equipmentWearer(b.id)) - Number(!equipmentWearer(a.id)) : 0) || (a.name || '').localeCompare(b.name || ''));
  const renderLibraryItem = (item) => {
    const wearer = equipmentWearer(item.id); const set = equipmentSet(item.setId);
    const selected = equipmentSelection?.type === 'item' && equipmentSelection.equipmentId === item.id;
    // 词条布局：上排名称 · 品质 · 套装；左下穿戴部位与效果加成；右侧是否穿戴／当前穿戴角色。
    return `<button class="card equipment-card ${selected ? 'picked' : ''} ${wearer ? 'worn' : 'unworn'} rarity-${(item.rarity || 'r').toLowerCase()}" data-equipment-item="${esc(item.id)}" draggable="true" aria-pressed="${selected}" aria-label="选择${esc(item.name)}，${equipmentSlotName(item.slot)}">
      <span class="equipment-card-head"><strong>${esc(item.name)}</strong><span class="tag">${esc(item.rarity)}</span><span class="equipment-card-set">${esc(set?.name || item.setId)}</span></span>
      <span class="equipment-card-left"><span class="equipment-card-slot">${esc(equipmentSlotName(item.slot))}</span><span class="equipment-card-stat">${esc(item.main)}</span></span>
      <span class="equipment-card-wearer">${wearer ? `当前穿戴：${esc(char(wearer)?.name || wearer)}` : '未穿戴'}</span>
    </button>`;
  };
  return `<div class="section-head"><div><h2>行装室 · ${model.save.equipment.length}/1000</h2><p>装备页使用已保存的五人队伍；换装作用于下一场战斗${model.equipmentState?.battleUsesOpeningSnapshot ? '，当前战斗仍保留开场快照' : ''}。</p></div></div><section class="equipment-party-sticky"><div class="section-head"><div><p class="eyebrow">已保存上场伙伴</p><h3>固定四槽 · 点击伙伴切换目标</h3></div><button class="btn small ghost" data-action="toggle-equipment-others" aria-expanded="${equipmentOtherOpen}">其他伙伴 ${otherIds.length ? `（${otherIds.length}）` : ''}</button></div><div class="equipment-party-grid">${party.map((id) => renderMember(id, true)).join('')}</div>${equipmentOtherOpen ? `<div class="equipment-other-picker" role="list" aria-label="其他伙伴">${otherIds.length ? otherIds.map((id) => `<button class="equipment-other-button ${equipmentTargetId === id ? 'active' : ''}" data-equipment-target="${id}">${esc(char(id)?.name || id)} <small>${esc(char(id)?.rarity || 'R')} · ${equipmentInfo(id)?.equipmentIds?.length || 0}/4 槽</small></button>`).join('') : '<span class="fine">暂无替补伙伴。</span>'}</div>` : ''}${!party.includes(equipmentTargetId) && equipmentTargetId ? `<div class="equipment-alt-target">${renderMember(equipmentTargetId)}</div>` : ''}</section><section class="equipment-workspace"><div class="equipment-library card"><div class="section-head"><div><p class="eyebrow">装备库</p><h3>拖到目标槽，或点选后再点槽</h3></div><label class="equipment-check"><input type="checkbox" data-equipment-unworn-first ${equipmentUnwornFirst ? 'checked' : ''}> 未穿戴优先</label></div><div class="equipment-filters"><div class="filter-tabs" role="tablist" aria-label="装备类型">${[['all','全部'], ...equipmentSlots.map((slot) => [slot, equipmentSlotName(slot)])].map(([value,label]) => `<button class="filter-tab ${equipmentSlotFilter === value ? 'active' : ''}" data-equipment-slot-filter="${value}" role="tab" aria-selected="${equipmentSlotFilter === value}">${label}</button>`).join('')}</div><select data-equipment-rarity aria-label="品质筛选"><option value="all">全部品质</option>${['精良','史诗','传说'].map((value) => `<option value="${value}" ${equipmentRarityFilter === value ? 'selected' : ''}>${value}</option>`).join('')}</select><select data-equipment-set aria-label="套装筛选"><option value="all">全部套装</option>${model.content.equipmentSets.map((set) => `<option value="${set.id}" ${equipmentSetFilter === set.id ? 'selected' : ''}>${esc(set.name)}</option>`).join('')}</select></div><div class="equipment-library-list">${sorted.length ? sorted.map(renderLibraryItem).join('') : '<div class="empty-state"><strong>没有符合条件的装备</strong>试试放宽筛选条件。</div>'}</div></div>${preview}</section><section class="section grid two"><article class="card"><h3>强化与随机副词条</h3><p class="fine">完整强化、回退与定向重铸尚未接入本轮；本页不会假算这些效果。</p><span class="tag">本批不施工</span></article><article class="card"><h3>套装注册表</h3><p class="fine">12 套已被内容校验器读取；套装 2/4 件机制尚未实装，不会计入属性差值。</p><span class="tag">12 / 12 已注册</span></article></section>`;
}

function slotsView({ embedded = false } = {}) {
  const current = currentSlot();
  return `${embedded ? '' : `<section class="section-head"><div><p class="eyebrow">旅团手记</p><h2>从哪一段旅程继续？</h2><p>${current ? `当前：${esc(current.name)}。` : '当前没有存档。'}三个位置分别保存角色、资源、剧情与免费招募次数。</p></div><button class="btn ghost" data-action="reload">刷新存档列表</button></section>`}
    <section class="save-slots">${model.slots.map((slot) => {
      const active = slot.id === model.activeSlotId;
      const disabled = pending || model.mode !== 'writer';
      if (slot.empty) return `<article class="card save-slot empty-slot"><p class="eyebrow">存档 ${slot.id} · 空位</p><h3>点亮一间新会馆</h3><p>从完整开场开始，初始五人和 10 张招募券会为这份旅程准备好。</p><label for="slot-name-${slot.id}">旅团手记名称</label><input id="slot-name-${slot.id}" data-slot-name="${slot.id}" maxlength="20" placeholder="例如：重走雨灯归途"><button class="btn primary" data-slot-create="${slot.id}" ${disabled ? 'disabled' : ''}>新建存档 ${slot.id}</button></article>`;
      const scene = prologueScene(slot.story?.currentSceneId || slot.story?.nextSceneId);
      const progress = slot.story?.status === 'legacy' ? '已有旅程' : slot.story?.status === 'completed' ? '序章已完成' : scene ? `${scene.title}${slot.story.status === 'reading' ? ` · 第 ${slot.story.beatIndex + 1} 句` : ''}` : '准备出发';
      return `<article class="card save-slot ${active ? 'current-slot' : ''}"><p class="eyebrow">存档 ${slot.id} ${active ? '· 当前旅程' : ''}</p><h3>${esc(slot.name)}</h3><p class="slot-story">${esc(progress)}</p><dl><div><dt>伙伴</dt><dd>${slot.owned} 人</dd></div><div><dt>招募券</dt><dd>${slot.tickets}</dd></div><div><dt>累计招募</dt><dd>${slot.pulls}</dd></div><div><dt>已通关</dt><dd>${slot.cleared} 关</dd></div></dl><small>保存于 ${esc(new Date(slot.updatedAt).toLocaleString('zh-CN'))}</small><div class="save-slot-actions"><button class="btn ${active ? 'ghost' : 'primary'}" data-slot-select="${slot.id}" ${disabled ? 'disabled' : ''}>${active ? '返回当前旅程' : '继续这份存档'}</button><button class="btn danger" data-slot-delete="${slot.id}" ${disabled ? 'disabled' : ''}>删除这份存档</button></div></article>`;
    }).join('')}</section><section class="card test-slot-card"><div><p class="eyebrow">独立沙盒 · 不占正式档位</p><h2>测试存档</h2><p>默认 999 张招募券、99,999,999 金币、9,999 契约碎片。剧情已完成，主题池、冒险和装备开放，资源与角色可在工作台调整。</p><span class="tag">${model.testSlot?.empty ? '首次进入时建立' : `已保存 · ${model.testSlot.tickets} 张券 · ${model.testSlot.owned} 位伙伴`}</span></div><button class="btn primary" data-slot-select="test" ${pending || model.mode !== 'writer' ? 'disabled' : ''}>进入测试工作台</button></section><p class="fine">正式旅程与测试存档分别保存，测试操作不会写入三个正式档位。</p>`;
}

function currentSlot() { return model.activeSlotId === 'test' ? model.testSlot : model.slots.find(slot => slot.id === model.activeSlotId); }

function workbenchView() {
  if (model.activeSlotId !== 'test') return '<section class="card"><h2>请先进入测试存档</h2><button class="btn primary" data-view="slots">选择存档</button></section>';
  const resources = [['tickets','招募券'],['coins','金币'],['contractShards','契约碎片'],['xp','经验'],['notes','技能笔记'],['equipmentDust','装备粉尘']];
  const disabled = model.mode !== 'writer';
  const characters = [...model.content.characters].sort((a,b) => rarityRank(b.rarity)-rarityRank(a.rarity) || a.id.localeCompare(b.id));
  return `<section class="card"><p class="eyebrow">测试存档专用</p><h2>自由调试会馆</h2><p class="fine">所有改动只写入测试存档。资源填入的是目标总量；直接领取角色不扣券、不计招募次数，也不改变保底。</p><div class="workbench-resources">${resources.map(([key,label]) => `<label>${label}<input type="number" min="0" max="9999999999" step="1" required data-test-resource="${key}" value="${model.save.currencies[key] || 0}" ${disabled ? 'disabled' : ''}></label>`).join('')}</div><button class="btn primary" data-action="test-resources" ${disabled ? 'disabled' : ''}>应用资源数值</button></section><section class="card section"><p class="eyebrow">角色工作台</p><h2>领取指定角色</h2><p class="fine">未拥有时第一张解锁角色，其余转为重复凭证；已拥有时全部转为凭证，可自行突破或回收。</p><div class="workbench-grant"><label>指定角色<select data-test-character>${characters.map(c=>`<option value="${c.id}">${c.rarity} · ${esc(c.name)} · ${esc(c.title)}</option>`).join('')}</select></label><label>领取张数<input type="number" min="1" max="1000" step="1" required value="1" data-test-count></label><button class="btn primary" data-action="test-grant" ${disabled ? 'disabled' : ''}>领取角色</button></div><div class="character-actions"><button class="btn ghost" data-view="roster">查看角色与配队</button><button class="btn ghost" data-view="recruit">前往招募</button></div></section>`;
}

function countdown(nextRefreshAt) {
  const seconds = Math.max(0, Math.ceil((nextRefreshAt - Date.now() - clockOffset) / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map((value) => String(value).padStart(2, '0')).join(':');
}

function freeRecruitView() {
  return `<section class="section free-recruit-section"><div class="section-head"><div><p class="eyebrow">会馆赠礼 · 一点心意</p><h2>免费招募</h2><p>整点常驻单招；每天 23:00 常驻十连、主题单招。次数不累积，同样计入保底和累计招募。</p></div></div><div class="free-recruit-grid">${(model.freeRecruit || []).map((offer) => `<article class="card free-offer"><span class="tag ${offer.cycle === 'daily' ? 'gold' : ''}">${offer.cycle === 'hourly' ? '每个整点' : '每日 23:00'}</span><h3>${offer.title}</h3><p>${offer.locked ? '完成序章后开放' : offer.available ? '本轮剩余 1 次' : '本轮已使用'}</p><small>刷新倒计时 <span data-free-countdown="${offer.nextRefreshAt}">${countdown(offer.nextRefreshAt)}</span></small><button class="btn ${offer.available ? 'primary' : 'ghost'}" data-free-pull="${offer.id}" ${offer.available && model.mode === 'writer' ? '' : 'disabled'}>${offer.locked ? '主题尚未开放' : offer.available ? `免费招募 ${offer.count} 次` : '等待刷新'}</button></article>`).join('')}</div></section>`;
}

async function updateFreeClock() {
  if (!model || view !== 'recruit' || document.hidden || gachaPresentation) return;
  document.querySelectorAll('[data-free-countdown]').forEach((element) => { element.textContent = countdown(Number(element.dataset.freeCountdown)); });
  const now = Date.now() + clockOffset;
  if (freeRefreshing || pending || now < freeRetryAt || !model.freeRecruit?.some((offer) => offer.nextRefreshAt <= now)) return;
  freeRefreshing = true;
  const selectionToken = model.selectionToken;
  try {
    const response = await fetch(`/api/free-recruit?slotId=${model.activeSlotId}&selectionToken=${encodeURIComponent(selectionToken)}`);
    const data = await response.json();
    if (!data.ok) throw new Error(data.error);
    if (selectionToken === model.selectionToken) { model.freeRecruit = data.freeRecruit; clockOffset = data.serverNow - Date.now(); if (view === 'recruit' && !gachaPresentation) render(); }
  } catch { freeRetryAt = now + 10_000; }
  finally { freeRefreshing = false; }
}

function settingsView() {
  const current = currentSlot();
  return `<div class="grid two"><section class="card"><p class="eyebrow">本地存档</p><h3>保存、导出与恢复</h3><button class="btn ghost" data-view="slots">选择存档 · ${esc(current.name)}</button><p class="fine">进度自动保存。导出与导入只针对当前存档；导入会替换当前旅程。</p><div class="character-actions"><a class="btn ghost" style="display:inline-flex;align-items:center;text-decoration:none" href="/api/export?slotId=${model.activeSlotId}&amp;selectionToken=${encodeURIComponent(model.selectionToken)}">导出存档</a><button class="btn ghost" data-action="pick-import">导入存档</button><button class="btn ghost" data-action="back-to-title">返回初始界面</button><input type="file" accept="application/json" data-import hidden></div></section>
    <section class="card"><p class="eyebrow">写入状态</p><h3>${model.mode === 'writer' ? '当前标签页拥有写入权' : '只读模式'}</h3><p class="fine">并行标签页只允许一个写入者。写入租约失效后，刷新即可接管。</p></section>
    <section class="card"><p class="eyebrow">招募演出</p><h3>雾海契约</h3><div class="form-row" style="margin-top:12px"><label for="gacha-mode">播放方式</label><select id="gacha-mode" data-gacha-mode><option value="full" ${gachaMode === 'full' ? 'selected' : ''}>完整飞入与揭晓</option><option value="ssr" ${gachaMode === 'ssr' ? 'selected' : ''}>保留 SSR 重点演出</option><option value="direct" ${gachaMode === 'direct' ? 'selected' : ''}>省略飞入，手动翻牌</option></select></div><label class="fine setting-check"><input type="checkbox" data-gacha-sound ${gachaSound ? 'checked' : ''}> 招募提示音</label><label class="fine setting-check"><input type="checkbox" data-gacha-reduce ${gachaReduceMotion ? 'checked' : ''}> 减少动态</label></section>
    <section class="card"><p class="eyebrow">声音</p><h3>环境音与背景音乐</h3><label class="fine setting-check"><input type="checkbox" data-title-rain ${rainEnabled ? 'checked' : ''}> 初始界面环境音</label><label class="fine setting-check"><input type="checkbox" data-game-bgm ${bgmEnabled ? 'checked' : ''}> 会馆背景音乐</label><label class="fine setting-check bgm-volume-row">背景音乐音量 <input type="range" min="0" max="100" step="5" data-bgm-volume value="${bgmVolume}" aria-label="背景音乐音量"><span class="tabular">${bgmVolume}%</span></label></section>
    ${model.activeSlotId === 'test' ? '<section class="card"><h3>测试工作台</h3><p>资源与角色可以自由调整。</p><button class="btn primary" data-view="workbench">打开工作台</button></section>' : `<section class="card danger-zone"><p class="eyebrow">危险操作</p><h3>删除当前存档</h3><p class="fine">删除“${esc(current.name)}”中的角色、资源、剧情与招募记录。游戏内无法撤销，建议先导出备份。</p><button class="btn danger" data-slot-delete="${model.activeSlotId}" ${model.mode !== 'writer' ? 'disabled' : ''}>删除当前存档</button></section>`}
    <section class="card"><p class="eyebrow">主角</p><h3>名字</h3><p class="fine">懵懵懂懂间，恍然仿佛听见一声叫唤……是我吗？</p><div class="hero-name-row"><input data-hero-name-input maxlength="12" value="${esc(heroName())}" autocomplete="off" spellcheck="false" aria-label="主角名字" ${model.mode !== 'writer' ? 'disabled' : ''}><button class="btn primary" data-action="save-hero-name" ${model.mode !== 'writer' ? 'disabled' : ''}>保存名字</button></div></section></div>`;
}

function renderGachaOverlay() {
  if (!gachaPresentation) return '';
  const { phase, results, focusIndex, best, revealedIndices } = gachaPresentation;
  const current = focusIndex === null ? null : results[focusIndex];
  const currentCharacter = current ? char(current.characterId) : null;
  const rarity = current?.rarity || best;
  const phaseLabel = phase === 'flight' ? '契约穿过裂隙' : phase === 'grid' ? `等待揭晓 · ${revealedIndices.size}/${results.length}` : current?.rarity === 'SSR' ? '金色回应' : '契约详情';
  const cards = results.map((item, index) => {
    const character = char(item.characterId); const revealed = revealedIndices.has(index);
    const title = revealed ? `${character.title} ${character.name}` : `第 ${index + 1} 张，${item.rarity}，未揭晓`;
    return `<button class="contract-card rarity-${item.rarity.toLowerCase()} ${revealed ? 'revealed' : ''}" data-gacha-card="${index}" aria-label="${esc(title)}">
      <span class="contract-card-inner">${item.rarity === 'SSR' ? cardEdgeLightning(index) : ''}<span class="contract-back" aria-hidden="${revealed ? 'true' : 'false'}"><small>${String(index + 1).padStart(2, '0')}</small><strong>${item.rarity}</strong><i class="contract-back-art" aria-hidden="true">${cardBackArt(item.rarity)}</i></span>
      <span class="contract-front" aria-hidden="${revealed ? 'false' : 'true'}"><small>${item.rarity} · ${String(index + 1).padStart(2, '0')}</small><span class="contract-title" ${item.rarity === 'SSR' ? '' : 'aria-hidden="true"'}>${item.rarity === 'SSR' ? esc(character.title) : ''}</span><span class="contract-crest" aria-hidden="true">${roleCrestArt(character.template)}</span><strong>${esc(character.name)}</strong><span class="contract-role">${esc(character.role)}</span><p>${esc(character.cardSummary || character.skillText)}</p><em>${item.isNew ? '首次结契' : '凭证 +1'}</em></span></span>
    </button>`;
  }).join('');
  const focus = current ? `<section class="gacha-focus rarity-${current.rarity.toLowerCase()} ${phase === 'ssr-burst' ? 'burst' : ''}" aria-labelledby="gacha-focus-name"><div class="gacha-focus-light" aria-hidden="true"></div><div class="gacha-focus-flipper"><div class="gacha-focus-back" aria-hidden="true">${cardBackArt(current.rarity)}<strong>${current.rarity}</strong></div><article class="gacha-focus-card"><small>${current.rarity} · 契约 ${focusIndex + 1}</small>${current.rarity === 'SSR' ? `<p class="gacha-focus-title">${esc(currentCharacter.title)}</p>` : ''}<div class="gacha-focus-crest" aria-hidden="true">${roleCrestArt(currentCharacter.template)}</div><h2 id="gacha-focus-name">${esc(currentCharacter.name)}</h2><p class="gacha-focus-role">${esc(currentCharacter.role)} · ${(currentCharacter.cardTags || []).map(esc).join(' / ')}</p><p class="gacha-focus-summary">${esc(currentCharacter.cardSummary || currentCharacter.skillText)}</p><span class="reveal-badge ${current.isNew ? 'new' : ''}">${current.isNew ? '首次结契' : '契约凭证 +1'}</span></article></div></section>` : '';
  return `<div class="gacha-overlay phase-${phase} rarity-${rarity.toLowerCase()} ${gachaReduceMotion ? 'reduce-motion' : ''}" role="dialog" aria-modal="true" aria-label="招募揭晓">
    <canvas id="gacha-canvas" aria-hidden="true"></canvas><div class="gacha-vignette" aria-hidden="true"></div>
    <div class="gacha-top"><div><p class="eyebrow">雾海契约 · ${esc(phaseLabel)}</p><p class="gacha-saved">真实结果已保存 · 翻牌不会再次扣券</p></div></div>
    ${['flight', 'ssr-turn', 'ssr-burst'].includes(phase) ? gachaFastForwardMarkup() : phase === 'focus' ? gachaReturnMarkup() : ''}
    <div class="gacha-stage">${phase === 'flight' ? `${ritualMarkup()}<section class="gacha-card-grid count-${Math.min(10, results.length)}" aria-label="本次招募卡阵">${cards}</section>` : phase === 'grid' ? `<section class="gacha-card-grid count-${Math.min(10, results.length)}" aria-label="本次招募卡阵">${cards}</section>` : focus}</div>
    <div class="gacha-footer">${phase === 'grid' ? gachaGridActions() : phase === 'flight' ? '<span>卡片抵达后会保持背面，等待你选择。</span>' : '<span>Esc 返回卡阵 · 已揭晓状态会保留</span>'}</div>
  </div>`;
}

function initGachaCanvas() {
  if (gachaRaf) cancelAnimationFrame(gachaRaf);
  gachaRaf = null;
  const canvas = document.querySelector('#gacha-canvas');
  if (!canvas || !gachaPresentation || gachaReduceMotion) return;
  const context = canvas.getContext('2d'); const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const hidingRarity = gachaPresentation.phase === 'flight' && !document.querySelector('.gacha-overlay.ritual-color');
  const activeRarity = hidingRarity ? 'R' : gachaPresentation.focusIndex === null ? gachaPresentation.best : gachaPresentation.results[gachaPresentation.focusIndex]?.rarity || gachaPresentation.best;
  const palette = activeRarity === 'SSR'
    ? ['#ffd995', '#e6bd72', '#9bc8c4'] : activeRarity === 'SR' ? ['#c9a4ff', '#8f78c5', '#9bc8c4'] : ['#b9d7dc', '#7fa5ad', '#dce7e4'];
  const count = gachaPresentation.phase === 'ssr-burst' ? 240 : activeRarity === 'SSR' ? 120 : activeRarity === 'SR' ? 76 : 48;
  let width = 0; let height = 0; let start = performance.now();
  const particles = Array.from({ length: count }, (_, index) => ({
    x: Math.random(), y: Math.random(), vx: (Math.random() - .5) * (index < 36 ? .24 : .055), vy: (Math.random() - .5) * (index < 36 ? .18 : .045),
    size: index < 20 ? 2.5 + Math.random() * 4.5 : .8 + Math.random() * 2.2, offset: Math.random() * 1000,
    color: palette[index % palette.length], rotation: Math.random() * Math.PI,
  }));
  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === width && rect.height === height) return;
    width = rect.width; height = rect.height; canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function frame(now) {
    resize(); context.clearRect(0, 0, width, height);
    const time = (now - start) / 1000; const cx = width / 2; const cy = height * .47;
    context.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      const burst = gachaPresentation?.phase === 'ssr-burst';
      const travel = burst ? Math.min(1, time * 1.2) : time;
      const x = burst ? cx + p.vx * width * travel * 3.2 : (p.x * width + p.vx * width * travel + width) % width;
      const y = burst ? cy + p.vy * height * travel * 3.2 : (p.y * height + p.vy * height * travel + height) % height;
      context.globalAlpha = burst ? Math.max(0, 1 - time * .56) : .14 + .38 * Math.abs(Math.sin(time * 1.4 + p.offset)); context.fillStyle = p.color;
      context.save(); context.translate(x, y); context.rotate(p.rotation + time * .4); context.fillRect(-p.size * 1.8, -p.size * .35, p.size * 3.6, p.size * .7); context.restore();
    }
    context.globalCompositeOperation = 'source-over'; context.globalAlpha = 1;
    gachaRaf = requestAnimationFrame(frame);
  }
  gachaRaf = requestAnimationFrame(frame);
}

function renderStory() {
  if (['slots', 'title'].includes(view) || quitState) return '';
  const progress = prologueProgress();
  const scene = storyReplay ? prologueScene(storyReplay.sceneId) : progress.status === 'reading' ? prologueScene(progress.currentSceneId) : null;
  if (!scene) return '';
  const persistedBeat = progress.beatIndex || 0;
  const beatIndex = storyReplay ? storyReplay.beatIndex : storyDisplayBeat ?? persistedBeat;
  // 序章开场第一步：先给"我"取名字；每个存档只问一次，回看与跳过都不再出现。
  if (!storyReplay && scene.id === 'opening' && beatIndex === 0 && !progress.backgroundSeen && !model.protagonist?.nameConfirmed) {
    return `<div class="story-overlay" role="dialog" aria-modal="true" aria-labelledby="hero-name-title"><section class="story-panel story-background story-name-panel">
      <div class="story-scene-head"><div><p class="eyebrow">开始之前 · 报上名来</p><h2 id="hero-name-title">风雨一途，敢问足下高名？</h2></div><span>序章</span></div>
      <div class="story-body">
        <p class="story-background-subtitle">飘然在这渺渺烟雨，竟不觉来到一舍会馆……</p>
        <p class="story-background-subtitle story-name-ask">「足下高名」？不记得了，或从来没有罢。</p>
        <label class="hero-name-field" for="hero-name-input"><span>你的名字</span>
          <input id="hero-name-input" data-hero-name maxlength="12" value="${esc(heroName())}" autocomplete="off" spellcheck="false" aria-describedby="hero-name-hint">
        </label>
        <p class="fine" id="hero-name-hint">若是无名无姓，此后唤你「浪人」便是。</p>
      </div>
      <div class="story-actions"><div><button class="btn ghost" data-action="back-to-title">返回初始界面</button></div><div class="story-nav"><button class="btn primary" data-action="confirm-hero-name">报上名号 <kbd>回车</kbd></button></div></div>
    </section></div>`;
  }
  if (scene.id === 'opening' && beatIndex === 0 && !(storyReplay ? storyReplay.backgroundSeen : progress.backgroundSeen)) {
    const background = model.content.prologue.background;
    if (background) return `<div class="story-overlay" role="dialog" aria-modal="true" aria-labelledby="story-title"><section class="story-panel story-background"><div class="story-scene-head"><div><p class="eyebrow">开始之前 · 主角背景</p><h2 id="story-title">${esc(background.title)}</h2></div><span>序章</span></div><div class="story-body"><p class="story-background-subtitle">${esc(background.subtitle)}</p>${background.paragraphs.map(text => `<p class="story-background-copy">${storyText(text)}</p>`).join('')}</div><div class="story-actions"><button class="btn ghost" data-action="back-to-title">返回初始界面</button><button class="btn primary" data-action="story-background-done">开门，认识队友 <kbd>空格</kbd></button></div></section></div>`;
  }
  const beat = scene.beats[beatIndex];
  const isLast = beatIndex === scene.beats.length - 1;
  const speaker = beat.speakerId ? char(beat.speakerId) : beat.speaker === '你' ? { rarity: 'SR' } : null;
  const speakerLabel = beat.speaker === '你' ? heroName() : beat.speaker;
  const introduced = beat.characterCard ? char(beat.characterCard.id) : null;
  const characterCard = beat.characterCard ? `<aside class="story-character ${introduced ? `rarity-${introduced.rarity.toLowerCase()}` : ''}"><span>${esc(beat.characterCard.label)}${introduced ? ` <b class="story-rarity">${introduced.rarity}</b>` : ''}</span><strong>${esc(beat.characterCard.role)}</strong><p>${esc(beat.characterCard.hint)}</p></aside>` : '';
  return `<div class="story-overlay" role="dialog" aria-modal="true" aria-labelledby="story-title"><section class="story-panel ${speaker ? `rarity-${speaker.rarity.toLowerCase()}` : 'story-neutral'}">
    <div class="story-scene-head"><div><p class="eyebrow">${storyReplay ? '剧情回看' : '序章 · 第一张回执'}</p><h2 id="story-title">${esc(scene.title)}</h2></div><span>${beatIndex + 1} / ${scene.beats.length}</span></div>
    <div class="story-body"><div class="story-speaker">${esc(speakerLabel)}${speaker ? `<span class="story-rarity">${speaker.rarity}</span>` : ''}</div><div class="story-copy">${storyText(beat.text)}</div><div class="story-character-slot" ${characterCard ? '' : 'aria-hidden="true"'}>${characterCard}</div></div>
    <div class="story-actions"><div>${storyReplay ? '<button class="btn ghost" data-action="exit-story-replay">退出回看</button>' : '<button class="btn ghost" data-action="skip-story-scene">跳过本段</button>'}<button class="btn ghost" data-action="back-to-title">返回初始界面</button></div><div class="story-nav"><button class="btn ghost" data-action="previous-story-beat" ${beatIndex === 0 ? 'disabled' : ''}>上一句</button><button class="btn primary" data-action="next-story-beat">${storyReplay && isLast ? '结束回看' : isLast ? esc(scene.nextAction.label) : '继续'} <kbd>空格</kbd></button></div></div>
  </section></div>`;
}

function renderStoryArchive() {
  if (!storyArchiveOpen) return '';
  const scenes = storyArchiveScenes();
  return `<div class="modal-backdrop story-archive-backdrop" role="dialog" aria-modal="true" aria-labelledby="story-archive-title"><section class="story-archive card"><div class="section-head"><div><p class="eyebrow">只读回看 · 不触发奖励</p><h2 id="story-archive-title">剧情档案</h2></div><button class="collection-close" data-action="close-story-archive" aria-label="关闭剧情档案">×</button></div>${scenes.length ? `<div class="story-archive-list">${scenes.map((scene, index) => `<button class="story-archive-entry" data-story-replay="${scene.id}"><span>${String(index + 1).padStart(2, '0')}</span><strong>${esc(scene.title)}</strong><small>${scene.beats.length} 句 · 从头回看</small></button>`).join('')}</div>` : '<div class="empty-state"><strong>档案尚未写入</strong>读完第一段剧情后，这里会保留回看入口。</div>'}</section></div>`;
}

function renderDeleteSaveDialog() {
  if (!deleteSlotId) return '';
  const slot = model.slots.find((item) => item.id === deleteSlotId && !item.empty);
  if (!slot) return '';
  return `<div class="modal-backdrop delete-save-backdrop"><section class="delete-save-dialog card" role="dialog" aria-modal="true" aria-labelledby="delete-save-title" aria-describedby="delete-save-description">
    <p class="eyebrow">危险操作 · 存档 ${slot.id}</p><h2 id="delete-save-title">删除“${esc(slot.name)}”？</h2>
    <p id="delete-save-description">这会从游戏中清除该旅程的角色、资源、剧情、装备和招募记录。操作完成后无法在游戏内撤销。</p>
    <dl><div><dt>伙伴</dt><dd>${slot.owned} 人</dd></div><div><dt>招募券</dt><dd>${slot.tickets}</dd></div><div><dt>累计招募</dt><dd>${slot.pulls}</dd></div><div><dt>已通关</dt><dd>${slot.cleared} 关</dd></div></dl>
    <label class="delete-confirm-check" for="delete-save-confirm"><input id="delete-save-confirm" type="checkbox" data-delete-confirm><span><strong>我已了解以上内容</strong><small>勾选后即可永久删除这份存档</small></span></label>
    <div class="delete-save-actions"><button class="btn ghost" data-action="cancel-delete-save">取消</button><button class="btn danger" data-action="confirm-delete-save" disabled>永久删除这份存档</button></div>
  </section></div>`;
}

/* ── 初始界面 ── */
// 斜向细雨：倾角与长度对齐背景图雨丝实测值（方向差分约 17.8°），透明度压低、边缘交给 CSS blur 做柔化。
function titleRainLayer() {
  return `<div class="title-rain" aria-hidden="true">${Array.from({ length: 50 }, (_, i) => `<i style="--x:${((i * 41) % 108) - 4}%;--y:${((i * 23) % 96) + 2}%;--delay:${((i % 13) * 0.43).toFixed(2)}s;--dur:${(2.3 + (i % 7) * 0.46).toFixed(2)}s;--len:${76 + (i % 7) * 24}px;--alpha:${(0.055 + (i % 6) * 0.021).toFixed(3)};--tilt:${(16.9 + (i % 5) * 0.45).toFixed(2)}deg"></i>`).join('')}</div>`;
}

// 右上角喇叭：只有图标，没有文字框。
function titleAudioButton() {
  const on = rainEnabled;
  const waves = on
    ? '<path d="M13.6 8.6a3.6 3.6 0 0 1 0 6.8" /><path d="M16.4 6a7.4 7.4 0 0 1 0 12" />'
    : '<path d="m14.2 9.8 4.6 4.4" /><path d="m18.8 9.8-4.6 4.4" />';
  return `<button class="title-audio" type="button" data-action="toggle-rain" aria-pressed="${on}" aria-label="${on ? '关闭初始界面环境音（雨、风、雷）' : '开启初始界面环境音（雨、风、雷）'}" title="${on ? '关闭雨声与雷声' : '开启雨声与雷声'}">
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9.4h3.2L11.6 6v12L7.2 14.6H4z" />${waves}</svg>
  </button>`;
}

function titleView() {
  const filled = model.slots.filter((slot) => !slot.empty).length;
  const options = [
    ['select', '▤', '选择存档', '翻开已有的旅团手记'],
    ['create', '✦', '新建存档', filled >= 3 ? '三个档位都已占用' : '从序章开始新的旅程'],
    ['quit', '⏻', '退出游戏', '合上会馆的门'],
  ];
  return `<main class="title-screen">
    <div class="title-photo" aria-hidden="true"></div>
    <div class="title-scrim" aria-hidden="true"></div>
    ${titleRainLayer()}
    ${titleAudioButton()}
    <section class="title-stage">
      <header class="title-brand">
        <p class="eyebrow">Mist Lantern Brigade · v0.2.1</p>
        <h1>雾灯旅团</h1>
        <p class="title-tagline">夜雨千山，微光烁烁，不问来路，只将那些离散的人，缓缓渡回此间</p>
      </header>
      <nav class="title-menu" aria-label="初始界面">${options.map(([action, glyph, label, note]) => `<button class="title-option" data-title-action="${action}"${action === 'quit' ? ' data-tone="danger"' : ''}><span class="title-option-glyph" aria-hidden="true">${glyph}</span><span class="title-option-text"><strong>${label}</strong><small>${note}</small></span></button>`).join('')}</nav>
    </section>
    ${titlePanel === 'slots' ? titleSlotsPanel() : ''}
    ${renderNewSaveDialog()}
    ${renderDeleteSaveDialog()}
    ${quitConfirm ? renderQuitDialog() : ''}
  </main>`;
}

function titleSlotsPanel() {
  return `<div class="title-panel-backdrop"><section class="title-panel" role="dialog" aria-modal="true" aria-labelledby="title-panel-heading">
    <div class="title-panel-head"><div><p class="eyebrow">旅团手记</p><h2 id="title-panel-heading">从哪一段旅程继续？</h2><p class="fine">三个档位分别保存角色、资源、剧情与免费招募次数；测试存档独立保存，不占正式档位。</p></div><button class="btn ghost" data-title-action="close-panel">返回初始界面</button></div>
    ${slotsView({ embedded: true })}
  </section></div>`;
}

function renderNewSaveDialog() {
  if (!newSaveSlotId) return '';
  const index = Number(newSaveSlotId) - 1;
  const filled = model.slots.filter((slot) => !slot.empty).length;
  return `<div class="modal-backdrop title-dialog-backdrop"><section class="title-dialog card" role="dialog" aria-modal="true" aria-labelledby="new-save-title">
    <p class="eyebrow">新建旅团手记</p><h2 id="new-save-title">点亮一间新会馆</h2>
    <p class="title-dialog-copy">这份旅程会写入 ${newSaveSlotId} 号档位，从完整开场开始，初始五人和 10 张招募券都会准备好。当前已有 ${filled} 份存档。</p>
    <label class="title-dialog-label" for="new-save-name">旅团手记名称</label>
    <input id="new-save-name" data-new-slot-name maxlength="20" value="${esc(`旅团${['一', '二', '三'][index]}`)}">
    <div class="delete-save-actions"><button class="btn ghost" data-title-action="cancel-new-save">取消</button><button class="btn primary" data-title-action="confirm-new-save">开始旅程</button></div>
  </section></div>`;
}

function renderQuitDialog() {
  return `<div class="modal-backdrop title-dialog-backdrop"><section class="title-dialog card" role="dialog" aria-modal="true" aria-labelledby="quit-title">
    <p class="eyebrow">离开会馆</p><h2 id="quit-title">要退出游戏吗？</h2>
    <p class="title-dialog-copy">进度已经自动保存。浏览器不一定允许网页自行关闭标签页，如果关不掉会显示告别画面。</p>
    <div class="delete-save-actions"><button class="btn ghost" data-title-action="cancel-quit">取消</button><button class="btn primary" data-title-action="confirm-quit">退出游戏</button></div>
  </section></div>`;
}

function quitView() {
  return `<main class="title-screen quit-screen">
    <section class="title-stage quit-stage">
      <p class="eyebrow">已退出游戏</p>
      <h1>雨停在雾里</h1>
      <p class="title-tagline">进度已经保存，可以安全关闭这个标签页了。</p>
      <button class="btn ghost" data-title-action="reopen">重新点亮会馆</button>
    </section>
  </main>`;
}

function focusTitleScreen() {
  const active = document.activeElement;
  const restore = titleFocusSelector; titleFocusSelector = null;
  if (!restore && active && active !== document.body && app.contains(active)) return;
  const selector = restore || (titlePanel === 'slots' ? '.title-panel .btn' : newSaveSlotId ? '[data-new-slot-name]' : '.title-option');
  requestAnimationFrame(() => {
    const element = app.querySelector(selector);
    element?.focus({ preventScroll: true });
    if (element?.matches('[data-new-slot-name]')) element.select();
  });
}

async function handleTitleAction(action) {
  if (action === 'select') { titlePanel = 'slots'; render(); return; }
  if (action === 'close-panel') { titlePanel = null; render(); return; }
  if (action === 'create') { await startNewSave(); return; }
  if (action === 'cancel-new-save') { newSaveSlotId = null; render(); return; }
  if (action === 'confirm-new-save') { await confirmNewSave(); return; }
  if (action === 'quit') { quitConfirm = true; render(); return; }
  if (action === 'cancel-quit') { quitConfirm = false; render(); return; }
  if (action === 'confirm-quit') { performQuit(); return; }
  if (action === 'reopen') { quitState = false; titlePanel = null; newSaveSlotId = null; quitConfirm = false; view = 'title'; render(); return; }
}

async function startNewSave() {
  if (pending) return;
  const empty = model.slots.find((slot) => slot.empty);
  if (!empty) { titlePanel = 'slots'; render(); toast('三个档位都已建立存档，请先进入一份，或删除不需要的存档', true); return; }
  newSaveSlotId = empty.id; titlePanel = null; render();
}

// 初始界面里的“刷新存档列表”：只重取一次数据，不打断初始界面。
async function refreshSaveList() {
  try {
    const response = await fetch(`/api/bootstrap?clientId=${encodeURIComponent(clientId)}`, { cache: 'no-store' });
    const data = await response.json(); if (!data.ok) throw new Error(data.error);
    Object.assign(model, data); clockOffset = data.serverNow - Date.now(); render(); toast('存档列表已刷新');
  } catch (error) { toast(error.message, true); }
}

async function confirmNewSave() {
  if (pending || !newSaveSlotId) return;
  const name = document.querySelector('[data-new-slot-name]')?.value || '';
  const slotId = newSaveSlotId;
  newSaveSlotId = null;
  await switchSave(slotId, true, name);
}

// 离开初始界面：回到会馆，进行中的战斗直接续上。
function enterGame() {
  const battle = model.save?.battle;
  if (model.activeSlotId === 'test') view = 'workbench';
  else if (battle && ['active', 'paused'].includes(battle.status)) { view = 'battle'; focusId = battle.focusId; strategy = battle.strategy; }
  else view = 'home';
  titlePanel = null;
  render();
}

function performQuit() {
  quitConfirm = false;
  syncRain(false);
  try { window.close(); } catch { /* 浏览器可能禁止脚本关闭标签页 */ }
  setTimeout(() => {
    if (document.hidden) return;
    quitState = true; titlePanel = null; newSaveSlotId = null;
    render();
  }, 220);
}

function render() {
  clearBattleEffects();
  clearTimeout(timer);
  if (!model) return;
  if (!model.save && view !== 'title') view = 'slots';
  if (view === 'title' || quitState) {
    const modalOpen = Boolean(quitState || quitConfirm || newSaveSlotId || deleteSlotId || titlePanel === 'slots');
    document.body.classList.toggle('modal-open', modalOpen);
    app.innerHTML = quitState ? quitView() : titleView();
    if (!quitState) syncRain(rainEnabled); else syncRain(false);
    syncBgm(false);
    if (!quitState) focusTitleScreen();
    return;
  }
  syncRain(false);
  // 翻牌演出期间停掉会馆背景乐，避免盖住契约音效；演出结束后自动续上。
  syncBgm(!gachaPresentation);
  const content = view === 'slots' ? slotsView() : view === 'home' ? homeView() : view === 'battle' ? battleView() : view === 'recruit' ? recruitView() : view === 'roster' ? rosterView() : view === 'collection' ? collectionView() : view === 'equipment' ? equipmentView() : view === 'workbench' ? workbenchView() : settingsView();
  const modalOpen = Boolean(deleteSlotId || gachaPresentation || (view !== 'slots' && (storyReplay || prologueProgress().status === 'reading')) || storyArchiveOpen || collectionDetailId);
  document.body.classList.toggle('modal-open', modalOpen);
  app.innerHTML = `<div class="app-shell" ${modalOpen ? 'inert aria-hidden="true"' : ''}>${nav()}<div class="main">${topbar()}<main class="page">${model.mode === 'readonly' ? '<div class="banner readonly">另一个标签页正在写入；本页暂为只读。关闭旧页并等待约 20 秒后刷新可接管。</div>' : ''}${model.activeSlotId === 'test' ? '<div class="banner test-mode-banner">测试存档 · 独立保存，可在测试工作台编辑资源与领取角色</div>' : ''}${['home', 'slots', 'workbench', 'battle'].includes(view) ? '' : storyGoalBanner()}${content}</main></div></div>${renderStory()}${renderStoryArchive()}${renderGachaOverlay()}${renderCollectionDetail()}${renderDeleteSaveDialog()}`;
  initGachaCanvas();
  scheduleBattle();
  focusHeroNameInput();
}

// 命名页出现时把光标放进输入框，回车即可确认。
function focusHeroNameInput() {
  const input = app.querySelector('[data-hero-name]');
  if (!input || document.activeElement === input) return;
  requestAnimationFrame(() => { input.focus({ preventScroll: true }); input.select?.(); });
}

function scheduleBattle() {
  clearTimeout(timer);
  const b = model?.save?.battle;
  if (view !== 'battle' || !b || b.status !== 'active' || pending || model.mode !== 'writer') return;
  const actionDelay = BATTLE_ACTION_MS / Math.max(1, Math.min(5, speed));
  timer = setTimeout(async () => {
    const result = await act('battle_step', { focusId: focusId || b.focusId, strategy }, { quiet: true });
    const current = model.save.battle;
    const session = model.save.repeatSession;
    if (result && current?.status === 'victory' && autoRepeat && model.save.unlocks.autoRepeat && session?.id === current.repeatSessionId && session.status === 'active' && !session.stopAfterBattle) {
      timer = setTimeout(() => act('battle_start', { stageId: current.stageId, repeat: true, repeatSessionId: session.id }, { quiet: true }), 900 / Math.max(1, Math.min(5, speed)));
    }
  }, actionDelay);
}

async function finishCurrentStoryScene(skipped = false) {
  const scene = prologueScene(prologueProgress().currentSceneId); if (!scene) return;
  const result = await act(skipped ? 'story_skip' : 'story_finish', { sceneId: scene.id }, { quiet: true });
  if (!result) return;
  storyDisplayBeat = null;
  const next = result.nextAction || scene.nextAction;
  if (next.kind === 'scene' && next.sceneId) { await act('story_begin', { sceneId: next.sceneId }, { quiet: true }); return; }
  if (next.kind === 'battle' && next.stageId) {
    view = 'battle';
    if (!skipped) await act('battle_start', { stageId: next.stageId }, { quiet: true }); else render();
    return;
  }
  if (next.kind === 'equipment_then_prepare') view = 'equipment';
  else if (next.kind === 'prepare' && next.stageId) view = 'battle';
  else view = 'home';
  render();
}

// 序章取名页确认：留空视为"想不起来"，沿用默认名「浪人」。
async function submitHeroName() {
  const input = document.querySelector('[data-hero-name]');
  const typed = (input?.value || '').trim();
  const name = typed || (model.protagonist?.name || '浪人');
  if (typed && input && !input.reportValidity()) return;
  const result = await act('set_protagonist_name', { name }, { quiet: true });
  if (result) toast(typed ? `此后，同伴会称你为「${result.name}」` : `不记得也无妨，此后便唤你「${result.name}」`);
}

// 设置页改名：与序章同一个服务端动作。
async function saveHeroNameFromSettings() {
  const input = document.querySelector('[data-hero-name-input]');
  if (input && !input.reportValidity()) return;
  const name = (input?.value || '').trim();
  if (!name) { toast('名字不能为空（1～12 个字）', true); input?.focus(); return; }
  const result = await act('set_protagonist_name', { name });
  if (result) toast(`名字已改为「${result.name}」`);
}

async function nextStoryBeat() {
  if (document.querySelector('[data-hero-name]')) return;   // 命名这一步用回车或按钮确认，空格不越过
  if (document.querySelector('[data-action="story-background-done"]')) { await finishStoryBackground(); return; }
  if (storyReplay) {
    const scene = prologueScene(storyReplay.sceneId);
    if (storyReplay.beatIndex < scene.beats.length - 1) storyReplay.beatIndex += 1;
    else storyReplay = null;
    render(); return;
  }
  const progress = prologueProgress(); const scene = prologueScene(progress.currentSceneId); if (!scene) return;
  const shown = storyDisplayBeat ?? progress.beatIndex;
  if (shown < progress.beatIndex) {
    storyDisplayBeat = shown + 1 === progress.beatIndex ? null : shown + 1; render(); return;
  }
  if (progress.beatIndex < scene.beats.length - 1) {
    const result = await act('story_advance', { sceneId: scene.id }, { quiet: true }); if (result) storyDisplayBeat = null;
    return;
  }
  await finishCurrentStoryScene(false);
}

async function finishStoryBackground() {
  if (storyReplay) { storyReplay.backgroundSeen = true; render(); }
  else await act('story_background', {}, { quiet: true });
}

function clearEquipmentInteraction() {
  equipmentDrag = null;
  document.querySelectorAll('.equipment-dragging, .equipment-drop-target').forEach((node) => node.classList.remove('equipment-dragging', 'equipment-drop-target'));
}
async function equipmentWear(equipmentId, characterId, slot) {
  const item = equipmentById(equipmentId);
  if (!item || !characterId || item.slot !== slot) return toast('只能放入相同类型的装备槽', true);
  const result = await act('equipment_update', { equipmentId, targetCharacterId: characterId, targetSlot: slot, expectedUpdatedAt: model.save.updatedAt });
  if (result) { equipmentSelection = null; clearEquipmentInteraction(); render(); toast(result.action === 'swap' ? '已交换两名伙伴的装备' : result.action === 'move' ? '已移动装备' : result.action === 'replace' ? '已替换装备，旧装备回到库中' : '已穿戴装备'); }
}
async function equipmentUnequip(equipmentId, characterId) {
  const result = await act('unequip', { equipmentId, characterId, expectedUpdatedAt: model.save.updatedAt });
  if (result) { equipmentSelection = null; clearEquipmentInteraction(); render(); toast('装备已卸下，回到装备库'); }
}
function selectEquipmentTarget(characterId) {
  if (!model.save.owned[characterId]) return;
  equipmentTargetId = characterId; equipmentOtherOpen = !model.save.party.includes(characterId) || equipmentOtherOpen; render();
}
function handleEquipmentSlotClick(slotElement) {
  const slot = slotElement.dataset.equipmentSlot; const characterId = slotElement.dataset.equipmentCharacter; const itemId = equipmentInfo(characterId)?.equipmentBySlot?.[slot];
  if (equipmentSelection?.type === 'item') {
    const item = equipmentById(equipmentSelection.equipmentId);
    if (item?.slot !== slot) return toast(`这是${equipmentSlotName(item?.slot)}，不能放入${equipmentSlotName(slot)}槽`, true);
    equipmentWear(item.id, characterId, slot); return;
  }
  equipmentSelection = { type: 'slot', characterId, slot, equipmentId: itemId || null }; render();
}
app.addEventListener('dragstart', (event) => {
  const itemElement = event.target.closest('[data-equipment-item]'); const slotElement = event.target.closest('[data-equipment-slot]');
  const equipmentId = itemElement?.dataset.equipmentItem || (slotElement ? equipmentInfo(slotElement.dataset.equipmentCharacter)?.equipmentBySlot?.[slotElement.dataset.equipmentSlot] : null);
  if (!equipmentId) return;
  equipmentDrag = { equipmentId }; event.dataTransfer?.setData('text/plain', equipmentId); event.dataTransfer?.setData('application/x-mist-equipment', equipmentId); event.dataTransfer.effectAllowed = 'move'; event.target.closest('.equipment-card, .equipment-slot')?.classList.add('equipment-dragging');
});
app.addEventListener('dragover', (event) => {
  const slotElement = event.target.closest('[data-equipment-slot]'); if (!slotElement) return;
  const equipmentId = equipmentDrag?.equipmentId || event.dataTransfer?.getData('application/x-mist-equipment') || event.dataTransfer?.getData('text/plain'); const item = equipmentById(equipmentId);
  const legal = Boolean(item && item.slot === slotElement.dataset.equipmentSlot);
  slotElement.classList.toggle('equipment-drop-target', legal);
  if (legal) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }
});
app.addEventListener('dragleave', (event) => { const slotElement = event.target.closest('[data-equipment-slot]'); if (slotElement && !slotElement.contains(event.relatedTarget)) slotElement.classList.remove('equipment-drop-target'); });
app.addEventListener('drop', async (event) => {
  const slotElement = event.target.closest('[data-equipment-slot]'); if (!slotElement) return;
  const equipmentId = equipmentDrag?.equipmentId || event.dataTransfer?.getData('application/x-mist-equipment') || event.dataTransfer?.getData('text/plain'); const item = equipmentById(equipmentId);
  if (!item || item.slot !== slotElement.dataset.equipmentSlot) { clearEquipmentInteraction(); return; }
  event.preventDefault(); clearEquipmentInteraction(); await equipmentWear(item.id, slotElement.dataset.equipmentCharacter, slotElement.dataset.equipmentSlot);
});
app.addEventListener('dragend', clearEquipmentInteraction);

app.addEventListener('click', async (event) => {
  if (gachaPresentation?.phase === 'grid' && event.target.closest('.gacha-overlay') && !event.target.closest('button, a, .common-reveal-ghost')) { revealCommonGachaCards(); return; }
  const equipmentTarget = event.target.closest('[data-equipment-item], [data-equipment-slot], [data-equipment-remove], [data-equipment-target]');
  if (equipmentTarget) {
    if (equipmentTarget.matches('[data-equipment-item]')) { equipmentSelection = { type: 'item', equipmentId: equipmentTarget.dataset.equipmentItem }; render(); return; }
    if (equipmentTarget.matches('[data-equipment-target]')) { selectEquipmentTarget(equipmentTarget.dataset.equipmentTarget); return; }
    if (equipmentTarget.matches('[data-equipment-remove]')) { await equipmentUnequip(equipmentTarget.dataset.equipmentRemove, equipmentTarget.dataset.equipmentCharacter); return; }
    if (equipmentTarget.matches('[data-equipment-slot]')) { handleEquipmentSlotClick(equipmentTarget); return; }
  }
  const target = event.target.closest('button, a, [data-focus]'); if (!target) return;
  if (target.dataset.titleAction) { await handleTitleAction(target.dataset.titleAction); return; }
  if (target.matches('[data-protagonist-detail]')) { collectionDetailId = 'protagonist'; render(); return; }
  if (target.matches('[data-action="confirm-hero-name"]')) { await submitHeroName(); return; }
  if (target.matches('[data-action="save-hero-name"]')) { await saveHeroNameFromSettings(); return; }
  if (target.matches('[data-action="story-background-done"]')) { await finishStoryBackground(); return; }
  if (target.matches('[data-slot-delete]')) {
    deleteSlotId = target.dataset.slotDelete; render();
    requestAnimationFrame(() => document.querySelector('[data-delete-confirm]')?.focus()); return;
  }
  if (target.dataset.action === 'cancel-delete-save') {
    const returnSlotId = deleteSlotId; deleteSlotId = null; render();
    requestAnimationFrame(() => document.querySelector(`[data-slot-delete="${returnSlotId}"]`)?.focus()); return;
  }
  if (target.dataset.action === 'confirm-delete-save') { await deleteSaveSlot(); return; }
  if (target.matches('[data-slot-create]')) { await switchSave(target.dataset.slotCreate, true); return; }
  if (target.matches('[data-slot-select]')) { if (target.dataset.slotSelect === model.activeSlotId) { enterGame(); } else await switchSave(target.dataset.slotSelect); return; }
  if (target.matches('[data-free-pull]')) {
    if (pendingGachaResults()) { startGachaPresentation(model.save.gacha.lastResults, { resume: true }); toast('先揭晓上一批契约，再领取免费招募'); return; }
    ensureAudio(); const result = await act('free_gacha', { offerId: target.dataset.freePull });
    if (result?.results) { pool = result.pool; startGachaPresentation(result.results); } return;
  }
  if (target.matches('[data-form-cell]')) {
    if (suppressFormationClick) return;
    const index = Number(target.dataset.formCell);
    if (formationSelection === null) { if (formationDraft[index]) { formationSelection = index; render(); document.querySelector(`[data-form-cell="${index}"]`)?.focus({preventScroll:true}); } }
    else if (formationSelection === index) { formationSelection = null; render(); }
    else moveFormation(formationSelection, index);
    return;
  }
  if (target.matches('[data-gacha-skip]')) { skipGachaMotion(); return; }
  if (target.matches('[data-gacha-card]')) { revealGachaCard(Number(target.dataset.gachaCard)); return; }
  if (target.matches('[data-gacha-common]')) { revealCommonGachaCards(); return; }
  if (target.matches('[data-gacha-return]')) { returnToGachaGrid(); return; }
  if (target.matches('[data-gacha-accept]')) { closeGachaPresentation(true); return; }
  if (target.matches('[data-gacha-continue]')) { startGachaPresentation(model.save.gacha.lastResults, { resume: true }); return; }
  if (target.matches('[data-collection-id]')) { collectionDetailId = target.dataset.collectionId; await act('collection_viewed', { characterId: collectionDetailId }, { quiet: true }); return; }
  if (target.matches('[data-collection-train]')) { collectionDetailId = null; view = 'roster'; render(); return; }
  if (target.matches('[data-story-begin]')) { storyDisplayBeat = null; await act('story_begin', { sceneId: target.dataset.storyBegin }, { quiet: true }); return; }
  if (target.matches('[data-story-replay]')) { storyArchiveOpen = false; storyReplay = { sceneId: target.dataset.storyReplay, beatIndex: 0 }; render(); return; }
  if (target.matches('[data-view]')) {
    if (view === 'roster' && target.dataset.view !== 'roster') clearFormationDraft();
    if (!model.save && target.dataset.view !== 'slots') { view = 'slots'; render(); toast('请先新建一份旅团手记'); return; }
    if (view === 'battle' && target.dataset.view !== 'battle' && model.save.battle && ['active', 'paused'].includes(model.save.battle.status)) await act('battle_pause', { reason: '离开战斗页，已自动暂停' }, { quiet: true });
    view = target.dataset.view; render(); return;
  }
  if (target.matches('[data-pool]')) { pool = target.dataset.pool; render(); return; }
  if (target.matches('[data-equipment-slot-filter]')) { equipmentSlotFilter = target.dataset.equipmentSlotFilter; render(); return; }
  if (target.matches('[data-speed]')) { const nextSpeed = Number(target.dataset.speed); if (nextSpeed === 5 && !model.save.story.clearedStages.includes(model.save.battle?.stageId)) return toast('完成本关首胜后才开放 5×', true); if (![1, 2, 3, 5].includes(nextSpeed)) return; speed = nextSpeed; sessionStorage.setItem('mist-speed', speed); render(); return; }
  if (target.matches('[data-focus]')) { focusId = target.dataset.focus; await act('battle_focus', { focusId }, { quiet: true }); return; }
  if (target.matches('[data-start-stage]')) {
    if (model.save.battle?.status === 'active' && target.dataset.startStage === model.save.battle.stageId) { view = 'battle'; render(); return; }
    const stageId = target.dataset.startStage; const repeat = autoRepeat && model.save.unlocks.autoRepeat && model.save.story.clearedStages.includes(stageId);
    const result = await act('battle_start', { stageId, repeat }); if (result) { view = 'battle'; focusId = result.battle.focusId; render(); } return;
  }
  if (target.matches('[data-pull]')) {
    if (pendingGachaResults()) { startGachaPresentation(model.save.gacha.lastResults, { resume: true }); toast('上一次契约仍待揭晓，已为你恢复卡阵'); return; }
    ensureAudio();
    const result = await act('gacha', { pool, count: Number(target.dataset.pull) });
    if (result?.results?.length) startGachaPresentation(result.results);
    return;
  }
  if (target.matches('[data-level]')) { await act('level_up', { characterId: target.dataset.level }); return; }
  if (target.matches('[data-breakthrough]')) { await act('breakthrough', { characterId: target.dataset.breakthrough }); return; }
  if (target.matches('[data-recycle]')) { await act('recycle', { characterId: target.dataset.recycle }); return; }
  if (target.matches('[data-buy-selector]')) { await act('buy_selector', { kind: target.dataset.buySelector }); return; }
  if (target.matches('[data-choose-selector]')) {
    const kind = target.dataset.chooseSelector; const choice = document.querySelector(`[data-selector-choice="${kind}"]`);
    await act('choose_selector', { kind, characterId: choice.value }); return;
  }
  if (target.matches('[data-equip]')) { await act('equip', { equipmentId: target.dataset.equip, characterId: equipmentTargetId, expectedUpdatedAt: model.save.updatedAt }); return; }
  const action = target.dataset.action;
  if (action === 'reload') { if (view === 'title') { await refreshSaveList(); return; } return location.reload(); }
  if (action === 'toggle-rain') {
    rainEnabled = !rainEnabled; localStorage.setItem('mist-rain', rainEnabled ? 'on' : 'off');
    titleFocusSelector = '[data-action="toggle-rain"]';
    render(); toast(rainEnabled ? '雨声与远处的雷声已开启' : '初始界面环境音已关闭'); return;
  }
  if (action === 'back-to-title') {
    if (view === 'battle' && model.save?.battle && ['active', 'paused'].includes(model.save.battle.status)) await act('battle_pause', { reason: '返回初始界面，已自动暂停' }, { quiet: true });
    view = 'title'; titlePanel = null; newSaveSlotId = null; quitConfirm = false; quitState = false; render(); return;
  }
  if (action === 'test-resources') {
    const inputs = [...document.querySelectorAll('[data-test-resource]')];
    if (!inputs.length || inputs.some(input => !input.reportValidity())) return;
    await act('test_resources', { resources: Object.fromEntries(inputs.map(input => [input.dataset.testResource, Number(input.value)])) }); return;
  }
  if (action === 'test-grant') {
    const input = document.querySelector('[data-test-count]'); if (!input?.reportValidity()) return;
    const result = await act('test_grant', { characterId: document.querySelector('[data-test-character]').value, count: Number(input.value) }, { quiet: true });
    if (result) toast(`已领取 ${result.name} ×${result.count}，${result.isNew ? '角色已解锁，其余作为凭证' : '已加入重复凭证'}`); return;
  }
  if (action === 'resume-story') { storyDisplayBeat = null; render(); return; }
  if (action === 'next-story-beat') { await nextStoryBeat(); return; }
  if (action === 'previous-story-beat') {
    if (storyReplay) storyReplay.beatIndex = Math.max(0, storyReplay.beatIndex - 1);
    else storyDisplayBeat = Math.max(0, (storyDisplayBeat ?? prologueProgress().beatIndex) - 1);
    render(); return;
  }
  if (action === 'skip-story-scene') { await finishCurrentStoryScene(true); return; }
  if (action === 'exit-story-replay') { storyReplay = null; render(); return; }
  if (action === 'open-story-archive') { storyArchiveOpen = true; render(); return; }
  if (action === 'close-story-archive') { storyArchiveOpen = false; render(); return; }
  if (action === 'close-collection-detail') { collectionDetailId = null; render(); return; }
  if (action === 'apply-collection-search') { collectionSearch = document.querySelector('[data-collection-search]')?.value || ''; render(); return; }
  if (action === 'clear-collection-filters') { collectionSearch = ''; collectionRarity = 'all'; collectionRole = 'all'; collectionOwned = 'all'; collectionGroup = 'all'; collectionUnownedFirst = false; collectionSort = 'rarity'; render(); return; }
  if (action === 'pause-battle') { await act('battle_pause', { reason: '玩家立即暂停' }); return; }
  if (action === 'resume-battle') { await act('battle_resume'); return; }
  if (action === 'battle-stop-after') { if (pending) { queuedStopAfter = true; toast('已记录：本场结算后汇总'); return; } await act('battle_stop_after', {}, { quiet: true }); return; }
  if (action === 'leave-battle') { await act('battle_abandon'); return; }
  if (action === 'toggle-equipment-others') { equipmentOtherOpen = !equipmentOtherOpen; render(); return; }
  if (action === 'clear-equipment-selection') { equipmentSelection = null; clearEquipmentInteraction(); render(); return; }
  if (action === 'save-party') {
    const result = await act('party', { party: partyDraft || model.save.party, formation: formationDraft || model.save.formation }); if (result) { clearFormationDraft(); render(); } return;
  }
  if (action === 'auto-party') {
    cancelFormationDrag();
    const draft = buildAutoTeam(model.content.characters, model.save.owned, formationDraft || model.save.formation);
    partyDraft = draft.party; formationDraft = draft.formation; formationSelection = null;
    render(); toast('已按品质、等级、突破配队，三排均有伙伴；可继续调整，点击保存编队生效。'); return;
  }
  if (action === 'save-wishes') {
    const wishes = [...document.querySelectorAll('[data-wish]')].map((el) => el.value); await act('set_wishes', { pool, wishes }); return;
  }
  if (action === 'pick-import') { document.querySelector('[data-import]').click(); return; }
});

app.addEventListener('change', async (event) => {
  if (event.target.matches('[data-delete-confirm]')) {
    const confirmButton = document.querySelector('[data-action="confirm-delete-save"]');
    if (confirmButton) confirmButton.disabled = !event.target.checked;
    return;
  }
  if (event.target.matches('[data-party-slot]')) {
    const slot = Number(event.target.dataset.partySlot); const next = event.target.value; const previous = partyDraft[slot]; const other = partyDraft.indexOf(next);
    partyDraft[slot] = next; if (other >= 0 && other !== slot) partyDraft[other] = previous;
    formationDraft = formationDraft.map(id => id === previous ? next : other >= 0 && id === next ? previous : id);
    formationSelection = null; render(); return;
  }
  if (event.target.matches('[data-collection-rarity]')) { collectionRarity = event.target.value; render(); return; }
  if (event.target.matches('[data-collection-role]')) { collectionRole = event.target.value; render(); return; }
  if (event.target.matches('[data-collection-owned]')) { collectionOwned = event.target.value; render(); return; }
  if (event.target.matches('[data-collection-group]')) { collectionGroup = event.target.value; render(); return; }
  if (event.target.matches('[data-collection-unowned-first]')) { collectionUnownedFirst = event.target.checked; render(); return; }
  if (event.target.matches('[data-collection-sort]')) { collectionSort = event.target.value === 'spd' ? 'spd' : 'rarity'; render(); return; }
  if (event.target.matches('[data-equipment-unworn-first]')) { equipmentUnwornFirst = event.target.checked; render(); return; }
  if (event.target.matches('[data-equipment-rarity]')) { equipmentRarityFilter = event.target.value; render(); return; }
  if (event.target.matches('[data-equipment-set]')) { equipmentSetFilter = event.target.value; render(); return; }
  if (event.target.matches('[data-strategy]')) { strategy = event.target.value; await act('battle_strategy', { strategy }, { quiet: true }); return; }
  if (event.target.matches('[data-auto-repeat]')) { autoRepeat = event.target.checked; sessionStorage.setItem('mist-auto-repeat', autoRepeat); if (autoRepeat && model.save.battle && !model.save.battle.repeatSessionId) { const enabled = await act('battle_enable_repeat', {}, { quiet: true }); if (!enabled) { autoRepeat = false; sessionStorage.setItem('mist-auto-repeat', 'false'); } } else if (!autoRepeat && model.save.repeatSession?.status === 'active') await act('battle_stop_after', {}, { quiet: true }); return; }
  if (event.target.matches('[data-past-mode]')) { await act('set_past_mode', { value: event.target.checked }); return; }
  if (event.target.matches('[data-gacha-mode]')) { gachaMode = event.target.value; localStorage.setItem('mist-gacha-mode', gachaMode); render(); return; }
  if (event.target.matches('[data-gacha-sound]')) { gachaSound = event.target.checked; localStorage.setItem('mist-gacha-sound', gachaSound ? 'on' : 'off'); if (gachaSound) ensureAudio(); return; }
  if (event.target.matches('[data-gacha-reduce]')) { gachaReduceMotion = event.target.checked; localStorage.setItem('mist-gacha-reduce', String(gachaReduceMotion)); render(); return; }
  if (event.target.matches('[data-title-rain]')) { rainEnabled = event.target.checked; localStorage.setItem('mist-rain', rainEnabled ? 'on' : 'off'); if (view === 'title') syncRain(true); else syncRain(false); return; }
  if (event.target.matches('[data-game-bgm]')) { bgmEnabled = event.target.checked; localStorage.setItem('mist-bgm', bgmEnabled ? 'on' : 'off'); syncBgm(view !== 'title'); render(); return; }
  if (event.target.matches('[data-bgm-volume]')) {
    bgmVolume = Math.min(100, Math.max(0, Number(event.target.value)));
    localStorage.setItem('mist-bgm-volume', String(bgmVolume));
    if (hallMusic) { clearInterval(hallMusic.fadeTimer); hallMusic.fadeTimer = null; hallMusic.element.volume = hallMusicLevel(); }
    render(); return;
  }
  if (event.target.matches('[data-import]')) {
    const file = event.target.files[0]; if (!file) return;
    try { const imported = JSON.parse(await file.text()); await act('import_save', { save: imported }); } catch (error) { toast(`导入失败：${error.message}`, true); }
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && view === 'battle' && model?.save?.battle && ['active', 'paused'].includes(model.save.battle.status)) {
    act('battle_pause', { reason: '页面隐藏，已自动暂停' }, { quiet: true });
  }
  // 切到后台时不继续放音乐，回到前台再接着放。
  if (document.visibilityState === 'hidden') {
    if (hallMusic && !hallMusic.element.paused) { hallMusic.autoPaused = true; hallMusicFade(0, 0.6); }
  } else if (hallMusic?.autoPaused) {
    hallMusic.autoPaused = false;
    if (bgmEnabled && !quitState && view !== 'title' && !hallMusicGapTimer) startHallMusic();
  }
});

document.addEventListener('keydown', (event) => {
  const space = event.key === ' ' || event.code === 'Space';
  const editing = event.target.matches('input, select, textarea, [contenteditable="true"]');
  if (space && event.repeat && !editing) { event.preventDefault(); return; }
  if (space && !editing && !deleteSlotId) {
    if (!['slots', 'title'].includes(view) && !quitState && (storyReplay || prologueProgress().status === 'reading')) { event.preventDefault(); nextStoryBeat(); return; }
    if (gachaPresentation) {
      event.preventDefault();
      if (gachaPresentation.phase === 'flight') skipGachaMotion();
      else if (gachaPresentation.phase === 'grid') {
        if (gachaPresentation.revealedIndices.size === gachaPresentation.results.length && !commonReveals.size) closeGachaPresentation(true);
        else if (event.target.closest('[data-gacha-card]') && !gachaPresentation.revealedIndices.has(Number(event.target.closest('[data-gacha-card]').dataset.gachaCard))) revealGachaCard(Number(event.target.closest('[data-gacha-card]').dataset.gachaCard));
        else revealCommonGachaCards();
      } else if (gachaPresentation.phase === 'focus') returnToGachaGrid();
      else if (['ssr-turn', 'ssr-burst'].includes(gachaPresentation.phase)) skipGachaMotion();
      return;
    }
    if (collectionDetailId && !event.target.matches('button')) { event.preventDefault(); collectionDetailId = null; render(); return; }
  }
  if (view === 'title' && !quitState && !deleteSlotId) {
    if (newSaveSlotId) {
      if (event.key === 'Escape') { event.preventDefault(); newSaveSlotId = null; render(); return; }
      if (event.key === 'Enter' && event.target.matches('[data-new-slot-name]')) { event.preventDefault(); confirmNewSave(); return; }
      return;
    }
    if (quitConfirm) {
      if (event.key === 'Escape') { event.preventDefault(); quitConfirm = false; render(); return; }
      return;
    }
    if (event.key === 'Escape' && titlePanel === 'slots') { event.preventDefault(); titlePanel = null; render(); return; }
    if (!titlePanel && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      const options = [...app.querySelectorAll('.title-option')];
      if (!options.length) return;
      event.preventDefault();
      const current = options.indexOf(document.activeElement);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      options[current < 0 ? 0 : (current + step + options.length) % options.length].focus({ preventScroll: true });
      return;
    }
  }
  if (event.key === 'Escape' && (formationDrag || formationSelection !== null)) { event.preventDefault(); cancelFormationDrag(); formationSelection = null; render(); return; }
  if (event.key === 'Escape' && (equipmentDrag || equipmentSelection)) { event.preventDefault(); clearEquipmentInteraction(); equipmentSelection = null; render(); return; }
  if (deleteSlotId && event.key === 'Escape') {
    event.preventDefault(); const returnSlotId = deleteSlotId; deleteSlotId = null; render();
    requestAnimationFrame(() => document.querySelector(`[data-slot-delete="${returnSlotId}"]`)?.focus()); return;
  }
  if (gachaPresentation) {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (['focus', 'ssr-turn', 'ssr-burst', 'returning'].includes(gachaPresentation.phase)) returnToGachaGrid();
      else if (gachaPresentation.phase === 'flight') skipGachaMotion();
      else if (gachaPresentation.revealedIndices.size === gachaPresentation.results.length && !commonReveals.size) closeGachaPresentation(true);
      else revealCommonGachaCards();
      return;
    }
  }
  if (!['slots', 'title'].includes(view) && !quitState && (storyReplay || prologueProgress().status === 'reading') && (event.key === ' ' || event.code === 'Space') && !event.target.matches('button, input, select, textarea')) {
    event.preventDefault(); nextStoryBeat(); return;
  }
  if (storyReplay && event.key === 'Escape') { event.preventDefault(); storyReplay = null; render(); return; }
  if (storyArchiveOpen && event.key === 'Escape') { event.preventDefault(); storyArchiveOpen = false; render(); return; }
  if (event.target.matches?.('[data-hero-name]') && event.key === 'Enter') { event.preventDefault(); submitHeroName(); return; }
  if (event.target.matches?.('[data-hero-name-input]') && event.key === 'Enter') { event.preventDefault(); saveHeroNameFromSettings(); return; }
  if (event.target.matches?.('[data-collection-search]') && event.key === 'Enter') { event.preventDefault(); collectionSearch = event.target.value; render(); return; }
  const equipmentSlot = event.target.closest?.('[data-equipment-slot]');
  if (equipmentSlot && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); handleEquipmentSlotClick(equipmentSlot); return; }
  const target = event.target.closest('[data-focus]');
  if (target && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); focusId = target.dataset.focus; render(); }
});

bootstrap();
setInterval(updateFreeClock, 1000);
