// Presentation only: each persisted action supplies typed effects. No combat RNG here.
export const BATTLE_ACTION_MS = 660;
let cleanup = [];

export function clearBattleEffects() {
  for (const dispose of cleanup) dispose();
  cleanup = [];
}

export function playBattleEffects(root, battle, previous, speed = 1, reducedMotion = false) {
  clearBattleEffects();
  const event = battle?.lastEvent;
  if (!event?.effects?.length || !previous || previous.id !== battle.id || previous.actionCount === battle.actionCount) return;
  const field = root.querySelector('.battlefield');
  if (!field) return;
  const duration = 600 / Math.max(1, Math.min(5, speed));
  const units = new Map([...root.querySelectorAll('[data-unit-id]')].map(node => [node.dataset.unitId, node]));
  const actor = units.get(event.actorId);
  const box = field.getBoundingClientRect();
  const center = node => { const r = node.getBoundingClientRect(); return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top }; };
  const animate = (node, frames, options = {}) => {
    const animation = node.animate(frames, { duration, easing: 'ease-out', fill: 'both', ...options });
    cleanup.push(() => animation.cancel());
    return animation;
  };
  const layer = document.createElement('div');
  layer.className = 'battle-fx-layer'; layer.setAttribute('aria-hidden', 'true'); field.append(layer);
  cleanup.push(() => layer.remove());
  const spawn = (className, point, text = '') => {
    const node = document.createElement('span'); node.className = className; node.textContent = text;
    node.style.left = `${point.x}px`; node.style.top = `${point.y}px`; layer.append(node); return node;
  };
  const strike = event.effects.find(effect => effect.kind === 'damage');
  if (actor && event.skill) {
    const target = units.get(strike?.targetId);
    let dx = 0, dy = -7;
    if (target) {
      const from = center(actor), to = center(target), distance = Math.hypot(to.x - from.x, to.y - from.y) || 1;
      dx = (to.x - from.x) / distance * 30; dy = (to.y - from.y) / distance * 30;
    }
    actor.style.zIndex = '3';
    if (!reducedMotion) animate(actor, [
      { transform: 'translate(0,0)', offset: 0 },
      { transform: `translate(${-dx * 0.15}px,${-dy * 0.15}px) scale(.99)`, offset: .12 },
      { transform: `translate(${dx}px,${dy}px) scale(1.035)`, offset: .33 },
      { transform: 'translate(0,0)', offset: .68 },
      { transform: 'translate(0,0)', offset: 1 },
    ]);
    const label = spawn('battle-fx-skill', { x: center(actor).x, y: center(actor).y - 28 }, `${event.skill === 'U' ? '终极技' : event.skill === 'A' ? '主动技' : '普攻'}`);
    animate(label, [{ opacity: 0 }, { opacity: 1, offset: .16 }, { opacity: 1, offset: .7 }, { opacity: 0 }]);
  }
  const before = new Map([...previous.players, ...previous.enemies].map(unit => [unit.id, unit]));
  const after = new Map([...battle.players, ...battle.enemies].map(unit => [unit.id, unit]));
  for (const effect of event.effects) {
    const target = units.get(effect.targetId);
    if (!target || effect.amount === 0) continue;
    const isHit = ['damage', 'dot'].includes(effect.kind);
    const point = center(target);
    const impactDelay = effect.kind === 'dot' ? 0 : duration * .32;
    const color = isHit ? '#c65b34' : effect.kind === 'heal' ? '#2d9864' : effect.kind === 'shield' ? '#3d9ac9' : '#b88825';
    if (actor && effect.kind === 'damage' && !reducedMotion) {
      const from = center(actor), dx = point.x - from.x, dy = point.y - from.y;
      const bolt = spawn('battle-fx-bolt', from); bolt.style.setProperty('--fx-color', color);
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      animate(bolt, [
        { transform: `translate(0,0) rotate(${angle}deg) scaleX(.3)`, opacity: 0 },
        { opacity: 1, offset: .18 },
        { transform: `translate(${dx}px,${dy}px) rotate(${angle}deg) scaleX(1.3)`, opacity: 1, offset: .87 },
        { transform: `translate(${dx}px,${dy}px) rotate(${angle}deg)`, opacity: 0 },
      ], { duration: duration * .32 });
    }
    const glow = document.createElement('span'); glow.className = `battle-fx-glow ${isHit ? 'hit' : effect.kind}`;
    glow.style.setProperty('--fx-color', color); target.append(glow);
    animate(glow, [{ opacity: 0 }, { opacity: .9, offset: .2 }, { opacity: 0 }], { delay: impactDelay, duration: duration * .62 });
    if (isHit && !reducedMotion && target !== actor) animate(target, [
      { transform: 'translateX(0)' }, { transform: 'translateX(-5px)', offset: .13 },
      { transform: 'translateX(4px)', offset: .28 }, { transform: 'translateX(-2px)', offset: .45 },
      { transform: 'translateX(0)', offset: 1 },
    ], { delay: impactDelay, duration: duration * .5 });
    const text = isHit ? `${effect.kind === 'dot' ? '持续 ' : ''}${effect.hpDamage ? `−${effect.hpDamage}` : ''}${effect.absorbed ? ` 盾挡 ${effect.absorbed}` : ''}`
      : effect.kind === 'heal' ? `+${effect.amount}` : effect.kind === 'shield' ? `护盾 +${effect.amount}` : `攻击 ↑${Math.round(effect.amount * 100)}%`;
    const label = spawn(`battle-fx-number ${isHit ? 'damage' : effect.kind}`, { x: point.x, y: point.y - 2 + (effect.kind === 'dot' ? -20 : 0) }, text);
    animate(label, [
      { opacity: 0, transform: 'translate(-50%, 4px) scale(.85)' },
      { opacity: 1, transform: 'translate(-50%, -8px) scale(1.06)', offset: .18 },
      { opacity: 1, offset: .73 },
      { opacity: 0, transform: `translate(-50%, ${reducedMotion ? -8 : -30}px) scale(1)` },
    ], { delay: impactDelay, duration: duration * .65 });
    if (!isHit && !reducedMotion) for (let n = 0; n < 3; n++) {
      const mote = spawn(`battle-fx-mote ${effect.kind}`, { x: point.x + (n - 1) * 28, y: point.y + 24 }, effect.kind === 'heal' ? '+' : effect.kind === 'buff' ? '↑' : '◇');
      animate(mote, [{ opacity: 0, transform: 'translateY(0)' }, { opacity: .8, offset: .3 }, { opacity: 0, transform: 'translateY(-48px)' }], { delay: impactDelay + n * duration * .04, duration: duration * .53 });
    }
    const old = before.get(effect.targetId), next = after.get(effect.targetId);
    if (old && next) for (const [kind, oldValue, newValue] of [['hp', old.hp / old.maxHp * 100, next.hp / next.maxHp * 100], ['shield', Math.min(100, old.shield / old.maxHp * 200), Math.min(100, next.shield / next.maxHp * 200)]]) {
      const bar = target.querySelector(`.bar.${kind} > span`);
      if (bar && oldValue !== newValue) animate(bar, [{ width: `${oldValue}%` }, { width: `${newValue}%` }], { delay: impactDelay, duration: duration * .4 });
    }
  }
}
