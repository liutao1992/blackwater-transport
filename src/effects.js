import * as THREE from 'three';

function radialTexture(inner, outer = 'rgba(0,0,0,0)') {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.22, inner);
  gradient.addColorStop(1, outer);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function bulletTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 28);
  gradient.addColorStop(0, 'rgba(3,5,5,.95)');
  gradient.addColorStop(0.28, 'rgba(9,11,10,.9)');
  gradient.addColorStop(0.43, 'rgba(40,42,38,.65)');
  gradient.addColorStop(0.7, 'rgba(20,22,20,.12)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export class BattleEffects {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.tracers = [];
    this.particles = [];
    this.decals = [];
    this.shells = [];
    this.flashes = [];
    this.sparkGeometry = new THREE.BoxGeometry(0.018, 0.018, 0.09);
    this.sparkMaterials = {
      metal: new THREE.MeshBasicMaterial({ color: 0xffbd62 }),
      concrete: new THREE.MeshBasicMaterial({ color: 0xc5c1ad }),
      wood: new THREE.MeshBasicMaterial({ color: 0xa77b47 }),
      blood: new THREE.MeshBasicMaterial({ color: 0x8f2823 }),
    };
    this.decalGeometry = new THREE.PlaneGeometry(0.13, 0.13);
    this.decalMaterial = new THREE.MeshBasicMaterial({ map: bulletTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.flashTexture = radialTexture('rgba(255,225,145,1)', 'rgba(255,115,25,0)');
    this.shellGeometry = new THREE.BoxGeometry(0.018, 0.018, 0.055);
    this.shellMaterial = new THREE.MeshStandardMaterial({ color: 0xb58a42, metalness: 0.85, roughness: 0.3 });
  }

  tracer(start, end, friendly = true) {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const material = new THREE.LineBasicMaterial({ color: friendly ? 0xffd895 : 0xffb078, transparent: true, opacity: 0.68, blending: THREE.AdditiveBlending, depthWrite: false });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 4;
    this.scene.add(line);
    this.tracers.push({ line, life: 0.075, maxLife: 0.075 });
    if (this.tracers.length > 36) this.removeTracer(0);
  }

  removeTracer(index) {
    const [{ line }] = this.tracers.splice(index, 1);
    this.scene.remove(line);
    line.geometry.dispose();
    line.material.dispose();
  }

  muzzle(position, scale = 0.32) {
    const material = new THREE.SpriteMaterial({ map: this.flashTexture, color: 0xffd08a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.setScalar(scale * (0.8 + Math.random() * 0.4));
    this.scene.add(sprite);
    this.flashes.push({ sprite, life: 0.045 });
  }

  impact(point, normal, kind = 'metal') {
    if (kind !== 'blood') {
      const decal = new THREE.Mesh(this.decalGeometry, this.decalMaterial);
      decal.position.copy(point).addScaledVector(normal, 0.012);
      decal.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      decal.rotateZ(Math.random() * Math.PI * 2);
      const scale = 0.75 + Math.random() * 0.55;
      decal.scale.setScalar(scale);
      this.scene.add(decal);
      this.decals.push({ mesh: decal, life: 42 });
      if (this.decals.length > 64) {
        const old = this.decals.shift();
        this.scene.remove(old.mesh);
      }
    }
    const particleKind = kind === 'ground' ? 'concrete' : (this.sparkMaterials[kind] ? kind : 'metal');
    const count = kind === 'blood' ? 7 : 5;
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.sparkGeometry, this.sparkMaterials[particleKind]);
      mesh.position.copy(point);
      mesh.scale.setScalar(0.6 + Math.random());
      this.scene.add(mesh);
      const velocity = normal.clone().multiplyScalar(1.2 + Math.random() * 2.6);
      velocity.x += (Math.random() - 0.5) * 2.2;
      velocity.y += Math.random() * 1.8;
      velocity.z += (Math.random() - 0.5) * 2.2;
      this.particles.push({ mesh, velocity, life: 0.2 + Math.random() * 0.28 });
    }
    while (this.particles.length > 90) {
      const old = this.particles.shift();
      this.scene.remove(old.mesh);
    }
  }

  shell(position, right) {
    const mesh = new THREE.Mesh(this.shellGeometry, this.shellMaterial);
    mesh.position.copy(position);
    mesh.castShadow = true;
    this.scene.add(mesh);
    const velocity = right.clone().multiplyScalar(1.2 + Math.random() * 0.7);
    velocity.y = 1.4 + Math.random() * 0.7;
    this.shells.push({ mesh, velocity, spin: new THREE.Vector3(Math.random() * 9, Math.random() * 12, Math.random() * 8), life: 1.4 });
    if (this.shells.length > 28) {
      const old = this.shells.shift();
      this.scene.remove(old.mesh);
    }
  }

  update(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tracer = this.tracers[i];
      tracer.life -= dt;
      tracer.line.material.opacity = Math.max(0, tracer.life / tracer.maxLife) * 0.68;
      if (tracer.life <= 0) this.removeTracer(i);
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const flash = this.flashes[i];
      flash.life -= dt;
      if (flash.life <= 0) {
        this.scene.remove(flash.sprite);
        flash.sprite.material.dispose();
        this.flashes.splice(i, 1);
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      particle.life -= dt;
      particle.velocity.y -= 8 * dt;
      particle.mesh.position.addScaledVector(particle.velocity, dt);
      particle.mesh.lookAt(particle.mesh.position.clone().add(particle.velocity));
      if (particle.life <= 0) {
        this.scene.remove(particle.mesh);
        this.particles.splice(i, 1);
      }
    }
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const shell = this.shells[i];
      shell.life -= dt;
      shell.velocity.y -= 9.8 * dt;
      shell.mesh.position.addScaledVector(shell.velocity, dt);
      shell.mesh.rotation.x += shell.spin.x * dt;
      shell.mesh.rotation.y += shell.spin.y * dt;
      shell.mesh.rotation.z += shell.spin.z * dt;
      if (shell.mesh.position.y < 0.025) {
        shell.mesh.position.y = 0.025;
        shell.velocity.y = Math.abs(shell.velocity.y) * 0.28;
        shell.velocity.x *= 0.72;
        shell.velocity.z *= 0.72;
      }
      if (shell.life <= 0) {
        this.scene.remove(shell.mesh);
        this.shells.splice(i, 1);
      }
    }
    for (let i = this.decals.length - 1; i >= 0; i--) {
      this.decals[i].life -= dt;
      if (this.decals[i].life <= 0) {
        this.scene.remove(this.decals[i].mesh);
        this.decals.splice(i, 1);
      }
    }
  }
}
