export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export function formatTime(seconds) {
  const safe = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

export function applyDamage(target, amount, source) {
  if (!target?.alive || !Number.isFinite(amount) || amount <= 0) return 0;
  const dealt = Math.min(target.health, amount);
  target.health = Math.max(0, target.health - amount);
  if (target.health === 0 && typeof target.kill === 'function') target.kill(source);
  return dealt;
}

export function completeReload(ammo, reserve, magazineSize) {
  const needed = Math.max(0, magazineSize - Math.max(0, ammo));
  const loaded = Math.min(needed, Math.max(0, reserve));
  return { ammo: ammo + loaded, reserve: reserve - loaded };
}

export function rayAABB(origin, direction, box, maxDistance = Infinity) {
  let near = 0;
  let far = maxDistance;
  for (const axis of ['x', 'y', 'z']) {
    const o = origin[axis];
    const d = direction[axis];
    const min = box.min[axis];
    const max = box.max[axis];
    if (Math.abs(d) < 1e-8) {
      if (o < min || o > max) return null;
      continue;
    }
    let a = (min - o) / d;
    let b = (max - o) / d;
    if (a > b) [a, b] = [b, a];
    near = Math.max(near, a);
    far = Math.min(far, b);
    if (near > far) return null;
  }
  if (far < 0 || near > maxDistance) return null;
  return Math.max(0, near);
}

export function seededRandom(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function createArmorState() {
  return { health: 100, armor: 100, alive: true };
}

export function absorbArmor(health, armor, damage) {
  const absorbed = Math.min(armor, damage * 0.45);
  return {
    health: Math.max(0, health - (damage - absorbed)),
    armor: Math.max(0, armor - absorbed),
  };
}
