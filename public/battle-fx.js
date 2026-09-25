// Presentation only: each persisted action supplies typed effects. No combat RNG here.
export const BATTLE_ACTION_MS = 660;
// 固定角度表（不用随机数，保证每次表现一致、也便于回放）
const SPARK_ANGLES = [-158, -118, -74, -34, 26, 62, 108, 148];
const EMBER_ANGLES = [-140, -95, -45, 0, 45, 95, 140];
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
  const before = new Map([...previous.players, ...previous.enemies].map(unit => [unit.id, unit]));
  const after = new Map([...battle.players, ...battle.enemies].map(unit => [unit.id, unit]));
  const actorName = before.get(event.actorId)?.name || '';
  const strike = event.effects.find(effect => effect.kind === 'damage');
  const strikeUnit = strike ? before.get(strike.targetId) : null;
  // 大招，或者一击打掉目标两成以上血：算「重击」，表现加强
  const heavy = event.skill === 'U' || Boolean(strikeUnit && strike.hpDamage / Math.max(1, strikeUnit.maxHp) >= 0.22);
  const accent = event.skill === 'U' ? '#ffd479' : '#e8935f';

  // 1. 施法者：前冲 + 技能横幅（大招更大更亮，并横扫一道光）
  if (actor && event.skill) {
    const target = units.get(strike?.targetId);
    let dx = 0, dy = -7;
    if (target) {
      const from = center(actor), to = center(target), distance = Math.hypot(to.x - from.x, to.y - from.y) || 1;
      dx = (to.x - from.x) / distance * (event.skill === 'U' ? 42 : 30);
      dy = (to.y - from.y) / distance * (event.skill === 'U' ? 42 : 30);
    }
    actor.style.zIndex = '3';
    if (!reducedMotion) animate(actor, [
      { transform: 'translate(0,0)', offset: 0 },
      { transform: `translate(${-dx * 0.15}px,${-dy * 0.15}px) scale(.99)`, offset: .12 },
      { transform: `translate(${dx}px,${dy}px) scale(${event.skill === 'U' ? 1.06 : 1.035})`, offset: .33 },
      { transform: 'translate(0,0)', offset: .68 },
      { transform: 'translate(0,0)', offset: 1 },
    ]);
    const tier = event.skill === 'U' ? 'u' : event.skill === 'A' ? 'a' : 'p';
    const name = event.skill === 'U' ? '终极技' : event.skill === 'A' ? '主动技' : '普攻';
    const point = center(actor);
    const label = spawn(`battle-fx-skill skill-${tier}`, { x: point.x, y: point.y - (event.skill === 'U' ? 36 : 28) }, `${actorName ? `${actorName} · ` : ''}${name}`);
    animate(label, [
      { opacity: 0, transform: 'translate(-50%,-50%) scale(.82)' },
      { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: .16 },
      { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: .72 },
      { opacity: 0, transform: 'translate(-50%,-50%) scale(1.05)' },
    ], { duration: duration * (event.skill === 'U' ? 1 : .8) });
    if (event.skill === 'U' && !reducedMotion) {
      const sweep = spawn('battle-fx-sweep', { x: box.width / 2, y: point.y + 26 });
      sweep.style.setProperty('--fx-color', accent);
      animate(sweep, [
        { opacity: 0, transform: 'translate(-50%,-50%) scaleX(.05)' },
        { opacity: .95, offset: .3, transform: 'translate(-50%,-50%) scaleX(1)' },
        { opacity: 0, transform: 'translate(-50%,-50%) scaleX(1)' },
      ], { duration: duration * .7, easing: 'cubic-bezier(.2,.8,.3,1)' });
    }
  }

  // 2. 逐个效果：弹道 / 冲击环 / 火花 / 光晕 / 抖动 / 飘字 / 能量点 / 血条
  for (const effect of event.effects) {
    const target = units.get(effect.targetId);
    if (!target || effect.amount === 0) continue;
    const isHit = ['damage', 'dot'].includes(effect.kind);
    const point = center(target);
    const impactDelay = effect.kind === 'dot' ? 0 : duration * .32;
    const color = isHit ? '#c65b34' : effect.kind === 'heal' ? '#2d9864' : effect.kind === 'shield' ? '#3d9ac9' : '#b88825';
    const isHeavyHit = isHit && heavy && effect.kind === 'damage';
    if (actor && effect.kind === 'damage' && !reducedMotion) {
      const from = center(actor), dx = point.x - from.x, dy = point.y - from.y;
      const bolt = spawn(`battle-fx-bolt${isHeavyHit ? ' heavy' : ''}`, from); bolt.style.setProperty('--fx-color', color);
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

    // 冲击环：命中扩散一圈，重击再补一圈更大的
    if (!reducedMotion) {
      const ring = spawn(`battle-fx-ring${isHeavyHit ? ' heavy' : ''}${isHit ? '' : ` ${effect.kind}`}`, point);
      ring.style.setProperty('--fx-color', isHeavyHit ? accent : color);
      animate(ring, [
        { opacity: 0, transform: 'translate(-50%,-50%) scale(.3)' },
        { opacity: .95, offset: .2, transform: `translate(-50%,-50%) scale(${isHeavyHit ? 1.1 : .9})` },
        { opacity: 0, transform: `translate(-50%,-50%) scale(${isHeavyHit ? 3.4 : 2.4})` },
      ], { delay: impactDelay, duration: duration * (isHeavyHit ? .74 : .52), easing: 'cubic-bezier(.2,.7,.3,1)' });
      if (isHeavyHit) {
        const outer = spawn('battle-fx-ring faint', point);
        outer.style.setProperty('--fx-color', accent);
        animate(outer, [
          { opacity: 0, transform: 'translate(-50%,-50%) scale(.5)' },
          { opacity: .6, offset: .3, transform: 'translate(-50%,-50%) scale(2.2)' },
          { opacity: 0, transform: 'translate(-50%,-50%) scale(4.6)' },
        ], { delay: impactDelay + duration * .06, duration: duration * .8 });
      }
    }
    // 火花：命中后向外飞溅
    if (isHit && !reducedMotion) {
      const count = isHeavyHit ? 8 : 5;
      for (let n = 0; n < count; n += 1) {
        const angle = SPARK_ANGLES[n % SPARK_ANGLES.length] * Math.PI / 180;
        const reach = (isHeavyHit ? 48 : 30) * (n % 3 === 0 ? 1.25 : .82);
        const spark = spawn('battle-fx-spark', point);
        spark.style.setProperty('--fx-color', isHeavyHit ? accent : color);
        animate(spark, [
          { opacity: 0, transform: 'translate(-50%,-50%) scale(.5)' },
          { opacity: 1, offset: .12, transform: 'translate(-50%,-50%) scale(1.1)' },
          { opacity: 0, transform: `translate(calc(-50% + ${Math.cos(angle) * reach}px), calc(-50% + ${Math.sin(angle) * reach + 12}px)) scale(.5)` },
        ], { delay: impactDelay, duration: duration * (isHeavyHit ? .6 : .48) });
      }
    }
    if (isHit && !reducedMotion && target !== actor) animate(target, [
      { transform: 'translateX(0)' }, { transform: `translateX(${isHeavyHit ? -9 : -5}px)`, offset: .13 },
      { transform: `translateX(${isHeavyHit ? 7 : 4}px)`, offset: .28 }, { transform: `translateX(${isHeavyHit ? -4 : -2}px)`, offset: .45 },
      { transform: 'translateX(0)', offset: 1 },
    ], { delay: impactDelay, duration: duration * (isHeavyHit ? .56 : .5) });
    const text = isHit ? `${effect.kind === 'dot' ? '持续 ' : ''}${effect.hpDamage ? `−${effect.hpDamage}` : ''}${effect.absorbed ? ` 盾挡 ${effect.absorbed}` : ''}`
      : effect.kind === 'heal' ? `+${effect.amount}` : effect.kind === 'shield' ? `护盾 +${effect.amount}` : `攻击 ↑${Math.round(effect.amount * 100)}%`;
    const label = spawn(`battle-fx-number ${isHit ? 'damage' : effect.kind}${isHeavyHit ? ' big' : ''}`, { x: point.x, y: point.y - 2 + (effect.kind === 'dot' ? -20 : 0) }, text);
    animate(label, [
      { opacity: 0, transform: `translate(-50%, 6px) scale(${isHeavyHit ? .8 : .85})` },
      { opacity: 1, transform: `translate(-50%, -10px) scale(${isHeavyHit ? 1.3 : 1.06})`, offset: .18 },
      { opacity: 1, offset: .73 },
      { opacity: 0, transform: `translate(-50%, ${reducedMotion ? -8 : isHeavyHit ? -38 : -30}px) scale(${isHeavyHit ? 1.15 : 1})` },
    ], { delay: impactDelay, duration: duration * (isHeavyHit ? .8 : .65) });
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

  // 3. 大招或重击：整个战场闪一下，读起来更有分量
  if (heavy && !reducedMotion) {
    const flash = document.createElement('span');
    flash.className = 'battle-fx-flash'; flash.setAttribute('aria-hidden', 'true'); flash.style.setProperty('--fx-color', accent);
    field.append(flash); cleanup.push(() => flash.remove());
    animate(flash, [{ opacity: 0 }, { opacity: event.skill === 'U' ? .38 : .26, offset: .16 }, { opacity: 0 }], { duration: duration * (event.skill === 'U' ? .9 : .7) });
  }

  // 4. 这一击打倒了谁：塌陷 + 灰环 + 余烬
  for (const [id, next] of after) {
    const old = before.get(id);
    if (!old?.alive || next.alive) continue;
    const node = units.get(id);
    if (!node || reducedMotion) continue;
    const point = center(node);
    animate(node, [
      { transform: 'scale(1.06) rotate(0deg)' },
      { transform: 'scale(.9) rotate(-3deg)', offset: .55 },
      { transform: 'scale(.94) rotate(-2deg)' },
    ], { delay: duration * .34, duration: duration * .62, easing: 'cubic-bezier(.3,.1,.4,1)' });
    const ring = spawn('battle-fx-ring faint', point);
    ring.style.setProperty('--fx-color', '#9fb0aa');
    animate(ring, [
      { opacity: 0, transform: 'translate(-50%,-50%) scale(.4)' },
      { opacity: .55, offset: .25, transform: 'translate(-50%,-50%) scale(1.8)' },
      { opacity: 0, transform: 'translate(-50%,-50%) scale(3.6)' },
    ], { delay: duration * .36, duration: duration * .7 });
    for (let n = 0; n < 5; n += 1) {
      const angle = EMBER_ANGLES[n % EMBER_ANGLES.length] * Math.PI / 180;
      const reach = 26 + n * 6;
      const ember = spawn('battle-fx-spark faint', point);
      ember.style.setProperty('--fx-color', '#9fb0aa');
      animate(ember, [
        { opacity: 0, transform: 'translate(-50%,-50%) scale(.8)' },
        { opacity: .8, offset: .2, transform: 'translate(-50%,-50%) scale(1)' },
        { opacity: 0, transform: `translate(calc(-50% + ${Math.cos(angle) * reach}px), calc(-50% + ${Math.sin(angle) * reach - 6}px)) scale(.4)` },
      ], { delay: duration * .36 + n * duration * .05, duration: duration * .7 });
    }
  }
}
