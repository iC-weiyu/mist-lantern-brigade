// Recommendations describe weapon/role fantasy, independently of skill templates.
// They never restrict placement or change targeting / attack range rules.
const POSITION_GROUPS = [
  { ids: ['C01','C09','C10','C24','C26','C33','C38'], row: '前排', style: '近战守护' },
  { ids: ['C02','C17','C31'], row: '前排', style: '近战输出' },
  { ids: ['C18'], row: '前排', style: '重装近战输出' },
  { ids: ['C07','C25'], row: '前排', style: '近战突击' },
  { ids: ['C05','C12','C28','C36'], row: '中排', style: '远程射击' },
  { ids: ['C04','C06','C13','C15','C23','C35','C37'], row: '中排', style: '远程施法' },
  { ids: ['C29'], row: '中排', style: '远程机关' },
  { ids: ['N41'], row: '中排', style: '远程游击' },
  { ids: ['C03','C11','C16','C21','C27','C32','C39','N42'], row: '后排', style: '治疗防护' },
  { ids: ['C08','C14','C19','C20','C22','C30','C34','N40'], row: '后排', style: '远程支援' },
];
const positions = new Map(POSITION_GROUPS.flatMap(group => group.ids.map(id => [id, { recommendedRow: group.row, combatStyle: group.style }])));

export function withPositioning(character) {
  if (character.rarity !== 'SSR') return character;
  const position = positions.get(character.id);
  if (!position) throw new Error(`SSR 缺少独立站位设定：${character.id}`);
  return { ...character, ...position };
}
