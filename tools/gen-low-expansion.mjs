// 一次性生成脚本：按《角色设计_v0.1.md》模板口径补出 L13-L120 共 108 位低稀有度角色。
// 技能实现复用 L01-L12 既有模板（skillTemplateId），数值按 R 75% / SR 85% 模板系数取整。
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));

const TEMPLATE_STATS = {
  A: { hp: 1000, attack: 120, defense: 60 },
  B: { hp: 1080, attack: 100, defense: 65 },
  D: { hp: 1100, attack: 95, defense: 65 },
  T: { hp: 1600, attack: 55, defense: 110 },
  H: { hp: 1150, attack: 90, defense: 75 },
  S: { hp: 1100, attack: 85, defense: 75 },
};

// 技能模板来源：L01-L12 一一对应 稀有度+模板，扩充角色只能引用稀有度与模板都一致的来源。
const SOURCE_BY_RARITY_TEMPLATE = {
  SR: { T: 'L01', H: 'L02', A: 'L09', D: 'L10', S: 'L11', B: 'L12' },
  R: { S: 'L03', A: 'L04', B: 'L05', T: 'L06', H: 'L07', D: 'L08' },
};

// 总数口径：基础 L01-L12 实测为 SR6（L01/L02/L09/L10/L11/L12）+ R6（L03-L08），计入注册表，
// 因此扩充 108 位需为 SR42 + R66，合计 SR48 + R72，与 SSR42 相加为 162。
// SR 扩充 42 位：T3/H7/A10/D7/S9/B6；R 扩充 66 位：S6/A12/B13/T11/H12/D12
const SR_PLAN = { T: 3, H: 7, A: 10, D: 7, S: 9, B: 6 };
const R_PLAN = { S: 6, A: 12, B: 13, T: 11, H: 12, D: 12 };

const SURNAMES = ['云', '青', '白', '苍', '明', '星', '霜', '清', '秋', '新', '初', '素', '瑾', '砚', '澜', '澜', '溪', '岚', '竹', '岩', '木', '桑', '柏', '石', '知', '闻', '见', '问', '行', '舟', '禾', '岑', '葭', '芜', '苓', '荞'];
const GIVENS = ['舟', '岚', '枝', '禾', '岚', '砚', '苓', '芜', '葭', '荞', '石', '灯', '岗', '松', '栗', '麦', '苇', '槐', '榆', '梧', '溪', '柚', '芽', '荞', '盐', '糖', '陶', '磐', '砾', '阿', '拾', '柯', '朴', '杏', '棠', '棹', '菱', '蒲', '藕', '蔗', '杏', '桃', '李', '柏', '榔', '槐', '芷', '荷', '菱', '芦', '茅', '菖', '菖', '椴', '沐', '霖', '霁', '岚', '晴', '晓', '晗', '旻', '晏', '暖', '昭', '晖', '昀', '曦', '蕤', '葳', '苒', '茴', '芨', '苜', '荠', '荞', '荔', '茗', '荃', '茧', '蕊', '菡', '蓟', '葵', '蔚', '蔷', '薇', '蘅', '麓', '穗', '稷', '稞', '稔', '稠', '礴', '碣', '磐', '砚', '硕', '础', '砾', '碌', '砂', '砚', '砌', '垛', '塬', '坳', '峁', '峭', '嶂', '嵋', '岑', '岐', '岫', '嵘', '屿', '嵘', '岫', '岐', '岚', '屿', '汀', '渚', '汐', '沅', '沚', '沁', '沨', '泠', '泓', '沚', '沐', '湛', '澈', '潆', '漪', '涟', '潞', '濯', '灏', '焰', '炘', '炀', '炫', '熠', '煊', '煦', '曦', '旸', '晟', '晏', '晁', '暝', '曙', '曈'];

const TITLES = {
  A: ['短刃信使', '旧道剑手', '徒手角斗士', '猎具修补匠', '边镇守卫', '急行斥候', '矿道护送者', '礁岸哨兵'],
  B: ['雾灯火术师', '弩车副手', '碎冰学徒', '砂石投手', '药剂师学徒', '灯笼匠', '礁石猎手', '野火巡夜人'],
  D: ['炉灰术士', '毒草采集者', '沼地牧人', '慢火厨工', '锈钉炼金徒', '湿地陷阵手', '灰烬记录员', '木炭窑工'],
  T: ['会馆看门人', '石墙匠', '桥头哨卫', '棚车护卫', '珊瑚礁守夜', '旧堡门房', '矿道支撑工', '码头扛工'],
  H: ['雾港医师', '草药学徒', '巡灯护士', '营地厨娘', '灯油贩子', '草药挑夫', '修女见习', '暖汤分送人'],
  S: ['账房助手', '驿道向导', '器具租赁员', '测风学徒', '灯芯养护工', '信号员', '旧图抄写员', '行商伙计'],
};

const GENDERS = ['女', '女', '男', '女', '男', '女'];

function statsFor(rarity, template) {
  const factor = rarity === 'SR' ? 0.85 : 0.75;
  const base = TEMPLATE_STATS[template];
  return {
    hp: Math.round(base.hp * factor),
    attack: Math.round(base.attack * factor),
    defense: Math.round(base.defense * factor),
  };
}

const characters = [];
let nameCursor = 0;
const usedNames = new Set();
function nextName() {
  while (nameCursor < SURNAMES.length * GIVENS.length) {
    const surname = SURNAMES[nameCursor % SURNAMES.length];
    const given = GIVENS[Math.floor(nameCursor / SURNAMES.length) % GIVENS.length];
    nameCursor += 1;
    const candidate = `${surname}${given}`;
    if (surname === given) continue;
    if (usedNames.has(candidate)) continue;
    usedNames.add(candidate);
    return candidate;
  }
  throw new Error('name pool exhausted');
}

let ordinal = 13;
for (const [rarity, plan] of [['SR', SR_PLAN], ['R', R_PLAN]]) {
  for (const [template, count] of Object.entries(plan)) {
    for (let index = 0; index < count; index += 1) {
      const id = `L${ordinal}`;
      ordinal += 1;
      const stats = statsFor(rarity, template);
      const titles = TITLES[template];
      characters.push({
        id,
        name: nextName(),
        gender: GENDERS[(ordinal + index) % GENDERS.length],
        title: titles[index % titles.length],
        rarity,
        template,
        skillTemplateId: SOURCE_BY_RARITY_TEMPLATE[rarity][template],
        speed: 1000,
        ...stats,
      });
    }
  }
}

if (characters.length !== 108) throw new Error(`扩充角色数量应为 108，当前 ${characters.length}`);
if (characters[0].id !== 'L13' || characters.at(-1).id !== 'L120') throw new Error('ID 范围必须是 L13-L120');
const srCount = characters.filter((c) => c.rarity === 'SR').length;
const rCount = characters.filter((c) => c.rarity === 'R').length;
if (srCount !== 42 || rCount !== 66) throw new Error(`稀有度分布错误 SR=${srCount} R=${rCount}`);
// 注册表总数口径：基础 12 位（SR6 + R6）+ 扩充 108 位 = SR48 / R72 / 合计 162
const totalSr = srCount + 6;
const totalR = rCount + 6;
if (totalSr !== 48 || totalR !== 72) throw new Error(`注册表口径错误 SR=${totalSr} R=${totalR}`);

const payload = {
  version: '0.1.0',
  mode: 'append',
  source: '按《角色设计_v0.1.md》模板口径补出的低稀有度角色',
  note: '技能实现复用 L01-L12 既有模板；数值为对应模板的 R 75% / SR 85%。',
  characters,
};

const target = path.join(root, '规划补充', '低稀有度角色扩充_v0.1.json');
fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ target, total: characters.length, sr: srCount, r: rCount, first: characters[0], last: characters.at(-1) }, null, 2));
