import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDamage, completeReload, rayAABB, formatTime, absorbArmor, seededRandom } from '../src/logic.js';
import { WEAPONS } from '../src/weapons.js';

test('applyDamage clamps health and attributes a single death', () => {
  let killedBy = null;
  const target = { health: 35, alive: true, kill(source) { this.alive = false; killedBy = source; } };
  const source = { name: 'attacker' };
  assert.equal(applyDamage(target, 50, source), 35);
  assert.equal(target.health, 0);
  assert.equal(killedBy, source);
  assert.equal(applyDamage(target, 20, source), 0);
  assert.equal(target.health, 0);
});

test('applyDamage preserves a lethal headshot and only kills once', () => {
  const kills = [];
  const target = { health: 20, alive: true, kill(source, headshot) { this.alive = false; kills.push({ source, headshot }); } };
  const source = { name: 'attacker' };
  assert.equal(applyDamage(target, 100, source, true), 20);
  assert.equal(applyDamage(target, 100, source, true), 0);
  assert.equal(kills.length, 1);
  assert.equal(kills[0].source, source);
  assert.equal(kills[0].headshot, true);
});

test('applyDamage rejects invalid or friendly zero damage', () => {
  const target = { health: 100, alive: true };
  for (const value of [0, -5, NaN, Infinity]) assert.equal(applyDamage(target, value), 0);
  assert.equal(target.health, 100);
});

test('reload transfers only available and needed rounds', () => {
  assert.deepEqual(completeReload(12, 90, 30), { ammo: 30, reserve: 72 });
  assert.deepEqual(completeReload(28, 1, 30), { ammo: 29, reserve: 0 });
  assert.deepEqual(completeReload(30, 90, 30), { ammo: 30, reserve: 90 });
  assert.deepEqual(completeReload(0, 0, 30), { ammo: 0, reserve: 0 });
});

test('ray/AABB finds nearest entry and respects direction', () => {
  const box = { min: { x: -1, y: -1, z: -5 }, max: { x: 1, y: 1, z: -3 } };
  const origin = { x: 0, y: 0, z: 0 };
  assert.equal(rayAABB(origin, { x: 0, y: 0, z: -1 }, box), 3);
  assert.equal(rayAABB(origin, { x: 0, y: 0, z: 1 }, box), null);
  assert.equal(rayAABB(origin, { x: 2, y: 0, z: -1 }, box), null);
  assert.equal(rayAABB(origin, { x: 0, y: 0, z: -1 }, box, 2), null);
});

test('ray/AABB handles parallel slab misses and origin inside', () => {
  const box = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };
  assert.equal(rayAABB({ x: 2, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, box), null);
  assert.equal(rayAABB({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, box), 0);
});

test('armor absorbs part of body damage without creating health', () => {
  assert.deepEqual(absorbArmor(100, 100, 40), { health: 78, armor: 82 });
  assert.deepEqual(absorbArmor(20, 0, 40), { health: 0, armor: 0 });
  const result = absorbArmor(100, 5, 40);
  assert.equal(result.armor, 0);
  assert.equal(result.health, 65);
});

test('round clock uses ceiling and never goes negative', () => {
  assert.equal(formatTime(240), '04:00');
  assert.equal(formatTime(59.1), '01:00');
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(-10), '00:00');
});

test('seeded random is reproducible and bounded', () => {
  const a = seededRandom(42);
  const b = seededRandom(42);
  for (let i = 0; i < 20; i++) {
    const value = a();
    assert.equal(value, b());
    assert.ok(value >= 0 && value < 1);
  }
});

test('weapon data preserves distinct handling and valid magazines', () => {
  assert.equal(WEAPONS.length, 3);
  assert.ok(new Set(WEAPONS.map((weapon) => weapon.id)).size === 3);
  assert.ok(WEAPONS.find((weapon) => weapon.id === 'ak').damage > WEAPONS.find((weapon) => weapon.id === 'm4').damage);
  assert.ok(WEAPONS.find((weapon) => weapon.id === 'ak').recoil > WEAPONS.find((weapon) => weapon.id === 'm4').recoil);
  for (const weapon of WEAPONS) {
    assert.ok(weapon.magazine > 0 && weapon.reserve >= weapon.magazine);
    assert.ok(weapon.rpm > 0 && weapon.reloadTime > 0 && weapon.headMultiplier > 1);
  }
});
