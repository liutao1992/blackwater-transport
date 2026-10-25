import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyDamage, clamp, damp, seededRandom } from './logic.js';

const DIFFICULTIES = {
  recruit: { reaction: 0.72, spread: 0.052, damage: 18, fireInterval: 0.22, burst: 3, speed: 3.45, label: '新兵' },
  regular: { reaction: 0.43, spread: 0.029, damage: 22, fireInterval: 0.16, burst: 4, speed: 3.85, label: '精英' },
  veteran: { reaction: 0.25, spread: 0.017, damage: 25, fireInterval: 0.125, burst: 5, speed: 4.15, label: '传奇' },
};

function angleDifference(target, current) {
  return Math.atan2(Math.sin(target - current), Math.cos(target - current));
}

function createSoldier(team, materials) {
  const group = new THREE.Group();
  const uniform = new THREE.MeshStandardMaterial({ color: team === 'blue' ? 0x34494a : 0x50453a, roughness: 0.96 });
  const vest = new THREE.MeshStandardMaterial({ color: team === 'blue' ? 0x253638 : 0x39352e, roughness: 0.88 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x8c6953, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x151b1c, metalness: 0.35, roughness: 0.68 });
  const accent = new THREE.MeshStandardMaterial({ color: team === 'blue' ? 0x58b7d1 : 0xe56b60, emissive: team === 'blue' ? 0x163b46 : 0x481c19, emissiveIntensity: 0.55, roughness: 0.7 });
  const part = (geometry, material, x, y, z, parent = group) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const leftLeg = part(new THREE.BoxGeometry(0.19, 0.75, 0.22), uniform, -0.14, 0.43, 0);
  const rightLeg = part(new THREE.BoxGeometry(0.19, 0.75, 0.22), uniform, 0.14, 0.43, 0);
  part(new THREE.BoxGeometry(0.22, 0.13, 0.36), dark, -0.14, 0.09, -0.06);
  part(new THREE.BoxGeometry(0.22, 0.13, 0.36), dark, 0.14, 0.09, -0.06);
  part(new THREE.BoxGeometry(0.54, 0.66, 0.3), uniform, 0, 1.05, 0);
  part(new THREE.BoxGeometry(0.59, 0.49, 0.39), vest, 0, 1.12, -0.015);
  for (const x of [-0.18, 0, 0.18]) part(new THREE.BoxGeometry(0.14, 0.18, 0.08), vest, x, 0.99, -0.23);
  const head = part(new THREE.SphereGeometry(0.17, 14, 10), skin, 0, 1.57, -0.01);
  head.scale.y = 1.1;
  const helmet = part(new THREE.SphereGeometry(0.195, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.58), dark, 0, 1.66, -0.005);
  helmet.scale.y = 0.8;
  part(new THREE.BoxGeometry(0.24, 0.08, 0.06), dark, 0, 1.58, -0.16);
  part(new THREE.BoxGeometry(0.1, 0.055, 0.02), accent, 0, 1.585, -0.194);
  const leftArm = part(new THREE.BoxGeometry(0.17, 0.62, 0.18), uniform, -0.36, 1.13, -0.13);
  leftArm.rotation.x = -0.67;
  leftArm.rotation.z = -0.2;
  const rightArm = part(new THREE.BoxGeometry(0.17, 0.58, 0.18), uniform, 0.35, 1.14, -0.12);
  rightArm.rotation.x = -0.82;
  rightArm.rotation.z = 0.22;
  part(new THREE.BoxGeometry(0.12, 0.11, 0.64), dark, 0.13, 1.23, -0.35);
  part(new THREE.CylinderGeometry(0.018, 0.018, 0.36, 8), dark, 0.13, 1.25, -0.78).rotation.x = Math.PI / 2;
  part(new THREE.BoxGeometry(0.09, 0.22, 0.13), dark, 0.13, 1.08, -0.26).rotation.x = -0.2;
  part(new THREE.BoxGeometry(0.08, 0.07, 0.15), accent, -0.36, 1.32, -0.12);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0.13, 1.25, -0.99);
  group.add(muzzle);
  const buckets = new Map();
  for (const child of [...group.children]) {
    if (!child.isMesh || child === leftLeg || child === rightLeg) continue;
    child.updateMatrix();
    const geometry = child.geometry.clone();
    geometry.applyMatrix4(child.matrix);
    if (!buckets.has(child.material.uuid)) buckets.set(child.material.uuid, { material: child.material, geometries: [] });
    buckets.get(child.material.uuid).geometries.push(geometry);
    group.remove(child);
  }
  buckets.forEach(({ material, geometries }) => {
    const geometry = mergeGeometries(geometries, false);
    geometries.forEach((item) => item.dispose());
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  });
  group.userData = { leftLeg, rightLeg, muzzle, materials: [uniform, vest, skin, dark, accent] };
  return group;
}

let botId = 0;

export class Bot {
  constructor(manager, team, name, spawnIndex) {
    this.manager = manager;
    this.world = manager.world;
    this.game = manager.game;
    this.team = team;
    this.name = name;
    this.spawnIndex = spawnIndex;
    this.id = `bot-${++botId}`;
    this.isPlayer = false;
    this.group = createSoldier(team, manager.materials);
    this.manager.scene.add(this.group);
    this.position = this.group.position;
    this.velocity = new THREE.Vector3();
    this.yaw = team === 'blue' ? 0 : Math.PI;
    this.health = 100;
    this.alive = true;
    this.radius = 0.39;
    this.target = null;
    this.lastSeen = new THREE.Vector3();
    this.lastSeenAge = 99;
    this.thinkTimer = Math.random() * 0.2;
    this.reaction = 0;
    this.fireCooldown = 0;
    this.burstLeft = 0;
    this.burstPause = 0;
    this.ammo = 30;
    this.reloadRemaining = 0;
    this.path = [];
    this.pathIndex = 0;
    this.pathTimer = 0;
    this.strafeSign = Math.random() > 0.5 ? 1 : -1;
    this.strafeTimer = 1 + Math.random() * 2;
    this.walkPhase = Math.random() * Math.PI * 2;
    this.kills = 0;
    this.deaths = 0;
    this.shots = 0;
    this.hits = 0;
    this.respawnRemaining = 0;
    this.spawnProtection = 0;
    this.deathDirection = 1;
    this.random = seededRandom(1000 + botId * 73);
  }

  get eyePosition() { return new THREE.Vector3(this.position.x, this.position.y + 1.53, this.position.z); }
  get aimPoint() { return new THREE.Vector3(this.position.x, this.position.y + 1.05, this.position.z); }
  get settings() { return DIFFICULTIES[this.game.difficulty] || DIFFICULTIES.regular; }

  getHitboxes() {
    return [
      { type: 'head', min: new THREE.Vector3(this.position.x - 0.21, this.position.y + 1.39, this.position.z - 0.21), max: new THREE.Vector3(this.position.x + 0.21, this.position.y + 1.82, this.position.z + 0.21) },
      { type: 'body', min: new THREE.Vector3(this.position.x - 0.36, this.position.y + 0.15, this.position.z - 0.29), max: new THREE.Vector3(this.position.x + 0.36, this.position.y + 1.39, this.position.z + 0.29) },
    ];
  }

  reset() {
    this.position.copy(this.world.getSpawn(this.team, this.spawnIndex));
    this.group.position.copy(this.position);
    this.group.rotation.set(0, this.team === 'blue' ? 0 : Math.PI, 0);
    this.group.visible = true;
    this.yaw = this.group.rotation.y;
    this.velocity.set(0, 0, 0);
    this.health = 100;
    this.alive = true;
    this.target = null;
    this.lastSeenAge = 99;
    this.reaction = 0;
    this.fireCooldown = 0.3 + this.random() * 0.4;
    this.burstLeft = 0;
    this.burstPause = 0;
    this.ammo = 30;
    this.reloadRemaining = 0;
    this.path = [];
    this.pathIndex = 0;
    this.pathTimer = this.random();
    this.respawnRemaining = 0;
    this.spawnProtection = 0.85;
  }

  takeDamage(amount, source, headshot = false) {
    if (!this.alive || this.spawnProtection > 0) return 0;
    const dealt = applyDamage(this, amount, source, headshot);
    if (this.alive && source && source.team !== this.team) {
      this.target = source;
      this.lastSeen.copy(source.position);
      this.lastSeenAge = 0;
      this.reaction = Math.min(this.reaction, this.settings.reaction * 0.5);
    }
    return dealt;
  }

  kill(source, headshot = false) {
    if (!this.alive) return;
    this.alive = false;
    this.deaths++;
    this.respawnRemaining = 3.4 + this.random() * 0.7;
    this.deathDirection = this.random() > 0.5 ? 1 : -1;
    this.velocity.set(0, 0, 0);
    this.game.registerKill(this, source, headshot);
  }

  selectTarget() {
    const opponents = this.game.getOpponents(this.team).filter((target) => target.alive);
    let best = null;
    let bestScore = Infinity;
    const eye = this.eyePosition;
    const forwardX = -Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);
    for (const opponent of opponents) {
      const dx = opponent.position.x - this.position.x;
      const dz = opponent.position.z - this.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 48 || distance < 0.001) continue;
      const facing = (forwardX * dx + forwardZ * dz) / distance;
      if (facing < -0.15 && opponent !== this.target) continue;
      const targetEye = opponent.isPlayer ? opponent.eyePosition : opponent.eyePosition;
      if (!this.world.lineOfSight(eye, targetEye, 0.35)) continue;
      const score = distance * (opponent === this.target ? 0.72 : 1);
      if (score < bestScore) { best = opponent; bestScore = score; }
    }
    if (best) {
      if (best !== this.target) this.reaction = this.settings.reaction * (0.75 + this.random() * 0.5);
      this.target = best;
      this.lastSeen.copy(best.position);
      this.lastSeenAge = 0;
    } else if (this.target) {
      this.target = null;
    }
  }

  updateDead(dt) {
    this.respawnRemaining -= dt;
    this.group.rotation.z = damp(this.group.rotation.z, this.deathDirection * 1.42, 6, dt);
    if (this.respawnRemaining < 1.6) this.group.visible = false;
    if (this.respawnRemaining <= 0 && this.game.state === 'running') this.reset();
  }

  update(dt) {
    if (!this.alive) { this.updateDead(dt); return; }
    this.spawnProtection = Math.max(0, this.spawnProtection - dt);
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.burstPause = Math.max(0, this.burstPause - dt);
    this.thinkTimer -= dt;
    this.lastSeenAge += dt;
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeSign *= -1;
      this.strafeTimer = 1.1 + this.random() * 1.8;
    }
    if (this.reloadRemaining > 0) {
      this.reloadRemaining -= dt;
      if (this.reloadRemaining <= 0) this.ammo = 30;
    }
    if (this.thinkTimer <= 0) {
      this.selectTarget();
      this.thinkTimer = 0.16 + this.random() * 0.12;
    }

    const hasTarget = this.target?.alive && this.lastSeenAge < 0.55;
    let moveX = 0;
    let moveZ = 0;
    let desiredYaw = this.yaw;
    let speed = this.settings.speed;
    if (hasTarget) {
      const dx = this.target.position.x - this.position.x;
      const dz = this.target.position.z - this.position.z;
      const distance = Math.hypot(dx, dz) || 1;
      desiredYaw = Math.atan2(-dx, -dz);
      this.reaction -= dt;
      const nx = dx / distance;
      const nz = dz / distance;
      if (distance > 23) { moveX += nx; moveZ += nz; }
      else if (distance < 6.5) { moveX -= nx * 0.7; moveZ -= nz * 0.7; }
      if (distance < 29) {
        moveX += -nz * this.strafeSign * 0.7;
        moveZ += nx * this.strafeSign * 0.7;
        speed *= 0.65;
      }
      if (Math.abs(angleDifference(desiredYaw, this.yaw)) < 0.34 && this.reaction <= 0) this.tryFire();
    } else {
      this.reaction = Math.max(this.reaction, this.settings.reaction * 0.5);
      this.pathTimer -= dt;
      let goal = null;
      if (this.lastSeenAge < 5) goal = this.lastSeen;
      else {
        const opponents = this.game.getOpponents(this.team).filter((target) => target.alive);
        if (opponents.length) {
          opponents.sort((a, b) => this.position.distanceToSquared(a.position) - this.position.distanceToSquared(b.position));
          goal = opponents[0].position;
        }
      }
      if (goal && this.pathTimer <= 0) {
        this.path = this.world.findPath(this.position, goal);
        this.pathIndex = 0;
        this.pathTimer = 1.15 + this.random() * 0.85;
      }
      let waypoint = this.path[this.pathIndex];
      if (waypoint && Math.hypot(waypoint.x - this.position.x, waypoint.z - this.position.z) < 0.62) {
        this.pathIndex++;
        waypoint = this.path[this.pathIndex];
      }
      if (waypoint) {
        const dx = waypoint.x - this.position.x;
        const dz = waypoint.z - this.position.z;
        const distance = Math.hypot(dx, dz) || 1;
        moveX = dx / distance;
        moveZ = dz / distance;
        desiredYaw = Math.atan2(-moveX, -moveZ);
      }
    }

    if (this.ammo <= 0 && this.reloadRemaining <= 0) this.reloadRemaining = 2.15;
    const moveLength = Math.hypot(moveX, moveZ);
    if (moveLength > 0.01) {
      moveX /= Math.max(1, moveLength);
      moveZ /= Math.max(1, moveLength);
      for (const other of this.manager.bots) {
        if (other === this || !other.alive) continue;
        const dx = this.position.x - other.position.x;
        const dz = this.position.z - other.position.z;
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq > 0.001 && distanceSq < 1.2) {
          moveX += dx / distanceSq * 0.16;
          moveZ += dz / distanceSq * 0.16;
        }
      }
      const nextX = this.position.x + moveX * speed * dt;
      const nextZ = this.position.z + moveZ * speed * dt;
      if (this.world.canOccupy(nextX, this.position.z, this.radius, 0, 1.72)) this.position.x = nextX;
      if (this.world.canOccupy(this.position.x, nextZ, this.radius, 0, 1.72)) this.position.z = nextZ;
      this.walkPhase += dt * speed * 3.1;
      this.velocity.set(moveX * speed, 0, moveZ * speed);
    } else this.velocity.set(0, 0, 0);

    this.yaw += angleDifference(desiredYaw, this.yaw) * Math.min(1, dt * (hasTarget ? 10 : 6));
    this.group.rotation.y = this.yaw;
    const swing = Math.sin(this.walkPhase) * Math.min(0.65, this.velocity.length() * 0.13);
    this.group.userData.leftLeg.rotation.x = swing;
    this.group.userData.rightLeg.rotation.x = -swing;
  }

  tryFire() {
    if (this.fireCooldown > 0 || this.burstPause > 0 || this.reloadRemaining > 0 || this.ammo <= 0 || !this.target?.alive) return;
    if (this.burstLeft <= 0) this.burstLeft = this.settings.burst + Math.floor(this.random() * 3);
    this.burstLeft--;
    if (this.burstLeft <= 0) this.burstPause = 0.32 + this.random() * 0.5;
    this.fireCooldown = this.settings.fireInterval;
    this.ammo--;
    this.shots++;
    const origin = this.eyePosition;
    const targetPoint = this.target.isPlayer
      ? new THREE.Vector3(this.target.position.x, this.target.position.y + this.target.currentHeight * 0.66, this.target.position.z)
      : this.target.aimPoint;
    const direction = targetPoint.sub(origin).normalize();
    const right = new THREE.Vector3(-direction.z, 0, direction.x).normalize();
    const spread = this.settings.spread * (this.team === 'blue' ? 1.12 : 1);
    direction.addScaledVector(right, (this.random() - 0.5) * spread * 2);
    direction.y += (this.random() - 0.5) * spread * 1.3;
    direction.normalize();
    const muzzle = this.group.userData.muzzle.getWorldPosition(new THREE.Vector3());
    this.manager.effects.muzzle(muzzle, 0.28);
    this.manager.audio.shot('bot', muzzle, false);
    this.game.resolveShot({
      shooter: this,
      origin,
      direction,
      config: { id: 'bot-rifle', damage: this.settings.damage, headMultiplier: 1.75, range: 95 },
      muzzle,
      showTracer: this.shots % 2 === 0,
    });
  }
}

export class BotManager {
  constructor(scene, world, effects, audio, game) {
    this.scene = scene;
    this.world = world;
    this.effects = effects;
    this.audio = audio;
    this.game = game;
    this.materials = {};
    const blueNames = ['海鸥', '北风', '磐石'];
    const redNames = ['蝰蛇', '夜枭', '沙暴', '猎犬'];
    this.bots = [
      ...blueNames.map((name, index) => new Bot(this, 'blue', name, index + 1)),
      ...redNames.map((name, index) => new Bot(this, 'red', name, index)),
    ];
    this.reset();
  }

  reset() { this.bots.forEach((bot) => bot.reset()); }
  update(dt) {
    for (const bot of this.bots) {
      if (this.game.state !== 'running') break;
      bot.update(dt);
    }
  }
  getOpponents(team) { return this.bots.filter((bot) => bot.team !== team && bot.alive); }
}
