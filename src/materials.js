import * as THREE from 'three';
import { seededRandom } from './logic.js';

function canvasTexture(canvas, repeatX = 1, repeatY = 1, color = true) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 4;
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makePaint(base, seed, options = {}) {
  const size = options.size || 384;
  const canvas = document.createElement('canvas');
  const bump = document.createElement('canvas');
  canvas.width = canvas.height = bump.width = bump.height = size;
  const ctx = canvas.getContext('2d');
  const btx = bump.getContext('2d');
  const random = seededRandom(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  btx.fillStyle = '#888';
  btx.fillRect(0, 0, size, size);

  const image = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const grain = Math.floor((random() - 0.5) * 18);
    image.data[i] += grain;
    image.data[i + 1] += grain;
    image.data[i + 2] += grain;
  }
  ctx.putImageData(image, 0, 0);

  for (let i = 0; i < 95; i++) {
    const x = random() * size;
    const y = random() * size;
    const radius = 2 + random() * 25;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(74,35,18,${0.1 + random() * 0.3})`);
    gradient.addColorStop(0.45, `rgba(133,65,29,${0.08 + random() * 0.2})`);
    gradient.addColorStop(1, 'rgba(80,40,20,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 130; i++) {
    const x = random() * size;
    const y = random() * size;
    const length = 3 + random() * 50;
    ctx.strokeStyle = `rgba(225,230,220,${0.025 + random() * 0.08})`;
    ctx.lineWidth = 0.4 + random();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + length, y + (random() - 0.5) * 5);
    ctx.stroke();
    btx.strokeStyle = `rgba(40,40,40,${0.1 + random() * 0.25})`;
    btx.lineWidth = 1;
    btx.beginPath();
    btx.moveTo(x, y);
    btx.lineTo(x + length, y);
    btx.stroke();
  }

  if (options.deck) {
    ctx.strokeStyle = 'rgba(12,18,19,.48)';
    ctx.lineWidth = 3;
    for (let x = 0; x <= size; x += size / 4) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke();
    }
    for (let y = 0; y <= size; y += size / 2) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
    }
    for (let y = 4; y < size; y += 9) {
      for (let x = (y % 18) + 3; x < size; x += 12) {
        ctx.fillStyle = 'rgba(220,225,215,.13)';
        ctx.fillRect(x, y, 3, 1);
        btx.fillStyle = '#aaa';
        btx.fillRect(x, y, 3, 1);
      }
    }
  }
  return { map: canvasTexture(canvas, options.repeatX || 1, options.repeatY || 1), bumpMap: canvasTexture(bump, options.repeatX || 1, options.repeatY || 1, false) };
}

function makeWood() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 384;
  const ctx = canvas.getContext('2d');
  const random = seededRandom(90210);
  ctx.fillStyle = '#74583a';
  ctx.fillRect(0, 0, 384, 384);
  for (let plank = 0; plank < 6; plank++) {
    const y = plank * 64;
    ctx.fillStyle = plank % 2 ? '#806143' : '#705336';
    ctx.fillRect(0, y + 2, 384, 60);
    ctx.fillStyle = '#342a20';
    ctx.fillRect(0, y, 384, 2);
    for (let i = 0; i < 25; i++) {
      ctx.strokeStyle = `rgba(40,25,12,${0.08 + random() * 0.15})`;
      ctx.beginPath();
      const gy = y + random() * 60;
      ctx.moveTo(0, gy);
      ctx.bezierCurveTo(100, gy + random() * 7, 270, gy - random() * 7, 384, gy + random() * 4);
      ctx.stroke();
    }
  }
  return canvasTexture(canvas);
}

export function createMaterialLibrary() {
  const deckMaps = makePaint('#59605e', 18, { deck: true, repeatX: 9, repeatY: 22, size: 512 });
  const hullMaps = makePaint('#424c50', 81, { repeatX: 4, repeatY: 12 });
  const wallMaps = makePaint('#a1a49b', 43, { repeatX: 3, repeatY: 2 });
  const metalMaps = makePaint('#4b5355', 117);
  const wood = makeWood();
  const library = {
    deck: new THREE.MeshStandardMaterial({ ...deckMaps, roughness: 0.91, metalness: 0.48, bumpScale: 0.075 }),
    hull: new THREE.MeshStandardMaterial({ ...hullMaps, roughness: 0.82, metalness: 0.55, bumpScale: 0.09 }),
    wall: new THREE.MeshStandardMaterial({ ...wallMaps, roughness: 0.85, metalness: 0.3, bumpScale: 0.055 }),
    metal: new THREE.MeshStandardMaterial({ ...metalMaps, roughness: 0.64, metalness: 0.78, bumpScale: 0.045 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x20292c, roughness: 0.58, metalness: 0.8 }),
    paintedBlack: new THREE.MeshStandardMaterial({ color: 0x151c1e, roughness: 0.72, metalness: 0.4 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x101516, roughness: 0.96 }),
    wood: new THREE.MeshStandardMaterial({ map: wood, roughness: 0.94, bumpMap: wood, bumpScale: 0.045 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x547682, roughness: 0.2, metalness: 0.15, transmission: 0.15, transparent: true, opacity: 0.78 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xd99832, roughness: 0.68, metalness: 0.45 }),
    whitePaint: new THREE.MeshStandardMaterial({ color: 0xb8bdb7, roughness: 0.78, metalness: 0.35 }),
    redPaint: new THREE.MeshStandardMaterial({ color: 0x7c322b, roughness: 0.78, metalness: 0.42 }),
    light: new THREE.MeshStandardMaterial({ color: 0xffd89a, emissive: 0xffb04c, emissiveIntensity: 2.2 }),
  };
  const colors = [
    ['blue', '#385d69'],
    ['red', '#87473c'],
    ['green', '#536454'],
    ['ochre', '#92703f'],
    ['gray', '#6f7773'],
  ];
  library.containers = colors.map(([name, color], index) => {
    const maps = makePaint(color, 200 + index * 19);
    const material = new THREE.MeshStandardMaterial({ ...maps, roughness: 0.78, metalness: 0.54, bumpScale: 0.085 });
    material.name = `container-${name}`;
    return material;
  });
  return library;
}

export function makeLabelTexture(title, subtitle = '', accent = '#e6e1cf') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 192);
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.72;
  ctx.lineWidth = 4;
  ctx.strokeRect(12, 12, 488, 168);
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = accent;
  ctx.font = '700 82px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, 256, 105);
  ctx.globalAlpha = 0.66;
  ctx.font = '500 25px monospace';
  ctx.fillText(subtitle, 256, 151);
  return canvasTexture(canvas);
}

export function makeWaterNormals(size = 128) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size * Math.PI * 2;
      const v = y / size * Math.PI * 2;
      const dx = Math.cos(u * 3 + Math.sin(v * 2)) * 0.42 + Math.cos(u * 7 - v * 3) * 0.18;
      const dy = Math.cos(v * 4 + Math.sin(u * 3)) * 0.42 + Math.cos(v * 8 + u * 2) * 0.16;
      const normal = new THREE.Vector3(-dx, -dy, 1).normalize();
      const i = (y * size + x) * 4;
      data[i] = (normal.x * 0.5 + 0.5) * 255;
      data[i + 1] = (normal.y * 0.5 + 0.5) * 255;
      data[i + 2] = (normal.z * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
