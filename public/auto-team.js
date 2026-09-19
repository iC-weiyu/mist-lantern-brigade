const ROWS = ['前排', '中排', '后排'];
const RARITY = { SSR: 3, SR: 2, R: 1 };
export function preferredRow(character) {
  return ROWS.indexOf(character.recommendedRow || (character.template === 'T' ? '前排' : ['H', 'S'].includes(character.template) ? '后排' : '中排'));
}

export function buildAutoTeam(characters, owned, previousFormation = []) {
  const ranked = characters.filter(character => owned[character.id]).sort((a, b) =>
    (RARITY[b.rarity] || 0) - (RARITY[a.rarity] || 0)
    || owned[b.id].level - owned[a.id].level
    || owned[b.id].breakthrough - owned[a.id].breakthrough
    || a.id.localeCompare(b.id));
  if (ranked.length < 5) throw new Error('至少需要五名已获得的伙伴');
  // Reserve the strongest suitable partner for each row, then fill by priority.
  const chosen = new Set(ROWS.map((_, row) => ranked.find(character => preferredRow(character) === row)?.id).filter(Boolean));
  for (const character of ranked) { if (chosen.size === 5) break; chosen.add(character.id); }
  const team = ranked.filter(character => chosen.has(character.id));
  const rows = [[], [], []];
  for (const character of team) rows[preferredRow(character)].push(character.id);
  // Any partner may be placed anywhere: still cover all rows if a role is absent.
  for (let row = 0; row < 3; row++) {
    if (rows[row].length) continue;
    const donor = rows.reduce((best, entries, index) => entries.length > rows[best].length ? index : best, 0);
    rows[row].push(rows[donor].pop());
  }
  const formation = Array(9).fill(null);
  const oldHero = previousFormation.indexOf('protagonist');
  const heroCell = oldHero >= 0 ? oldHero : 4;
  formation[heroCell] = 'protagonist';
  const overflow = [];
  for (let row = 0; row < 3; row++) {
    const cells = [row * 3 + 1, row * 3, row * 3 + 2].filter(cell => formation[cell] === null);
    for (const id of rows[row]) { const cell = cells.shift(); if (cell === undefined) overflow.push(id); else formation[cell] = id; }
  }
  for (const id of overflow) formation[formation.indexOf(null)] = id;
  return { party: team.map(character => character.id), formation };
}
