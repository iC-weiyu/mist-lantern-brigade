import { performGacha } from './engine.mjs';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const FREE_RECRUITS = {
  hourly_common: { pool: 'common', count: 1, title: '整点常驻单招', cycle: 'hourly' },
  daily_common: { pool: 'common', count: 10, title: '夜间常驻十连', cycle: 'daily' },
  daily_theme: { pool: 'theme', count: 1, title: '夜间主题单招', cycle: 'daily' },
};

export function freeRecruitStatus(save, now = Date.now()) {
  const hourly = Math.floor(now / HOUR);
  // Beijing 23:00 is UTC 15:00. Never use the host machine's timezone.
  const daily = Math.floor((now - 15 * HOUR) / DAY);
  return Object.entries(FREE_RECRUITS).map(([id, offer]) => {
    const cycleKey = offer.cycle === 'hourly' ? hourly : daily;
    const locked = offer.pool === 'theme' && !save.unlocks.themePool;
    return { id, ...offer, cycleKey, locked, available: !locked && (save.gacha.freeClaims?.[id] ?? -Infinity) < cycleKey,
      nextRefreshAt: offer.cycle === 'hourly' ? (hourly + 1) * HOUR : (daily + 1) * DAY + 15 * HOUR };
  });
}

export function claimFreeRecruit(save, content, id, now = Date.now()) {
  const offer = freeRecruitStatus(save, now).find((entry) => entry.id === id);
  if (!offer) throw new Error('未知免费招募');
  if (offer.locked) throw new Error('完成序章后可使用免费主题招募');
  if (!offer.available) throw new Error('本轮免费招募已使用，请等待刷新');
  const results = performGacha(save, content, offer.pool, offer.count, { free: true });
  save.gacha.freeClaims ||= {};
  save.gacha.freeClaims[id] = offer.cycleKey;
  return { results, freeRecruitId: id, pool: offer.pool };
}
