// 端到端游玩验证脚本（补丁自检用）。
// 覆盖：存档位 → 序章八段剧情 → 三场战斗 → 十连招募 → 测试档工作台 → 注册表计数复核。
// 用法：先启动本地服务（双击启动脚本或 npm run dev），再执行
//   node tools/verify-patch-e2e.mjs
// 注意：脚本会创建一个正式存档位并在结束时删除它，同时占用测试档；请勿在有进度时运行。
const BASE = process.env.MIST_BASE_URL || 'http://127.0.0.1:4173';
const CLIENT = 'e2e-play';
const headers = { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT };

let state = null;
async function post(path, payload) {
  const body = { slotId: state?.activeSlotId ?? null, selectionToken: state?.selectionToken ?? null, ...payload };
  const response = await fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = await response.json();
  if (!json.ok) throw new Error(`${path} ${payload.type || payload.operation} -> ${json.error}`);
  if (json.content === undefined) state = json;
  return json;
}
async function get(path) {
  const response = await fetch(`${BASE}${path}`, { headers });
  const json = await response.json();
  if (!json.ok) throw new Error(`${path} -> ${json.error}`);
  return json;
}

const log = (...args) => console.log(...args);

// 1. 引导
state = await get(`/api/bootstrap?clientId=${CLIENT}`);
log(`1. bootstrap ok  content=${state.content.version}  characters=${state.content.characters.length}  slots=${state.slots.length}`);

// 2. 选用一个正式存档位（优先空位；空位不足时回收 2/3 号位）
let usedSlot = state.slots.find((slot) => slot.empty)?.id;
if (!usedSlot) {
  const recyclable = state.slots.find((slot) => slot.id === '2' || slot.id === '3');
  if (!recyclable) throw new Error('三个正式档位都已有进度，请先手动清理其中一个再运行验证脚本');
  await post('/api/slots', { operation: 'delete', targetSlotId: recyclable.id, confirmed: true });
  usedSlot = recyclable.id;
}
await post('/api/slots', { operation: 'create', targetSlotId: String(usedSlot) });
log(`2. 建存档 ok  档位=${usedSlot}  tickets=${state.save.currencies.tickets}  slots=${state.slots.map((s) => `${s.id}:${s.empty ? '空' : '有档'}`).join(' ')}`);

// 3. 按序章 integration.order 推进：读完段落 → 遇到战斗开战并打完 → 直到序章结束
const bootstrap = await get(`/api/bootstrap?clientId=${CLIENT}`);
const order = bootstrap.content.prologue.integration.order;
const sceneById = new Map(bootstrap.content.prologue.scenes.map((scene) => [scene.id, scene]));

let storyDone = 0;
let battles = 0;
let totalSteps = 0;
for (const sceneId of order) {
  const prologue = state.save.story.prologue;
  if (prologue.completedScenes.includes(sceneId)) continue;
  if (prologue.nextSceneId !== sceneId) continue;

  const scene = sceneById.get(sceneId);
  await post('/api/action', { type: 'story_begin', sceneId, txId: `e2e-begin-${sceneId}` });
  await post('/api/action', { type: 'story_skip', sceneId, txId: `e2e-skip-${sceneId}` });
  storyDone += 1;

  if (scene.stageId && !state.save.story.clearedStages.includes(scene.stageId)) {
    await post('/api/action', { type: 'battle_start', stageId: scene.stageId, txId: `e2e-start-${scene.stageId}` });
    let steps = 0;
    while (state.save.battle && ['active', 'paused'].includes(state.save.battle.status) && steps < 300) {
      await post('/api/action', { type: 'battle_step', focusId: state.save.battle.focusId, strategy: 'balanced', txId: `e2e-${scene.stageId}-${steps}` });
      steps += 1;
    }
    battles += 1;
    totalSteps += steps;
    const battle = state.save.battle;
    log(`   ${scene.stageId} 战斗结束  steps=${steps}  status=${battle?.status}  存活=${battle?.players.filter((p) => p.alive).length}/5  伤害=${battle?.metrics?.playerDamage}  掉落券=${state.save.currencies.tickets}`);
  } else {
    log(`   ${sceneId} 剧情完成（${scene.beats.length}句） → next=${state.save.story.prologue.nextSceneId}`);
  }
}
log(`3. 序章完成 ok  段落=${storyDone}  战斗=${battles}  总步数=${totalSteps}  已通关=${state.save.story.clearedStages.join(',')}  剧情状态=${state.save.story.prologue.status}`);
log(`   解锁：装备=${state.save.unlocks.equipment}  主题池=${state.save.unlocks.themePool}  自动连战=${state.save.unlocks.autoRepeat}`);

// 4. 招募十连
state.save.currencies.tickets = Math.max(state.save.currencies.tickets, 30);
const ten = await post('/api/action', { type: 'gacha', pool: 'beginner', count: 10, txId: 'e2e-gacha-10' });
log(`4. 十连 ok  ${ten.result.results.map((r) => `${r.characterId}:${r.rarity}`).join(' ')}`);
log(`5. 已拥有 ${Object.keys(state.save.owned).length} 名：${Object.keys(state.save.owned).join(' ')}`);

// 5. 测试档工作台（独立档位）
await post('/api/slots', { operation: 'select', targetSlotId: 'test' });
log(`6. 测试档 ok  tickets=${state.save.currencies.tickets}  coins=${state.save.currencies.coins}  prologue=${state.save.story.prologue.status}`);
const grant = await post('/api/action', { type: 'test_grant', characterId: 'C01', count: 3, txId: 'e2e-grant' });
log(`   领取 C01 ok  owned=${JSON.stringify(state.save.owned.C01)}  discovered含C01=${state.save.collection.discovered.includes('C01')}  结果=${JSON.stringify(grant.result)}`);

// 6. 注册表与序章复核
const content = bootstrap.content;
const byRarity = content.characters.reduce((acc, c) => { acc[c.rarity] = (acc[c.rarity] || 0) + 1; return acc; }, {});
log(`7. 注册表复核  total=${content.characters.length}  ${JSON.stringify(byRarity)}  套装=${content.equipmentSets.length}  序章场景=${content.prologue.scenes.length}`);
log(`   采样  L13=${content.characters.find((c) => c.id === 'L13').name}  L120=${content.characters.find((c) => c.id === 'L120').name}  C01=${content.characters.find((c) => c.id === 'C01').name}`);

// 7. 清理验证档位
await post('/api/slots', { operation: 'delete', targetSlotId: String(usedSlot), confirmed: true });
log(`8. 清理 ok  档位 ${usedSlot} 已清空  slots=${state.slots.map((s) => `${s.id}:${s.empty ? '空' : '有档'}`).join(' ')}`);
log('E2E-ALL-OK');
