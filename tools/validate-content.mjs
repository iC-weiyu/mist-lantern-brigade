import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContent } from '../src/content.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const content = loadContent(root);
console.log(JSON.stringify({
  version: content.version,
  ssr: content.characters.filter((c) => c.rarity === 'SSR').length,
  sr: content.characters.filter((c) => c.rarity === 'SR').length,
  r: content.characters.filter((c) => c.rarity === 'R').length,
  total: content.characters.length,
  women: content.characters.filter((c) => c.rarity === 'SSR' && c.gender === '女').length,
  men: content.characters.filter((c) => c.rarity === 'SSR' && c.gender === '男').length,
  sets: content.equipmentSets.length,
  themes: content.themes.length,
}));
