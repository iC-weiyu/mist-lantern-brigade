import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContent } from './src/content.mjs';
import { SaveSlots } from './src/save-slots.mjs';
import { freeRecruitStatus, claimFreeRecruit } from './src/free-recruit.mjs';
import { protagonistSummary } from './src/protagonist.mjs';
import { ensureFormation, setFormation } from './src/formation.mjs';
import { setTestResources, grantTestCharacter } from './src/test-workbench.mjs';
import {
  createSave, performGacha, startBattle, stepBattle, enableRepeatSession, pauseBattle, resumeBattle, stopAfterBattle, abandonBattle, suspendInterruptedBattle, levelUp, breakthrough, recycleDupe,
  chooseSelector, buySelector, viewCollectionEntry, validateImportedSave, idempotent, TUTORIAL_STAGES,
  beginStoryScene, advanceStoryBeat, finishStoryScene, characterProgressPreview, equipmentOverview, updateEquipment,
} from './src/engine.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const runtimeDir = path.join(root, 'runtime');
const savePath = process.env.MIST_SAVE_PATH ? path.resolve(process.env.MIST_SAVE_PATH) : path.join(runtimeDir, 'save.json');
const content = loadContent(root);
fs.mkdirSync(runtimeDir, { recursive: true });
fs.mkdirSync(path.dirname(savePath), { recursive: true });
const saves = new SaveSlots(savePath, content);
let lease = { clientId: null, expiresAt: 0 };
function snapshot() {
  const now = Date.now();
  const save = saves.save;
  const characterPreviews = save ? Object.fromEntries(Object.keys(save.owned).map((id) => [id, characterProgressPreview(save, content, id)])) : {};
  return { save, ...saves.state(), protagonist: protagonistSummary(save), characterPreviews, equipmentState: save ? equipmentOverview(save, content) : null, serverNow: now, freeRecruit: save ? freeRecruitStatus(save, now) : [] };
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function bodyOf(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 5_000_000) throw new Error('请求过大'); }
  return raw ? JSON.parse(raw) : {};
}

function leaseFor(clientId) {
  const now = Date.now();
  if (!lease.clientId || lease.expiresAt < now || lease.clientId === clientId) {
    lease = { clientId, expiresAt: now + 20_000 }; return 'writer';
  }
  return 'readonly';
}

function compactContent() {
  return {
    version: content.version, characters: content.characters, equipmentSets: content.equipmentSets, themes: content.themes,
    stages: TUTORIAL_STAGES, prologue: content.prologue,
  };
}

function assertWriter(clientId) {
  if (leaseFor(clientId) !== 'writer') throw new Error('另一个标签页正在写入，本页暂为只读');
}

async function api(req, res, url) {
  const clientId = req.headers['x-client-id'] || url.searchParams.get('clientId') || 'anonymous';
  if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
    if (leaseFor(clientId) === 'writer' && saves.save?.repeatSession?.status === 'active') {
      const interrupted = structuredClone(saves.save);
      if (suspendInterruptedBattle(interrupted)) saves.commit(interrupted);
    }
    return json(res, 200, { ok: true, mode: leaseFor(clientId), ...snapshot(), content: compactContent() });
  }
  if (req.method === 'GET' && url.pathname === '/api/free-recruit') {
    saves.assertSelection(url.searchParams.get('slotId'), url.searchParams.get('selectionToken'));
    if (!saves.save) throw new Error('请先新建存档');
    const now = Date.now();
    return json(res, 200, { ok: true, serverNow: now, freeRecruit: freeRecruitStatus(saves.save, now) });
  }
  if (req.method === 'GET' && url.pathname === '/api/export') {
    saves.assertSelection(url.searchParams.get('slotId'), url.searchParams.get('selectionToken'));
    if (!saves.save) throw new Error('请先新建存档');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="mist-lantern-save.json"' });
    return res.end(JSON.stringify(saves.save, null, 2));
  }
  if (req.method !== 'POST' || !['/api/action', '/api/slots'].includes(url.pathname)) return json(res, 404, { ok: false, error: 'API 不存在' });
  const input = await bodyOf(req);
  assertWriter(clientId);
  saves.assertSelection(input.slotId, input.selectionToken);
  if (url.pathname === '/api/slots') {
    if (!['create', 'select', 'delete'].includes(input.operation)) throw new Error('未知存档操作');
    if (input.operation === 'delete') {
      if (input.confirmed !== true) throw new Error('请先勾选删档确认框');
      const result = saves.remove(input.targetSlotId);
      return json(res, 200, { ok: true, result, mode: 'writer', ...snapshot() });
    }
    saves.select(input.targetSlotId, input.operation === 'create', input.name);
    return json(res, 200, { ok: true, mode: 'writer', ...snapshot() });
  }
  if (!saves.save) throw new Error('请先新建存档');
  if (input.type?.startsWith('test_') && saves.activeSlotId !== 'test') throw new Error('工作台仅可操作独立测试存档');
  let save = structuredClone(saves.save);
  const result = idempotent(save, input.txId, () => {
    switch (input.type) {
      case 'test_resources': return setTestResources(save, input.resources);
      case 'test_grant': return grantTestCharacter(save, content, input.characterId, input.count);
      case 'story_begin': return beginStoryScene(save, content, input.sceneId);
      case 'story_background': save.story.prologue.backgroundSeen = true; return { backgroundSeen: true };
      case 'story_advance': return advanceStoryBeat(save, content, input.sceneId);
      case 'story_finish': return finishStoryScene(save, content, input.sceneId, false);
      case 'story_skip': return finishStoryScene(save, content, input.sceneId, true);
      case 'set_wishes': {
        const key = input.pool === 'beginner' ? 'beginnerWishes' : 'commonWishes';
        save.gacha[key] = input.wishes.slice(0, 3).map((id) => id || ''); return { wishes: save.gacha[key] };
      }
      case 'set_past_mode': save.gacha.pastMode = Boolean(input.value); return { pastMode: save.gacha.pastMode };
      case 'gacha': {
        if (![1, 10].includes(input.count)) throw new Error('请选择单次或十次招募');
        return { results: performGacha(save, content, input.pool, input.count) };
      }
      case 'free_gacha': return claimFreeRecruit(save, content, input.offerId);
      case 'party': {
        const party = [...new Set(input.party)];
        if (party.length !== 5 || party.some((id) => !save.owned[id])) throw new Error('请配置五名已招募且不重复的角色');
        const oldParty = save.party;
        save.party = party;
        if (input.formation) setFormation(save, input.formation);
        else {
          save.formation = save.formation?.map(id => oldParty.includes(id) ? party[oldParty.indexOf(id)] : id);
          ensureFormation(save);
        }
        return { party, formation: save.formation };
      }
      case 'level_up': return levelUp(save, input.characterId);
      case 'breakthrough': return { breakthrough: breakthrough(save, input.characterId) };
      case 'recycle': return { shards: recycleDupe(save, input.characterId, content) };
      case 'buy_selector': buySelector(save, input.kind); return { kind: input.kind };
      case 'choose_selector': chooseSelector(save, input.characterId, input.kind, content); return { characterId: input.characterId };
      case 'collection_viewed': return viewCollectionEntry(save, input.characterId, content);
      case 'battle_start': {
        if (save.battle && ['active', 'paused'].includes(save.battle.status)) throw new Error('请先暂停或结束当前战斗');
        return { battle: startBattle(save, content, input.stageId, { repeat: Boolean(input.repeat), repeatSessionId: input.repeatSessionId || null, now: Date.now() }) };
      }
      case 'battle_step': return { battle: stepBattle(save, content, input.focusId, input.strategy, { now: Date.now() }) };
      case 'battle_enable_repeat': return { repeatSession: enableRepeatSession(save, Date.now()) };
      case 'battle_focus': {
        if (!save.battle || !['active', 'paused'].includes(save.battle.status)) throw new Error('没有可调整的战斗');
        if (!save.battle.enemies.some((u) => u.id === input.focusId && u.alive)) throw new Error('集火目标不可用');
        save.battle.focusId = input.focusId; return { focusId: input.focusId };
      }
      case 'battle_strategy': {
        if (!save.battle || !['active', 'paused'].includes(save.battle.status)) throw new Error('没有可调整的战斗');
        if (!['balanced', 'offense', 'survive'].includes(input.strategy)) throw new Error('未知战斗策略');
        save.battle.strategy = input.strategy; return { strategy: input.strategy };
      }
      case 'battle_pause': return { battle: pauseBattle(save, input.reason || '玩家暂停', Date.now()) };
      case 'battle_resume': return { battle: resumeBattle(save, Date.now()) };
      case 'battle_stop_after': return { battle: stopAfterBattle(save, Date.now()) };
      case 'battle_abandon': return { battle: abandonBattle(save, input.reason || '离开战斗页', Date.now()) };
      case 'battle_error': return { battle: abandonBattle(save, input.reason || '接口错误，刷关已停止', Date.now()) };
      case 'equip': {
        if (input.expectedUpdatedAt && save.updatedAt !== input.expectedUpdatedAt) throw new Error('装备状态已更新，请刷新后重试');
        return updateEquipment(save, content, { equipmentId: input.equipmentId, targetCharacterId: input.characterId, targetSlot: input.targetSlot });
      }
      case 'equipment_update': {
        if (input.expectedUpdatedAt && save.updatedAt !== input.expectedUpdatedAt) throw new Error('装备状态已更新，请刷新后重试');
        return updateEquipment(save, content, { equipmentId: input.equipmentId, targetCharacterId: input.targetCharacterId, targetSlot: input.targetSlot });
      }
      case 'unequip': {
        if (input.expectedUpdatedAt && save.updatedAt !== input.expectedUpdatedAt) throw new Error('装备状态已更新，请刷新后重试');
        return updateEquipment(save, content, { equipmentId: input.equipmentId, targetCharacterId: input.characterId, remove: true });
      }
      case 'import_save': save = validateImportedSave(input.save, content); return { imported: true };
      default: throw new Error('未知操作');
    }
  });
  saves.commit(save);
  return json(res, 200, { ok: true, result, ...snapshot(), mode: 'writer' });
}

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
function staticFile(res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const file = path.resolve(publicDir, `.${requested}`);
  if (!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res); return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (!staticFile(res, url.pathname)) { res.writeHead(404); res.end('Not found'); }
  } catch (error) {
    console.error(error);
    json(res, 400, { ok: false, error: error.message });
  }
});

const port = Number(process.env.PORT || 4173);
server.listen(port, '127.0.0.1', () => console.log(`雾灯旅团已启动：http://localhost:${server.address().port}`));
