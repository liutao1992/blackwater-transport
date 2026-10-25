import * as THREE from 'three';
import { clamp, damp, completeReload } from './logic.js';

export const WEAPONS = [
  {
    id: 'm4', name: 'M4A1', role: '突击步枪', damage: 30, headMultiplier: 2.65,
    rpm: 720, magazine: 30, reserve: 90, reloadTime: 1.85, automatic: true,
    spread: 0.0065, adsSpread: 0.0016, recoil: 0.0145, range: 125, tracerEvery: 2,
  },
  {
    id: 'ak', name: 'AK-47', role: '突击步枪', damage: 37, headMultiplier: 2.85,
    rpm: 600, magazine: 30, reserve: 90, reloadTime: 2.15, automatic: true,
    spread: 0.0085, adsSpread: 0.0022, recoil: 0.021, range: 130, tracerEvery: 2,
  },
  {
    id: 'deagle', name: 'DESERT EAGLE', role: '战术手枪', damage: 54, headMultiplier: 2.35,
    rpm: 230, magazine: 7, reserve: 35, reloadTime: 2.05, automatic: false,
    spread: 0.005, adsSpread: 0.0012, recoil: 0.034, range: 100, tracerEvery: 1,
  },
];

function flashTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 31);
  gradient.addColorStop(0, '#fff8ce');
  gradient.addColorStop(0.18, '#ffd069');
  gradient.addColorStop(0.48, 'rgba(255,128,30,.7)');
  gradient.addColorStop(1, 'rgba(255,80,10,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export class WeaponSystem {
  constructor(camera, world, effects, audio, player, input) {
    this.camera = camera;
    this.world = world;
    this.effects = effects;
    this.audio = audio;
    this.player = player;
    this.input = input;
    this.onFire = null;
    this.currentIndex = 0;
    this.states = WEAPONS.map((config) => ({ ammo: config.magazine, reserve: config.reserve, cooldown: 0, reloadRemaining: 0, reloadElapsed: 0, reloadStage: 0 }));
    this.root = new THREE.Group();
    this.root.name = '第一人称武器';
    camera.add(this.root);
    this.materials = {
      gunmetal: new THREE.MeshStandardMaterial({ color: 0x303638, metalness: 0.88, roughness: 0.32 }),
      black: new THREE.MeshStandardMaterial({ color: 0x111718, metalness: 0.28, roughness: 0.68 }),
      polymer: new THREE.MeshStandardMaterial({ color: 0x242b28, metalness: 0.08, roughness: 0.9 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x747b7b, metalness: 0.94, roughness: 0.25 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x70452a, metalness: 0.05, roughness: 0.68 }),
      glove: new THREE.MeshStandardMaterial({ color: 0x1e2927, metalness: 0, roughness: 1 }),
      skin: new THREE.MeshStandardMaterial({ color: 0x8b6750, metalness: 0, roughness: 0.9 }),
    };
    this.flashMap = flashTexture();
    this.models = WEAPONS.map((config, index) => this.buildWeapon(config, index));
    this.models.forEach((model, index) => { model.group.visible = index === 0; });
    this.flashTime = 0;
    this.recoil = 0;
    this.heat = 0;
    this.switchRemaining = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.shotCounter = 0;
    this.hipPosition = new THREE.Vector3(0.29, -0.275, -0.49);
    this.adsPosition = new THREE.Vector3(0, -0.102, -0.36);
    this.root.position.copy(this.hipPosition);
  }

  part(group, size, position, material, rotation = null, geometry = 'box') {
    let geo;
    if (geometry === 'cylinder') geo = new THREE.CylinderGeometry(size[0], size[1], size[2], 12);
    else if (geometry === 'sphere') geo = new THREE.SphereGeometry(size[0], 12, 8);
    else geo = new THREE.BoxGeometry(...size);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
    return mesh;
  }

  buildWeapon(config, index) {
    const group = new THREE.Group();
    const m = this.materials;
    const pistol = config.id === 'deagle';
    const ak = config.id === 'ak';
    if (!pistol) {
      this.part(group, [0.115, 0.125, 0.47], [0, 0, 0], m.gunmetal);
      this.part(group, [0.105, 0.095, 0.34], [0, 0.005, -0.38], ak ? m.wood : m.polymer);
      this.part(group, [0.022, 0.022, 0.43], [0, 0.02, -0.65], m.gunmetal, [Math.PI / 2, 0, 0], 'cylinder');
      this.part(group, [0.036, 0.036, 0.12], [0, 0.02, -0.84], m.black, [Math.PI / 2, 0, 0], 'cylinder');
      this.part(group, [0.085, 0.105, 0.29], [0, 0.005, 0.36], ak ? m.wood : m.polymer, [-0.12, 0, 0]);
      this.part(group, [0.04, 0.16, 0.085], [0, -0.12, 0.13], ak ? m.wood : m.polymer, [-0.25, 0, 0]);
      const magazineMaterial = ak ? m.gunmetal : m.black;
      this.part(group, [0.075, 0.2, 0.115], [0, -0.145, -0.055], magazineMaterial, [ak ? -0.32 : -0.12, 0, 0]);
      if (ak) this.part(group, [0.07, 0.14, 0.1], [0, -0.26, -0.105], magazineMaterial, [-0.5, 0, 0]);
      this.part(group, [0.035, 0.055, 0.045], [0, 0.091, -0.55], m.gunmetal);
      this.part(group, [0.045, 0.062, 0.055], [0, 0.092, 0.09], m.gunmetal);
      this.part(group, [0.016, 0.025, 0.17], [0, 0.076, -0.02], m.steel);
      this.part(group, [0.02, 0.02, 0.16], [0.075, 0.025, 0.02], m.steel, [Math.PI / 2, 0, 0], 'cylinder');
      this.part(group, [0.105, 0.075, 0.13], [0.01, -0.16, 0.13], m.glove, [-0.25, 0, 0]);
      this.part(group, [0.115, 0.085, 0.15], [-0.015, -0.095, -0.38], m.glove, [0.1, 0, 0]);
      this.part(group, [0.065, 0.04, 0.075], [0.005, -0.115, -0.39], m.skin);
    } else {
      this.part(group, [0.105, 0.12, 0.39], [0, 0.015, -0.12], m.gunmetal);
      this.part(group, [0.082, 0.055, 0.37], [0, 0.085, -0.13], m.steel);
      this.part(group, [0.038, 0.038, 0.2], [0, 0.03, -0.38], m.gunmetal, [Math.PI / 2, 0, 0], 'cylinder');
      this.part(group, [0.095, 0.25, 0.13], [0, -0.14, 0.015], m.polymer, [-0.18, 0, 0]);
      this.part(group, [0.032, 0.05, 0.035], [0, 0.125, -0.29], m.gunmetal);
      this.part(group, [0.04, 0.048, 0.04], [0, 0.12, 0.045], m.gunmetal);
      this.part(group, [0.11, 0.1, 0.14], [0.01, -0.18, 0.025], m.glove, [-0.18, 0, 0]);
    }
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, pistol ? 0.03 : 0.02, pistol ? -0.5 : -0.92);
    group.add(muzzle);
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashMap, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    flash.scale.setScalar(pistol ? 0.17 : 0.23);
    flash.visible = false;
    muzzle.add(flash);
    const light = new THREE.PointLight(0xffa645, 0, 3.5, 2);
    muzzle.add(light);
    group.scale.setScalar(0.9);
    this.root.add(group);
    return { group, muzzle, flash, light };
  }

  get config() { return WEAPONS[this.currentIndex]; }
  get state() { return this.states[this.currentIndex]; }
  get model() { return this.models[this.currentIndex]; }
  get reloading() { return this.state.reloadRemaining > 0; }

  reset() {
    this.states.forEach((state, index) => {
      state.ammo = WEAPONS[index].magazine;
      state.reserve = WEAPONS[index].reserve;
      state.cooldown = state.reloadRemaining = state.reloadElapsed = 0;
      state.reloadStage = 0;
    });
    this.switchTo(0, true);
    this.heat = 0;
  }

  refill() {
    this.states.forEach((state, index) => {
      state.ammo = WEAPONS[index].magazine;
      state.reserve = WEAPONS[index].reserve;
      state.cooldown = state.reloadRemaining = 0;
    });
  }

  switchTo(index, immediate = false) {
    if (index < 0 || index >= WEAPONS.length || (!immediate && index === this.currentIndex)) return;
    this.state.reloadRemaining = 0;
    this.models[this.currentIndex].group.visible = false;
    this.currentIndex = index;
    this.models[this.currentIndex].group.visible = true;
    this.switchRemaining = immediate ? 0 : 0.38;
    this.heat = 0;
    if (!immediate) this.audio.ui();
  }

  cycle(direction) {
    this.switchTo((this.currentIndex + Math.sign(direction) + WEAPONS.length) % WEAPONS.length);
  }

  reload() {
    const state = this.state;
    if (!this.player.alive || this.reloading || state.ammo >= this.config.magazine || state.reserve <= 0 || this.switchRemaining > 0) return false;
    state.reloadRemaining = this.config.reloadTime;
    state.reloadElapsed = 0;
    state.reloadStage = 0;
    this.audio.reload('start');
    return true;
  }

  currentSpread() {
    const base = this.player.aiming ? this.config.adsSpread : this.config.spread;
    const movement = 1 + clamp(this.player.speed / 6, 0, 1) * 2.1;
    const air = this.player.grounded ? 1 : 2.6;
    const stance = this.player.crouched ? 0.76 : 1;
    return (base + this.heat * 0.0024) * movement * air * stance;
  }

  fire() {
    const state = this.state;
    if (state.cooldown > 0 || this.reloading || this.switchRemaining > 0 || !this.player.alive) return false;
    if (state.ammo <= 0) {
      this.reload();
      state.cooldown = 0.22;
      return false;
    }
    state.ammo--;
    state.cooldown = 60 / this.config.rpm;
    this.heat = clamp(this.heat + 0.17, 0, 1.4);
    this.recoil = clamp(this.recoil + (this.config.id === 'deagle' ? 0.15 : 0.075), 0, 0.25);
    this.flashTime = 0.045;
    this.model.flash.visible = true;
    this.model.light.intensity = this.config.id === 'deagle' ? 2.5 : 1.7;
    this.model.flash.material.rotation = Math.random() * Math.PI;
    this.player.shots++;
    this.shotCounter++;

    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const direction = this.camera.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const spread = this.currentSpread();
    direction.addScaledVector(right, (Math.random() - 0.5) * spread * 2);
    direction.addScaledVector(up, (Math.random() - 0.5) * spread * 2).normalize();
    const muzzle = this.model.muzzle.getWorldPosition(new THREE.Vector3());
    this.audio.shot(this.config.id, null, true);
    this.effects.shell(muzzle, right);
    this.player.addRecoil(this.config.recoil * (0.8 + Math.random() * 0.4) * (this.player.aiming ? 0.72 : 1), (Math.random() - 0.5) * this.config.recoil * 0.5);
    if (this.onFire) this.onFire({ shooter: this.player, origin, direction, config: this.config, muzzle, showTracer: this.shotCounter % this.config.tracerEvery === 0 });
    return true;
  }

  update(dt) {
    const input = this.input;
    this.player.aiming = input.aimHeld && this.player.alive && !this.player.sprinting && this.switchRemaining <= 0;
    if (input.consume('Digit1')) this.switchTo(0);
    if (input.consume('Digit2')) this.switchTo(1);
    if (input.consume('Digit3')) this.switchTo(2);
    if (input.wheel) this.cycle(input.wheel);
    if (input.consume('KeyR')) this.reload();
    if (this.switchRemaining > 0) this.switchRemaining = Math.max(0, this.switchRemaining - dt);

    this.states.forEach((state, index) => {
      state.cooldown = Math.max(0, state.cooldown - dt);
      if (state.reloadRemaining <= 0) return;
      state.reloadElapsed += dt;
      state.reloadRemaining -= dt;
      const progress = state.reloadElapsed / WEAPONS[index].reloadTime;
      if (progress > 0.38 && state.reloadStage === 0) {
        state.reloadStage = 1;
        if (index === this.currentIndex) this.audio.reload('mag');
      }
      if (state.reloadRemaining <= 0) {
        state.reloadRemaining = 0;
        const loaded = completeReload(state.ammo, state.reserve, WEAPONS[index].magazine);
        state.ammo = loaded.ammo;
        state.reserve = loaded.reserve;
        if (index === this.currentIndex) this.audio.reload('end');
      }
    });

    const trigger = this.config.automatic ? input.fireHeld : input.consumeFire();
    if (trigger && input.active) this.fire();
    this.heat = Math.max(0, this.heat - dt * 0.72);
    this.recoil = damp(this.recoil, 0, 18, dt);
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      this.model.light.intensity *= 0.65;
      if (this.flashTime <= 0) {
        this.model.flash.visible = false;
        this.model.light.intensity = 0;
      }
    }

    const targetPosition = this.player.aiming ? this.adsPosition : this.hipPosition;
    this.swayX = damp(this.swayX, clamp(-input.mouseDX * 0.00016, -0.025, 0.025), 12, dt);
    this.swayY = damp(this.swayY, clamp(input.mouseDY * 0.00012, -0.018, 0.018), 12, dt);
    const bob = this.player.grounded ? Math.sin(this.player.bobPhase * 2) * Math.min(0.012, this.player.speed * 0.002) : 0;
    const switchDrop = this.switchRemaining > 0 ? Math.sin(this.switchRemaining / 0.38 * Math.PI) * 0.32 : 0;
    const reloadDrop = this.reloading ? Math.sin((this.state.reloadElapsed / this.config.reloadTime) * Math.PI) * 0.16 : 0;
    const sprintDrop = this.player.sprinting ? 0.09 : 0;
    this.root.position.x = damp(this.root.position.x, targetPosition.x + this.swayX, 17, dt);
    this.root.position.y = damp(this.root.position.y, targetPosition.y + bob - switchDrop - reloadDrop - sprintDrop + this.swayY, 17, dt);
    this.root.position.z = damp(this.root.position.z, targetPosition.z + this.recoil, 20, dt);
    this.root.rotation.x = damp(this.root.rotation.x, -this.recoil * 0.8 + (this.reloading ? -0.28 : 0) + (this.player.sprinting ? -0.22 : 0), 16, dt);
    this.root.rotation.y = damp(this.root.rotation.y, this.swayX * 2 + (this.player.sprinting ? 0.32 : 0), 13, dt);
    this.root.rotation.z = damp(this.root.rotation.z, -this.swayX * 1.4 + (this.reloading ? -0.22 : 0), 13, dt);
    this.root.visible = this.player.alive;

    const targetFov = this.player.aiming ? (this.config.id === 'deagle' ? 62 : 53) : this.player.sprinting ? 79 : 74;
    const nextFov = damp(this.camera.fov, targetFov, 11, dt);
    if (Math.abs(nextFov - this.camera.fov) > 0.005) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
  }
}
