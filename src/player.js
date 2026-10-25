import * as THREE from 'three';
import { clamp, damp, absorbArmor } from './logic.js';

export class InputController {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.fireHeld = false;
    this.firePressed = false;
    this.aimHeld = false;
    this.fallbackActive = false;
    this.listeners = [];
    this.listen(window, 'keydown', (event) => {
      if (this.active && ['Space', 'Tab', 'ControlLeft', 'ControlRight', 'ArrowUp', 'ArrowDown'].includes(event.code)) event.preventDefault();
      if (!this.keys.has(event.code)) this.pressed.add(event.code);
      this.keys.add(event.code);
    });
    this.listen(window, 'keyup', (event) => this.keys.delete(event.code));
    this.listen(document, 'mousemove', (event) => {
      if (!this.active) return;
      this.mouseDX += event.movementX;
      this.mouseDY += event.movementY;
    });
    this.listen(document, 'mousedown', (event) => {
      if (!this.active) return;
      if (event.button === 0) {
        if (!this.fireHeld) this.firePressed = true;
        this.fireHeld = true;
      }
      if (event.button === 2) this.aimHeld = true;
    });
    this.listen(document, 'mouseup', (event) => {
      if (event.button === 0) this.fireHeld = false;
      if (event.button === 2) this.aimHeld = false;
    });
    this.listen(canvas, 'contextmenu', (event) => event.preventDefault());
    this.listen(canvas, 'wheel', (event) => {
      if (!this.active) return;
      event.preventDefault();
      this.wheel += Math.sign(event.deltaY);
    }, { passive: false });
    this.listen(window, 'blur', () => this.reset());
  }

  listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this.listeners.push([target, type, handler, options]);
  }

  get locked() { return document.pointerLockElement === this.canvas; }
  get active() { return this.locked || this.fallbackActive; }
  down(...codes) { return codes.some((code) => this.keys.has(code)); }
  consume(code) {
    const value = this.pressed.has(code);
    this.pressed.delete(code);
    return value;
  }
  consumeFire() { const value = this.firePressed; this.firePressed = false; return value; }
  endFrame() {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.pressed.clear();
    this.firePressed = false;
    this.wheel = 0;
  }
  reset() {
    this.keys.clear();
    this.pressed.clear();
    this.fireHeld = this.firePressed = this.aimHeld = false;
    this.mouseDX = this.mouseDY = 0;
  }
  dispose() { this.listeners.forEach((args) => args[0].removeEventListener(args[1], args[2], args[3])); }
}

export class Player {
  constructor(camera, world, input, audio) {
    this.camera = camera;
    this.world = world;
    this.input = input;
    this.audio = audio;
    this.team = 'blue';
    this.name = '你';
    this.isPlayer = true;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.health = 100;
    this.armor = 100;
    this.alive = true;
    this.radius = 0.38;
    this.height = 1.72;
    this.currentHeight = 1.72;
    this.crouched = false;
    this.crouchToggle = false;
    this.grounded = true;
    this.sprinting = false;
    this.aiming = false;
    this.stepDistance = 0;
    this.bobPhase = 0;
    this.sensitivity = 0.75;
    this.kills = 0;
    this.deaths = 0;
    this.headshots = 0;
    this.shots = 0;
    this.hits = 0;
    this.onDeath = null;
    this.reset(new THREE.Vector3(0, 0, 32));
  }

  reset(spawn) {
    this.position.copy(spawn);
    this.velocity.set(0, 0, 0);
    this.health = 100;
    this.armor = 100;
    this.alive = true;
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.currentHeight = 1.72;
    this.crouched = false;
    this.crouchToggle = false;
    this.grounded = true;
    this.updateCamera(0);
  }

  get speed() { return Math.hypot(this.velocity.x, this.velocity.z); }
  get eyePosition() { return new THREE.Vector3(this.position.x, this.position.y + this.currentHeight, this.position.z); }

  getHitboxes() {
    const h = this.currentHeight;
    return [
      { type: 'head', min: new THREE.Vector3(this.position.x - 0.2, this.position.y + h - 0.36, this.position.z - 0.2), max: new THREE.Vector3(this.position.x + 0.2, this.position.y + h, this.position.z + 0.2) },
      { type: 'body', min: new THREE.Vector3(this.position.x - 0.34, this.position.y + 0.2, this.position.z - 0.27), max: new THREE.Vector3(this.position.x + 0.34, this.position.y + h - 0.34, this.position.z + 0.27) },
    ];
  }

  takeDamage(amount, source, headshot = false) {
    if (!this.alive) return 0;
    const result = headshot
      ? { health: Math.max(0, this.health - amount), armor: Math.max(0, this.armor - amount * 0.12) }
      : absorbArmor(this.health, this.armor, amount);
    const dealt = this.health - result.health;
    this.health = result.health;
    this.armor = result.armor;
    this.audio.damage();
    if (this.health <= 0) this.kill(source, headshot);
    return dealt;
  }

  kill(source, headshot = false) {
    if (!this.alive) return;
    this.alive = false;
    this.deaths++;
    this.velocity.set(0, 0, 0);
    if (this.onDeath) this.onDeath(source, headshot);
  }

  addRecoil(amount, horizontal) {
    this.pitch = clamp(this.pitch + amount, -1.45, 1.45);
    this.yaw += horizontal;
  }

  update(dt) {
    if (this.input.active) {
      const scale = 0.00145 * this.sensitivity * (this.aiming ? 0.72 : 1);
      this.yaw -= this.input.mouseDX * scale;
      this.pitch = clamp(this.pitch - this.input.mouseDY * scale, -1.46, 1.46);
    }
    if (!this.alive) {
      this.roll = damp(this.roll, -0.15, 4, dt);
      this.currentHeight = damp(this.currentHeight, 0.48, 3, dt);
      this.updateCamera(dt);
      return;
    }

    if (this.input.consume('KeyC')) this.crouchToggle = !this.crouchToggle;
    this.crouched = this.crouchToggle || this.input.down('ControlLeft', 'ControlRight');
    const targetHeight = this.crouched ? 1.16 : 1.72;
    this.currentHeight = damp(this.currentHeight, targetHeight, 14, dt);

    let forward = 0;
    let right = 0;
    if (this.input.down('KeyW', 'ArrowUp')) forward += 1;
    if (this.input.down('KeyS', 'ArrowDown')) forward -= 1;
    if (this.input.down('KeyD')) right += 1;
    if (this.input.down('KeyA')) right -= 1;
    const length = Math.hypot(forward, right) || 1;
    forward /= length;
    right /= length;
    this.sprinting = forward > 0.5 && this.input.down('ShiftLeft', 'ShiftRight') && !this.aiming && !this.crouched;
    const speed = this.crouched ? 2.55 : this.aiming ? 3.15 : this.sprinting ? 7.25 : 5.05;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const targetX = (-sin * forward + cos * right) * speed;
    const targetZ = (-cos * forward - sin * right) * speed;
    const acceleration = this.grounded ? 15 : 3.2;
    this.velocity.x = damp(this.velocity.x, targetX, acceleration, dt);
    this.velocity.z = damp(this.velocity.z, targetZ, acceleration, dt);

    const nextX = this.position.x + this.velocity.x * dt;
    if (this.world.canOccupy(nextX, this.position.z, this.radius, this.position.y, this.currentHeight)) this.position.x = nextX;
    else this.velocity.x = 0;
    const nextZ = this.position.z + this.velocity.z * dt;
    if (this.world.canOccupy(this.position.x, nextZ, this.radius, this.position.y, this.currentHeight)) this.position.z = nextZ;
    else this.velocity.z = 0;

    if (this.input.consume('Space') && this.grounded && !this.crouched) {
      this.velocity.y = 6.55;
      this.grounded = false;
    }
    this.velocity.y -= 15.5 * dt;
    let nextY = this.position.y + this.velocity.y * dt;
    const ground = this.world.groundHeight(this.position.x, this.position.z, Math.max(this.position.y, nextY), this.radius * 0.75);
    if (this.velocity.y <= 0 && nextY <= ground) {
      nextY = ground;
      this.velocity.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }
    this.position.y = nextY;

    const travelled = this.speed * dt;
    if (this.grounded && this.speed > 0.6) {
      this.stepDistance += travelled;
      this.bobPhase += travelled * (this.sprinting ? 2.6 : 2.25);
      const stride = this.sprinting ? 2.75 : 2.25;
      if (this.stepDistance > stride) {
        this.stepDistance = 0;
        this.audio.footstep(this.sprinting);
      }
    }
    this.roll = damp(this.roll, -right * (this.sprinting ? 0.018 : 0.01), 9, dt);
    this.updateCamera(dt);
  }

  updateCamera() {
    const bob = this.alive && this.grounded ? Math.sin(this.bobPhase * 2) * Math.min(0.026, this.speed * 0.004) : 0;
    this.camera.position.set(this.position.x, this.position.y + this.currentHeight + bob, this.position.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.yaw, this.roll);
  }
}
