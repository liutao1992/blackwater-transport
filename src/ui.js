import * as THREE from 'three';
import { clamp, formatTime } from './logic.js';

const DEFAULTS = { quality: 'high', difficulty: 'regular', sensitivity: 0.75, volume: 0.75 };

export class GameUI {
  constructor() {
    this.settings = this.loadSettings();
    this.game = null;
    this.hitTime = 0;
    this.killTime = 0;
    this.damageTime = 0;
    this.toastTimer = null;
    this.lastHealth = 100;
    this.killEntries = [];
    this.friendlyMarkers = [];
    this.tempVector = new THREE.Vector3();
    this.tempDirection = new THREE.Vector3();
    this.elements = {};
    document.querySelectorAll('[id]').forEach((element) => { this.elements[element.id] = element; });
    document.querySelectorAll('svg').forEach((icon) => icon.setAttribute('aria-hidden', 'true'));
    this.syncSettingInputs();
    this.bindSettings();
  }

  loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem('blackwater-settings') || '{}');
      return { ...DEFAULTS, ...saved };
    } catch { return { ...DEFAULTS }; }
  }

  saveSettings() {
    try { localStorage.setItem('blackwater-settings', JSON.stringify(this.settings)); } catch { /* Storage is optional. */ }
  }

  syncSettingInputs() {
    document.querySelectorAll('[data-setting]').forEach((input) => {
      input.value = this.settings[input.dataset.setting];
    });
    document.querySelectorAll('[data-value="sensitivity"]').forEach((element) => { element.textContent = Number(this.settings.sensitivity).toFixed(2); });
    document.querySelectorAll('[data-value="volume"]').forEach((element) => { element.textContent = `${Math.round(this.settings.volume * 100)}%`; });
  }

  bindSettings() {
    document.querySelectorAll('[data-setting]').forEach((input) => {
      const handler = () => {
        const key = input.dataset.setting;
        this.settings[key] = input.type === 'range' ? Number(input.value) : input.value;
        this.syncSettingInputs();
        this.saveSettings();
        if (!this.game) return;
        if (key === 'quality') { this.game.setQuality(input.value); this.toast(`画面质量已切换为${input.options[input.selectedIndex].text}`); }
        if (key === 'difficulty') this.game.setDifficulty(input.value);
        if (key === 'sensitivity') this.game.setSensitivity(input.value);
        if (key === 'volume') this.game.setVolume(input.value);
      };
      input.addEventListener(input.type === 'range' ? 'input' : 'change', handler);
    });
  }

  attach(game) {
    this.game = game;
    const on = (id, handler) => this.elements[id].addEventListener('click', () => { game.audio.ui(); handler(); });
    on('start-button', () => game.startNewRound());
    on('resume-button', () => game.resume());
    on('restart-button', () => game.startNewRound());
    on('menu-button', () => game.returnToMenu());
    on('play-again-button', () => game.startNewRound());
    on('end-menu-button', () => game.returnToMenu());
    document.addEventListener('keydown', (event) => {
      if (event.code !== 'Enter' || event.repeat) return;
      if (game.state === 'menu') game.startNewRound();
      else if (game.state === 'ended') game.startNewRound();
      else if (game.state === 'paused') game.resume();
    });
    this.createFriendlyMarkers();
  }

  hideOverlays() {
    ['loading-screen', 'menu-screen', 'pause-screen', 'end-screen', 'deployment-hint', 'scoreboard-overlay'].forEach((id) => this.elements[id].classList.add('is-hidden'));
  }

  showMenu() {
    this.hideOverlays();
    this.hideDeath();
    this.elements.hud.classList.add('is-hidden');
    this.elements['damage-vignette'].style.opacity = '0';
    this.elements['menu-screen'].classList.remove('is-hidden');
    document.body.dataset.state = 'menu';
    this.lastHealth = 100;
  }

  showDeployment() {
    this.hideOverlays();
    this.elements.hud.classList.remove('is-hidden');
    this.elements['deployment-hint'].classList.remove('is-hidden');
    document.body.dataset.state = 'deployment';
  }

  showHUD() {
    this.hideOverlays();
    this.elements.hud.classList.remove('is-hidden');
    if (this.game.player.alive) this.hideDeath();
    document.body.dataset.state = 'combat';
  }

  showPause(message) {
    this.hideOverlays();
    this.elements.hud.classList.remove('is-hidden');
    this.elements['pause-screen'].classList.remove('is-hidden');
    this.elements['pause-message'].textContent = message || '战场已冻结，继续时重新锁定鼠标。';
    document.body.dataset.state = 'paused';
    requestAnimationFrame(() => this.elements['resume-button'].focus());
  }

  showDeath(killer, timer) {
    this.elements['respawn-screen'].classList.remove('is-hidden');
    this.elements['killer-name'].textContent = killer ? `${killer.name} 的火力击中了你` : '你在交火中阵亡';
    this.updateRespawn(timer);
  }

  updateRespawn(timer) { this.elements['respawn-count'].textContent = Math.max(0, timer).toFixed(1); }
  hideDeath() { this.elements['respawn-screen'].classList.add('is-hidden'); }

  showEnd(scoreboard) {
    this.hideOverlays();
    this.hideDeath();
    this.elements.hud.classList.add('is-hidden');
    this.elements['damage-vignette'].style.opacity = '0';
    this.elements['end-screen'].classList.remove('is-hidden');
    const { blue, red } = this.game.scores;
    this.elements['result-title'].textContent = blue > red ? '任务成功' : blue < red ? '行动失败' : '势均力敌';
    this.elements['final-blue'].textContent = blue;
    this.elements['final-red'].textContent = red;
    this.elements['stat-kills'].textContent = this.game.player.kills;
    this.elements['stat-deaths'].textContent = this.game.player.deaths;
    this.elements['stat-headshots'].textContent = this.game.player.headshots;
    this.elements['stat-accuracy'].textContent = `${this.game.player.shots ? Math.round(this.game.player.hits / this.game.player.shots * 100) : 0}%`;
    this.renderScoreboard(this.elements['end-scoreboard'], scoreboard);
    document.body.dataset.state = 'ended';
    requestAnimationFrame(() => this.elements['play-again-button'].focus());
  }

  renderScoreboard(tbody, scoreboard) {
    tbody.replaceChildren();
    scoreboard.forEach((entry) => {
      const row = document.createElement('tr');
      if (entry.isPlayer) row.className = 'is-player';
      const values = [entry.name, entry.team === 'blue' ? '守卫者' : '潜伏者', entry.kills, entry.deaths, (entry.kills / Math.max(1, entry.deaths)).toFixed(2)];
      values.forEach((value) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.appendChild(cell);
      });
      tbody.appendChild(row);
    });
  }

  setScoreboardVisible(visible) {
    this.elements['scoreboard-overlay'].classList.toggle('is-hidden', !visible || this.game.state !== 'running');
    if (visible) this.renderScoreboard(this.elements['live-scoreboard'], this.game.getScoreboard());
  }

  showHitmarker(headshot, killed) {
    this.hitTime = killed ? 0.28 : 0.16;
    this.elements.hitmarker.classList.toggle('headshot', headshot);
    this.elements.hitmarker.classList.toggle('killed', killed);
    this.elements.hitmarker.classList.add('active');
  }

  showKillConfirmation(name, headshot) {
    this.killTime = 1.25;
    this.elements['kill-confirmation'].replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = headshot ? '爆头击杀' : '敌方击杀';
    const span = document.createElement('span');
    span.textContent = name;
    this.elements['kill-confirmation'].append(strong, span);
    this.elements['kill-confirmation'].classList.add('active');
  }

  addKillFeed(killer, victim, team, headshot, important) {
    const entry = document.createElement('div');
    entry.className = `kill-entry${important ? ' important' : ''}`;
    const killerSpan = document.createElement('span');
    killerSpan.className = team === 'blue' ? 'blue-name' : 'red-name';
    killerSpan.textContent = killer;
    const method = document.createElement('b');
    method.textContent = headshot ? '  爆头  ' : '  ▸  ';
    const victimSpan = document.createElement('span');
    victimSpan.textContent = victim;
    entry.append(killerSpan, method, victimSpan);
    this.elements['kill-feed'].prepend(entry);
    this.killEntries.push({ element: entry, time: performance.now() });
    while (this.killEntries.length > 5) this.killEntries.shift().element.remove();
    setTimeout(() => {
      entry.classList.add('expired');
      setTimeout(() => entry.remove(), 250);
    }, 4300);
  }

  clearKillFeed() {
    this.elements['kill-feed'].replaceChildren();
    this.killEntries = [];
    this.killTime = this.hitTime = this.damageTime = 0;
    this.elements['kill-confirmation'].classList.remove('active');
    this.elements.hitmarker.classList.remove('active');
  }

  createFriendlyMarkers() {
    const container = this.elements['friendly-markers'];
    container.replaceChildren();
    this.friendlyMarkers = this.game.bots.bots.filter((bot) => bot.team === 'blue').map((bot) => {
      const marker = document.createElement('div');
      marker.className = 'friendly-marker';
      const name = document.createElement('span');
      name.textContent = bot.name;
      const distance = document.createElement('small');
      marker.append(name, distance);
      container.appendChild(marker);
      return { bot, marker, distance };
    });
  }

  buildMinimap(world) {
    this.world = world;
    this.mapCanvas = document.createElement('canvas');
    this.mapCanvas.width = this.elements.minimap.width;
    this.mapCanvas.height = this.elements.minimap.height;
    const ctx = this.mapCanvas.getContext('2d');
    const w = this.mapCanvas.width;
    const h = this.mapCanvas.height;
    ctx.fillStyle = 'rgba(6,14,18,.92)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(132,162,171,.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    const point = (x, z) => [w / 2 + x * 4, h / 2 + z * 4];
    ctx.strokeStyle = 'rgba(163,190,197,.48)';
    ctx.lineWidth = 3;
    const a = point(-17.5, -38.5);
    ctx.strokeRect(a[0], a[1], 35 * 4, 77 * 4);
    world.getMinimapBlocks().filter((block) => block.minY < 0.1).forEach((block) => {
      const start = point(block.minX, block.minZ);
      ctx.fillStyle = block.kind === 'wood' ? '#806a4d' : '#596e73';
      ctx.fillRect(start[0], start[1], (block.maxX - block.minX) * 4, (block.maxZ - block.minZ) * 4);
      ctx.strokeStyle = 'rgba(205,220,218,.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(start[0], start[1], (block.maxX - block.minX) * 4, (block.maxZ - block.minZ) * 4);
    });
    ctx.fillStyle = 'rgba(88,183,209,.55)';
    ctx.font = '500 17px IBM Plex Mono, monospace';
    ctx.fillText('A', w / 2 + 48, h / 2 + 32 * 4);
    ctx.fillStyle = 'rgba(229,107,96,.55)';
    ctx.fillText('B', w / 2 + 48, h / 2 - 29 * 4);
  }

  updateMinimap(game) {
    const canvas = this.elements.minimap;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.mapCanvas, 0, 0);
    const point = (position) => [canvas.width / 2 + position.x * 4, canvas.height / 2 + position.z * 4];
    for (const bot of game.bots.bots) {
      if (!bot.alive) continue;
      const [x, y] = point(bot.position);
      if (bot.team === 'blue') {
        ctx.fillStyle = '#58b7d1';
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
      } else if (game.player.alive && bot.position.distanceTo(game.player.position) < 17 && this.world.lineOfSight(game.player.eyePosition, bot.eyePosition)) {
        ctx.fillStyle = '#e56b60';
        ctx.fillRect(x - 4, y - 4, 8, 8);
      }
    }
    if (game.player.alive) {
      const [x, y] = point(game.player.position);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-game.player.yaw);
      ctx.fillStyle = '#f3eee0';
      ctx.shadowColor = '#f2b544';
      ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(7, 8); ctx.lineTo(0, 5); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  updateFriendlyMarkers(game) {
    const camera = game.camera;
    camera.getWorldDirection(this.tempDirection);
    this.friendlyMarkers.forEach(({ bot, marker, distance }) => {
      if (!bot.alive || !game.player.alive) { marker.style.display = 'none'; return; }
      this.tempVector.set(bot.position.x, bot.position.y + 2.05, bot.position.z);
      const toBot = this.tempVector.clone().sub(camera.position);
      if (toBot.dot(this.tempDirection) <= 0) { marker.style.display = 'none'; return; }
      this.tempVector.project(camera);
      if (Math.abs(this.tempVector.x) > 0.94 || Math.abs(this.tempVector.y) > 0.88) { marker.style.display = 'none'; return; }
      marker.style.display = 'flex';
      marker.style.left = `${(this.tempVector.x * 0.5 + 0.5) * window.innerWidth}px`;
      marker.style.top = `${(-this.tempVector.y * 0.5 + 0.5) * window.innerHeight}px`;
      distance.textContent = `${Math.round(bot.position.distanceTo(game.player.position))}m`;
    });
  }

  update(game) {
    const player = game.player;
    const weapon = game.weapons;
    this.elements['blue-score'].textContent = game.scores.blue;
    this.elements['red-score'].textContent = game.scores.red;
    this.elements['round-time'].textContent = formatTime(game.roundTime);
    this.elements['round-time'].classList.toggle('urgent', game.roundTime < 30);
    this.elements['health-value'].textContent = Math.ceil(player.health);
    this.elements['armor-value'].textContent = Math.ceil(player.armor);
    this.elements['health-bar'].style.width = `${player.health}%`;
    this.elements['health-bar'].classList.toggle('low', player.health <= 30);
    if (player.health < this.lastHealth) this.damageTime = 0.42;
    this.lastHealth = player.health;
    this.elements['weapon-name'].textContent = weapon.config.name;
    this.elements['weapon-role'].textContent = weapon.config.role;
    this.elements['ammo-value'].textContent = String(weapon.state.ammo).padStart(2, '0');
    this.elements['reserve-value'].textContent = weapon.state.reserve;
    this.elements['ammo-value'].classList.toggle('low', weapon.state.ammo <= Math.ceil(weapon.config.magazine * 0.2));
    this.elements['fire-mode'].textContent = weapon.config.automatic ? '全自动' : '半自动';
    this.elements['stance-text'].textContent = !player.alive ? '阵亡' : player.crouched ? '蹲伏' : player.aiming ? '机瞄' : player.sprinting ? '冲刺' : !player.grounded ? '跳跃' : '站立';
    document.querySelectorAll('[data-slot]').forEach((slot) => slot.classList.toggle('active', Number(slot.dataset.slot) === weapon.currentIndex));
    const reload = this.elements['reload-indicator'];
    reload.classList.toggle('active', weapon.reloading);
    if (weapon.reloading) reload.querySelector('b').style.width = `${clamp(weapon.state.reloadElapsed / weapon.config.reloadTime * 100, 0, 100)}%`;
    const crosshair = this.elements.crosshair;
    crosshair.style.setProperty('--gap', `${6 + weapon.currentSpread() * 650}px`);
    crosshair.style.opacity = player.aiming || !player.alive ? '0' : player.sprinting ? '0.4' : '0.9';
    this.hitTime -= 0.045;
    if (this.hitTime <= 0) this.elements.hitmarker.classList.remove('active');
    this.killTime -= 0.045;
    if (this.killTime <= 0) this.elements['kill-confirmation'].classList.remove('active');
    this.damageTime = Math.max(0, this.damageTime - 0.045);
    this.elements['damage-vignette'].style.opacity = this.damageTime > 0 ? String(clamp(this.damageTime * 2.2, 0, 0.85)) : String(player.alive && player.health <= 30 ? 0.16 : 0);
    this.updateMinimap(game);
    this.updateFriendlyMarkers(game);
  }

  toast(message) {
    clearTimeout(this.toastTimer);
    this.elements.toast.textContent = message;
    this.elements.toast.classList.add('active');
    this.toastTimer = setTimeout(() => this.elements.toast.classList.remove('active'), 2200);
  }
}
