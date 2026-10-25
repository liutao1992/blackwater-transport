import * as THREE from 'three';
import { TransportWorld } from './world.js';
import { InputController, Player } from './player.js';
import { WeaponSystem } from './weapons.js';
import { BattleEffects } from './effects.js';
import { BotManager } from './bots.js';
import { AudioSystem } from './audio.js';
import { rayAABB } from './logic.js';

const ROUND_SECONDS = 240;
const SCORE_LIMIT = 30;

export class TransportGame {
  constructor({ scene, camera, renderer, canvas, ui }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.canvas = canvas;
    this.ui = ui;
    this.state = 'menu';
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.difficulty = 'regular';
    this.scores = { blue: 0, red: 0 };
    this.roundTime = ROUND_SECONDS;
    this.scoreLimit = SCORE_LIMIT;
    this.respawnTimer = 0;
    this.elapsed = 0;
    this.uiTimer = 0;
    this.lastKiller = null;
    this.world = new TransportWorld(scene, renderer, ui.settings.quality);
    this.audio = new AudioSystem();
    this.audio.setVolume(ui.settings.volume);
    this.input = new InputController(canvas);
    this.player = new Player(camera, this.world, this.input, this.audio);
    this.player.sensitivity = ui.settings.sensitivity;
    this.effects = new BattleEffects(scene, this.world);
    this.weapons = new WeaponSystem(camera, this.world, this.effects, this.audio, this.player, this.input);
    this.weapons.onFire = (shot) => this.resolveShot(shot);
    this.weapons.root.visible = false;
    this.bots = new BotManager(scene, this.world, this.effects, this.audio, this);
    this.player.onDeath = (source, headshot) => {
      this.lastKiller = source;
      this.registerKill(this.player, source, headshot);
      if (this.state === 'running') {
        this.respawnTimer = 3.2;
        this.ui.showDeath(source, this.respawnTimer);
      }
    };
    this.bindEvents();
    this.ui.attach(this);
    this.ui.buildMinimap(this.world);
    this.updateMenuCamera(0);
    this.exposeDebug();
  }

  bindEvents() {
    document.addEventListener('pointerlockchange', () => {
      if (this.input.locked) {
        this.input.fallbackActive = false;
        if (this.state === 'starting' || this.state === 'paused') {
          this.state = 'running';
          this.ui.showHUD();
          this.audio.resume();
        }
      } else if (this.state === 'running') {
        this.pause();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'running') {
        if (this.input.locked) document.exitPointerLock();
        else this.pause();
      }
    });
    window.addEventListener('blur', () => {
      if (this.state === 'running' && !this.input.locked) this.pause();
    });
    document.addEventListener('keydown', (event) => {
      if (event.code === 'Escape' && this.state === 'running' && this.input.fallbackActive) this.pause();
    });
  }

  exposeDebug() {
    window.__TRANSPORT__ = {
      getSnapshot: () => ({
        state: this.state,
        scores: { ...this.scores },
        time: this.roundTime,
        player: {
          health: this.player.health, armor: this.player.armor, alive: this.player.alive,
          position: this.player.position.toArray(), kills: this.player.kills, deaths: this.player.deaths,
          ammo: this.weapons.state.ammo, reserve: this.weapons.state.reserve, weapon: this.weapons.config.id,
        },
        bots: this.bots.bots.map((bot) => ({ name: bot.name, team: bot.team, health: bot.health, alive: bot.alive, kills: bot.kills, position: bot.position.toArray() })),
        render: { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles },
      }),
    };
    Object.defineProperty(window.__TRANSPORT__, 'game', { get: () => this });
  }

  requestLock() {
    try {
      const result = this.canvas.requestPointerLock();
      if (result?.catch) result.catch((error) => this.handleLockError(error));
    } catch (error) {
      this.handleLockError(error);
    }
  }

  handleLockError(error) {
    this.lastLockError = error ? String(error.message || error) : 'Pointer lock was not granted';
    console.warn('Pointer lock request failed:', error);
    if (this.state === 'starting') {
      this.input.fallbackActive = true;
      this.state = 'running';
      this.ui.showHUD();
      this.ui.toast('当前环境使用自由鼠标模式 · ESC 暂停');
    }
  }

  startNewRound() {
    this.audio.resume();
    this.scores.blue = this.scores.red = 0;
    this.roundTime = ROUND_SECONDS;
    this.respawnTimer = 0;
    this.lastKiller = null;
    Object.assign(this.player, { kills: 0, deaths: 0, headshots: 0, shots: 0, hits: 0 });
    this.player.reset(this.world.getSpawn('blue', 0));
    this.bots.bots.forEach((bot) => { bot.kills = bot.deaths = bot.shots = bot.hits = 0; });
    this.bots.reset();
    this.weapons.reset();
    this.weapons.root.visible = true;
    this.ui.clearKillFeed();
    this.ui.hideDeath();
    this.state = 'starting';
    this.ui.showDeployment();
    this.requestLock();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.audio.resume();
    this.state = 'starting';
    this.ui.showDeployment();
    this.requestLock();
  }

  pause() {
    if (this.state !== 'running' && this.state !== 'starting') return;
    this.state = 'paused';
    this.input.fallbackActive = false;
    this.input.reset();
    this.ui.showPause();
  }

  returnToMenu() {
    this.state = 'menu';
    this.input.fallbackActive = false;
    this.input.reset();
    this.weapons.root.visible = false;
    if (this.input.locked) document.exitPointerLock();
    this.ui.showMenu();
  }

  endRound() {
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.input.fallbackActive = false;
    this.input.reset();
    this.weapons.root.visible = false;
    if (this.input.locked) document.exitPointerLock();
    this.ui.showEnd(this.getScoreboard());
  }

  getOpponents(team) {
    const opponents = team === 'red'
      ? [this.player, ...this.bots.bots.filter((bot) => bot.team === 'blue')]
      : this.bots.bots.filter((bot) => bot.team === 'red');
    return opponents.filter((target) => target.alive);
  }

  resolveShot({ shooter, origin, direction, config, muzzle, showTracer = true }) {
    const maxDistance = config.range || 110;
    const staticHit = this.world.raycast(origin, direction, maxDistance);
    let nearest = staticHit ? { ...staticHit, target: null, hitType: null } : { distance: maxDistance, point: origin.clone().addScaledVector(direction, maxDistance), target: null };
    const characters = [this.player, ...this.bots.bots];
    for (const target of characters) {
      if (target === shooter || !target.alive) continue;
      for (const box of target.getHitboxes()) {
        const distance = rayAABB(origin, direction, box, nearest.distance);
        if (distance === null || distance < 0.02 || distance >= nearest.distance) continue;
        nearest = {
          distance,
          point: origin.clone().addScaledVector(direction, distance),
          normal: direction.clone().negate(),
          target,
          hitType: box.type,
        };
      }
    }

    let hitEnemy = false;
    let headshot = false;
    if (nearest.target) {
      const target = nearest.target;
      headshot = nearest.hitType === 'head';
      if (target.team !== shooter.team) {
        const damage = config.damage * (headshot ? config.headMultiplier : 1);
        const dealt = target.takeDamage(damage, shooter, headshot);
        if (dealt > 0) {
          hitEnemy = true;
          shooter.hits = (shooter.hits || 0) + 1;
          this.effects.impact(nearest.point, nearest.normal, 'blood');
          if (shooter.isPlayer) {
            this.audio.hit(headshot);
            this.ui.showHitmarker(headshot, !target.alive);
          }
        }
      }
    } else if (staticHit && nearest.distance === staticHit.distance) {
      this.effects.impact(staticHit.point, staticHit.normal, staticHit.collider.kind);
    }
    if (showTracer) this.effects.tracer(muzzle || origin, nearest.point, shooter.team === 'blue');
    return { hit: hitEnemy, headshot, target: nearest.target, killed: nearest.target ? !nearest.target.alive : false, point: nearest.point };
  }

  registerKill(victim, killer, headshot) {
    if (this.state !== 'running') return;
    if (killer && killer !== victim && killer.team !== victim.team) {
      killer.kills = (killer.kills || 0) + 1;
      this.scores[killer.team]++;
      if (killer.isPlayer) {
        if (headshot) this.player.headshots++;
        this.audio.kill();
        this.ui.showKillConfirmation(victim.name, headshot);
      }
      this.ui.addKillFeed(killer.name, victim.name, killer.team, headshot, killer.isPlayer || victim.isPlayer);
      if (this.scores[killer.team] >= this.scoreLimit) this.endRound();
    }
  }

  selectSpawn(team) {
    const opponents = this.getOpponents(team);
    let best = this.world.getSpawn(team, 0);
    let bestScore = -Infinity;
    for (let i = 0; i < 5; i++) {
      const spawn = this.world.getSpawn(team, i);
      let nearest = 80;
      for (const opponent of opponents) nearest = Math.min(nearest, spawn.distanceTo(opponent.position));
      const score = nearest + Math.random() * 5;
      if (score > bestScore) { bestScore = score; best = spawn; }
    }
    return best;
  }

  getScoreboard() {
    return [this.player, ...this.bots.bots].sort((a, b) => a.team.localeCompare(b.team) || b.kills - a.kills);
  }

  setSensitivity(value) { this.player.sensitivity = Number(value); }
  setVolume(value) { this.audio.setVolume(Number(value)); }
  setDifficulty(value) { this.difficulty = value; }
  setQuality(value) {
    this.world.setQuality(value);
    const ratio = value === 'high' ? Math.min(window.devicePixelRatio, 1.75) : value === 'medium' ? Math.min(window.devicePixelRatio, 1.25) : 1;
    this.renderer.setPixelRatio(ratio);
    this.renderer.shadowMap.enabled = value !== 'low';
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  updateMenuCamera(dt) {
    const t = this.reducedMotion ? 0 : this.elapsed;
    this.camera.fov = 58;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(25 + Math.sin(t * 0.08) * 3.5, 12.5 + Math.sin(t * 0.12) * 0.6, 27 + Math.cos(t * 0.08) * 5);
    this.camera.lookAt(0, 1.2, -4);
  }

  update(dt) {
    this.elapsed += dt;
    this.world.update(dt, this.elapsed);
    if (this.state === 'menu') {
      this.updateMenuCamera(dt);
      this.audio.updateListener(this.camera.position, this.camera.rotation.y);
      return;
    }
    if (this.state !== 'running') return;

    this.roundTime = Math.max(0, this.roundTime - dt);
    if (this.roundTime <= 0) { this.endRound(); return; }
    this.player.update(dt);
    this.weapons.update(dt);
    if (this.state !== 'running') return;
    this.bots.update(dt);
    if (this.state !== 'running') return;
    this.effects.update(dt);
    this.audio.updateListener(this.player.eyePosition, this.player.yaw);

    if (!this.player.alive) {
      this.respawnTimer -= dt;
      this.ui.updateRespawn(this.respawnTimer);
      if (this.respawnTimer <= 0) {
        this.player.reset(this.selectSpawn('blue'));
        this.weapons.refill();
        this.weapons.root.visible = true;
        this.ui.hideDeath();
      }
    }
    this.ui.setScoreboardVisible(this.input.down('Tab'));
    this.uiTimer -= dt;
    if (this.uiTimer <= 0) {
      this.ui.update(this);
      this.uiTimer = 0.045;
    }
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
