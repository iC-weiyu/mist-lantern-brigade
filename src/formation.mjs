export const HERO_POSITION_ID = 'protagonist';
export const FORMATION_ROWS = [
  { name: '前排', bonus: '生命、防御 +15%' },
  { name: '中排', bonus: '攻击 +10%' },
  { name: '后排', bonus: '治疗、护盾效果 +15%' },
];
export const FORMATION_ROW_KEYS = ['front', 'middle', 'back'];
const DEFAULT_PARTNER_CELLS = [0, 6, 7, 3, 5];

export function formationRowIndex(cell) {
  if (!Number.isInteger(cell) || cell < 0 || cell >= 9) throw new Error('阵型格子无效');
  return Math.floor(cell / 3);
}

export function ensureFormation(save) {
  const allowed = new Set([HERO_POSITION_ID, ...save.party]);
  const used = new Set();
  const cells = Array.from({ length: 9 }, (_, index) => {
    const id = save.formation?.[index];
    if (!allowed.has(id) || used.has(id)) return null;
    used.add(id); return id;
  });
  for (const id of allowed) {
    if (used.has(id)) continue;
    const preferred = id === HERO_POSITION_ID ? 4 : DEFAULT_PARTNER_CELLS[save.party.indexOf(id)];
    cells[cells[preferred] === null ? preferred : cells.indexOf(null)] = id;
    used.add(id);
  }
  save.formation = cells;
  return cells;
}

export function setFormation(save, cells) {
  const allowed = new Set([HERO_POSITION_ID, ...save.party]);
  if (!Array.isArray(cells) || cells.length !== 9) throw new Error('阵型必须有九个格子');
  const placed = cells.filter(id => id !== null);
  if (placed.length !== 6 || new Set(placed).size !== 6 || placed.some(id => !allowed.has(id))) throw new Error('请放置主角和五名出战伙伴，每人仅占一格');
  save.formation = [...cells];
  return save.formation;
}

export function applyFormationBonus(unit, cell) {
  const row = formationRowIndex(cell);
  unit.formationCell = cell;
  unit.formationRow = FORMATION_ROWS[row].name;
  unit.formationBonus = FORMATION_ROWS[row].bonus;
  if (row === 0) {
    unit.maxHp = Math.round(unit.maxHp * 1.15); unit.hp = unit.maxHp;
    unit.defense = Math.round(unit.defense * 1.15);
  } else if (row === 1) unit.attack = Math.round(unit.attack * 1.10);
  unit.healingMultiplier = row === 2 ? 1.15 : 1;
  unit.shieldMultiplier = row === 2 ? 1.15 : 1;
  return unit;
}
