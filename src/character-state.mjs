export const CHARACTER_CATALOG_VERSION = 'batch-e-v1.5';

export const OPEN_SSR_IDS = Object.freeze([
  'C01', 'C02', 'C03', 'C04', 'C06', 'C07', 'C08', 'C09', 'C15', 'C18', 'C20', 'C21',
  'C34', 'C35', 'C36', 'N40', 'N41', 'N42',
]);

export const RESERVED_SSR_IDS = Object.freeze([
  'C10', 'C19', 'C22', 'C23', 'C24', 'C25', 'C26', 'C27', 'C29', 'C30',
  'C31', 'C32', 'C33', 'C37', 'C38', 'C39',
]);

export const DEMOTED_SR_IDS = Object.freeze(['C05', 'C11', 'C12', 'C13', 'C14', 'C16', 'C17', 'C28']);

const open = new Set(OPEN_SSR_IDS);
const reserved = new Set(RESERVED_SSR_IDS);
const demoted = new Set(DEMOTED_SR_IDS);

export function catalogStatusForId(id) {
  if (open.has(id)) return 'open';
  if (reserved.has(id)) return 'reserve';
  if (demoted.has(id)) return 'demoted';
  return 'standard';
}

export function applyCharacterCatalog(characters) {
  return characters.map((character) => {
    const status = catalogStatusForId(character.id);
    if (status === 'standard' && !/^L\d{2,3}$/.test(character.id)) {
      throw new Error(`角色 ${character.id} 不在批次 E 权威名单中`);
    }
    const currentRarity = status === 'demoted' ? 'SR' : character.rarity;
    return {
      ...character,
      baseRarity: character.rarity,
      currentRarity,
      rarity: currentRarity,
      catalogStatus: status,
      legacyPool: character.pool,
      pool: status === 'demoted' ? 'low' : character.pool,
    };
  });
}

export function currentSsrCandidates(content, pool) {
  return content.characters
    .filter((character) => character.currentRarity === 'SSR' && character.catalogStatus === 'open' && character.pool === pool)
    .map((character) => character.id);
}

export function legacySsrCandidates(content, pool) {
  return content.characters
    .filter((character) => character.baseRarity === 'SSR' && character.legacyPool === pool)
    .map((character) => character.id);
}

export function currentLowCandidates(content, rarity) {
  return content.characters
    .filter((character) => character.pool === 'low' && character.currentRarity === rarity)
    .map((character) => character.id);
}

export function displayRarity(character, owned) {
  if (character?.catalogStatus === 'demoted' && owned?.acquiredRarity === 'SSR') return 'SR · 历史 SSR';
  return character?.currentRarity || character?.rarity || 'R';
}

export function currentRarity(character) {
  return character?.currentRarity || character?.rarity || 'R';
}

export function isCurrentOpenSsr(character) {
  return Boolean(character && character.currentRarity === 'SSR' && character.catalogStatus === 'open');
}

export function selectorCandidates(content, kind) {
  return currentSsrCandidates(content, kind === 'common' ? 'standard' : 'past');
}

function legacySelectorEntry(content, kind) {
  return {
    version: 'legacy-ssr-v1',
    candidateIds: legacySsrCandidates(content, kind === 'common' ? 'standard' : 'past'),
  };
}

function currentSelectorEntry(content, kind) {
  return {
    version: CHARACTER_CATALOG_VERSION,
    candidateIds: selectorCandidates(content, kind),
  };
}

export function ensureCatalogState(save, content) {
  save.catalog ||= { version: CHARACTER_CATALOG_VERSION };
  save.catalog.version = CHARACTER_CATALOG_VERSION;
  save.gacha ||= {};
  save.gacha.commonWishes ||= ['', '', ''];
  save.gacha.beginnerWishes ||= ['', '', ''];
  save.gacha.pastMode ||= false;
  save.gacha.selectors ||= { common: 0, past: 0 };
  save.gacha.selectorEntitlements ||= { common: [], past: [] };
  for (const kind of ['common', 'past']) {
    const entries = save.gacha.selectorEntitlements[kind];
    if (!Array.isArray(entries)) save.gacha.selectorEntitlements[kind] = [];
    const missing = Math.max(0, (save.gacha.selectors[kind] || 0) - save.gacha.selectorEntitlements[kind].length);
    for (let i = 0; i < missing; i += 1) save.gacha.selectorEntitlements[kind].push(legacySelectorEntry(content, kind));
  }
  for (const [id, owned] of Object.entries(save.owned || {})) {
    const character = content.characters.find((entry) => entry.id === id);
    if (!character) continue;
    owned.acquiredRarity ||= character.baseRarity || character.currentRarity || character.rarity;
  }
  return save;
}

export function addSelectorEntitlement(save, content, kind) {
  if (!['common', 'past'].includes(kind)) throw new Error('未知自选包类型');
  ensureCatalogState(save, content);
  save.gacha.selectors[kind] += 1;
  save.gacha.selectorEntitlements[kind].push(currentSelectorEntry(content, kind));
}

export function takeSelectorEntitlement(save, content, kind, characterId) {
  ensureCatalogState(save, content);
  const entries = save.gacha.selectorEntitlements[kind] || [];
  const index = entries.findIndex((entry) => entry.candidateIds.includes(characterId));
  if (index < 0 || save.gacha.selectors[kind] < 1) return null;
  const [entry] = entries.splice(index, 1);
  save.gacha.selectors[kind] -= 1;
  return entry;
}

export function validateWishSelection(content, pool, wishes) {
  if (!['common', 'beginner'].includes(pool)) throw new Error('心愿仅支持常驻或新手池');
  if (!Array.isArray(wishes) || wishes.length !== 3) throw new Error('心愿必须提供 3 个槽位');
  const allowed = new Set(currentSsrCandidates(content, 'standard'));
  const selected = wishes.map((id) => id || '');
  if (selected.some((id) => id && !allowed.has(id))) throw new Error('心愿角色必须是当前开放的常驻 SSR');
  if (new Set(selected.filter(Boolean)).size !== selected.filter(Boolean).length) throw new Error('心愿角色不可重复');
  return selected;
}

export function recycleRewardFor(character) {
  const rarity = currentRarity(character);
  return rarity === 'SSR' ? 100 : rarity === 'SR' ? 10 : 2;
}
