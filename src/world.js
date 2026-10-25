import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, rayAABB } from './logic.js';
import { createMaterialLibrary, makeLabelTexture, makeWaterNormals } from './materials.js';

const UP = new THREE.Vector3(0, 1, 0);
const _direction = new THREE.Vector3();
const _point = new THREE.Vector3();

function transformedBox(size, position, rotation = null) {
  const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
  geometry.translate(position[0], position[1], position[2]);
  if (rotation) geometry.rotateY(rotation);
  return geometry;
}

function createContainerGeometry() {
  const parts = [transformedBox([7.9, 2.62, 2.7], [0, 1.4, 0])];
  for (const z of [-1.39, 1.39]) {
    for (let x = -3.65; x <= 3.66; x += 0.4) {
      parts.push(transformedBox([0.075, 2.38, 0.095], [x, 1.4, z]));
    }
    for (const y of [0.13, 2.67]) parts.push(transformedBox([8.04, 0.13, 0.12], [0, y, z]));
  }
  for (let x = -3.65; x <= 3.66; x += 0.4) {
    parts.push(transformedBox([0.08, 0.08, 2.68], [x, 2.77, 0]));
  }
  for (const x of [-3.96, 3.96]) {
    for (const z of [-1.31, 1.31]) parts.push(transformedBox([0.13, 2.8, 0.13], [x, 1.4, z]));
    for (const z of [-0.68, 0.68]) parts.push(transformedBox([0.07, 2.45, 1.26], [x, 1.4, z]));
    for (const z of [-1.04, -0.35, 0.35, 1.04]) parts.push(transformedBox([0.1, 2.2, 0.055], [x * 1.012, 1.4, z]));
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((part) => part.dispose());
  return merged;
}

function createCrateGeometry() {
  const parts = [transformedBox([1.34, 1.34, 1.34], [0, 0.67, 0])];
  for (const z of [-0.69, 0.69]) {
    for (const x of [-0.58, 0.58]) parts.push(transformedBox([0.11, 1.34, 0.09], [x, 0.67, z]));
    for (const y of [0.1, 1.24]) parts.push(transformedBox([1.34, 0.11, 0.09], [0, y, z]));
    const diagonal = new THREE.BoxGeometry(0.11, 1.58, 0.085);
    diagonal.rotateZ(Math.PI / 4);
    diagonal.translate(0, 0.67, z);
    parts.push(diagonal);
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((part) => part.dispose());
  return merged;
}

class MinHeap {
  constructor() { this.items = []; }
  push(index, score) {
    const item = { index, score };
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.items[p].score <= score) break;
      this.items[i] = this.items[p];
      i = p;
    }
    this.items[i] = item;
  }
  pop() {
    if (!this.items.length) return null;
    const root = this.items[0];
    const tail = this.items.pop();
    if (this.items.length) {
      let i = 0;
      while (i * 2 + 1 < this.items.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.items.length && this.items[child + 1].score < this.items[child].score) child++;
        if (this.items[child].score >= tail.score) break;
        this.items[i] = this.items[child];
        i = child;
      }
      this.items[i] = tail;
    }
    return root.index;
  }
  get length() { return this.items.length; }
}

export class TransportWorld {
  constructor(scene, renderer, quality = 'high') {
    this.scene = scene;
    this.renderer = renderer;
    this.quality = quality;
    this.colliders = [];
    this.mapBlocks = [];
    this.materials = createMaterialLibrary();
    this.unitBox = new THREE.BoxGeometry(1, 1, 1);
    this.containerGeometry = createContainerGeometry();
    this.crateGeometry = createCrateGeometry();
    this.radar = [];
    this.lowMaterialCache = new Map();
    this.bounds = { minX: -16.55, maxX: 16.55, minZ: -36.1, maxZ: 36.1 };
    this.spawnPoints = {
      blue: [
        [-3, 32.8], [3, 32.8], [-8, 31.8], [8, 31.8], [0, 34.1],
      ],
      red: [
        [3, -32.8], [-3, -32.8], [8, -31.8], [-8, -31.8], [0, -34.1],
      ],
    };
    this.build();
    this.setQuality(quality);
  }

  build() {
    this.scene.background = new THREE.Color(0x91a4aa);
    this.scene.fog = new THREE.FogExp2(0x91a4aa, 0.0058);
    this.buildLighting();
    this.buildShip();
    this.buildBases();
    this.buildCargo();
    this.buildDetails();
    this.mergeStaticMeshes();
    this.buildNavigation();
  }

  buildLighting() {
    const sky = new Sky();
    sky.scale.setScalar(45000);
    const uniforms = sky.material.uniforms;
    uniforms.turbidity.value = 7;
    uniforms.rayleigh.value = 1.7;
    uniforms.mieCoefficient.value = 0.007;
    uniforms.mieDirectionalG.value = 0.82;
    const phi = THREE.MathUtils.degToRad(90 - 28);
    const theta = THREE.MathUtils.degToRad(128);
    this.sunDirection = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    uniforms.sunPosition.value.copy(this.sunDirection);
    this.scene.add(sky);
    this.sky = sky;

    const hemisphere = new THREE.HemisphereLight(0xc5d7df, 0x273135, 1.65);
    this.scene.add(hemisphere);
    this.sun = new THREE.DirectionalLight(0xffe0b5, 3.25);
    this.sun.position.copy(this.sunDirection).multiplyScalar(80);
    this.sun.castShadow = this.quality !== 'low';
    this.sun.shadow.mapSize.set(this.quality === 'high' ? 2048 : 1024, this.quality === 'high' ? 2048 : 1024);
    Object.assign(this.sun.shadow.camera, { left: -46, right: 46, top: 48, bottom: -48, near: 1, far: 180 });
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.035;
    this.scene.add(this.sun, this.sun.target);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environmentTarget = pmrem.fromScene(room, 0.05);
    this.scene.environment = this.environmentTarget.texture;
    this.scene.environmentIntensity = 0.42;
    room.dispose();
    pmrem.dispose();

    this.waterNormals = makeWaterNormals();
    this.water = new Water(new THREE.PlaneGeometry(1100, 1100), {
      textureWidth: this.quality === 'high' ? 512 : 256,
      textureHeight: this.quality === 'high' ? 512 : 256,
      waterNormals: this.waterNormals,
      sunDirection: this.sunDirection.clone(),
      sunColor: 0xffe2b8,
      waterColor: 0x0b353d,
      distortionScale: 2.1,
      fog: true,
      alpha: 1,
    });
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = -2.7;
    this.water.material.uniforms.size.value = 3.8;
    this.reflectiveWaterMaterial = this.water.material;
    this.waterReflection = this.water.onBeforeRender;
    this.simpleWaterMaterial = new THREE.MeshPhongMaterial({ color: 0x0c3c47, shininess: 55, specular: 0x608a91, normalMap: this.waterNormals, normalScale: new THREE.Vector2(0.45, 0.45) });
    this.scene.add(this.water);
  }

  addBox(name, size, position, material, options = {}) {
    const mesh = new THREE.Mesh(this.unitBox, material);
    mesh.name = name;
    mesh.userData.mergeStatic = true;
    mesh.position.set(...position);
    mesh.scale.set(...size);
    if (options.rotationY) mesh.rotation.y = options.rotationY;
    mesh.castShadow = options.cast !== false;
    mesh.receiveShadow = options.receive !== false;
    this.scene.add(mesh);
    if (options.collider !== false) {
      const quarterTurn = options.rotationY && Math.abs(Math.sin(options.rotationY)) > 0.7;
      const xSize = quarterTurn ? size[2] : size[0];
      const zSize = quarterTurn ? size[0] : size[2];
      this.addCollider(name, position, [xSize, size[1], zSize], options.kind || 'metal', mesh);
    }
    return mesh;
  }

  addCollider(name, position, size, kind = 'metal', object = null) {
    const half = [size[0] / 2, size[1] / 2, size[2] / 2];
    const collider = {
      name,
      kind,
      object,
      min: new THREE.Vector3(position[0] - half[0], position[1] - half[1], position[2] - half[2]),
      max: new THREE.Vector3(position[0] + half[0], position[1] + half[1], position[2] + half[2]),
    };
    this.colliders.push(collider);
    return collider;
  }

  buildShip() {
    const m = this.materials;
    this.addBox('防滑钢甲板', [36, 0.65, 79], [0, -0.34, 0], m.deck, { kind: 'ground' });
    this.addBox('左舷船体', [1.3, 4.4, 80], [-18.1, -2.05, 0], m.hull);
    this.addBox('右舷船体', [1.3, 4.4, 80], [18.1, -2.05, 0], m.hull);
    this.addBox('舰尾水线', [36, 3.8, 1.2], [0, -2.2, 40], m.redPaint);
    this.addBox('舰首水线', [36, 3.8, 1.2], [0, -2.2, -40], m.redPaint);
    for (const side of [-1, 1]) {
      this.addBox('舷侧防护墙', [0.5, 1.18, 77], [side * 17.28, 0.55, 0], m.hull);
      this.addBox('舷侧扶手', [0.12, 0.1, 76], [side * 17.28, 1.65, 0], m.metal, { collider: false });
      for (let z = -36; z <= 36; z += 3) {
        this.addBox('护栏立柱', [0.09, 0.62, 0.09], [side * 17.28, 1.34, z], m.metal, { collider: false });
      }
    }
    for (const z of [-37.1, 37.1]) {
      this.addBox('端部防护墙', [35, 1.18, 0.45], [0, 0.55, z], m.hull);
    }

    for (const side of [-1, 1]) {
      for (let z = -29; z <= 29; z += 14.5) {
        const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.48, 12), m.darkMetal);
        bollard.position.set(side * 16.4, 0.24, z);
        bollard.castShadow = true;
        this.scene.add(bollard);
        this.addBox('系缆桩底座', [0.65, 0.12, 0.65], [side * 16.4, 0.06, z], m.metal, { collider: false });
      }
    }
  }

  buildBases() {
    const m = this.materials;
    for (const sign of [-1, 1]) {
      const team = sign > 0 ? 'blue' : 'red';
      const accent = sign > 0 ? m.orange : m.whitePaint;
      this.addBox(`${team} 下层舰桥`, [22, 4.2, 6], [0, 2.1, sign * 40], m.wall);
      this.addBox(`${team} 上层舰桥`, [11, 2.5, 4.2], [0, 5.45, sign * 40.7], m.wall);
      this.addBox('舰桥遮阳顶', [23, 0.18, 7], [0, 4.28, sign * 39.7], m.metal);
      this.addBox('出生区顶棚', [30, 0.16, 6.4], [0, 4.15, sign * 33.8], m.metal);
      for (const x of [-14.5, 14.5]) {
        this.addBox('顶棚立柱', [0.24, 4.15, 0.24], [x, 2.075, sign * 33.2], m.darkMetal);
      }
      for (const x of [-7.5, -3.8, 3.8, 7.5]) {
        this.addBox('舰桥窗', [2.8, 1.15, 0.08], [x, 2.55, sign * 36.96], m.glass, { collider: false, cast: false });
        this.addBox('窗框', [3, 0.08, 0.12], [x, 3.17, sign * 36.92], m.darkMetal, { collider: false });
      }
      for (const x of [-3, 0, 3]) {
        this.addBox('上层舰桥窗', [2.35, 1.05, 0.08], [x, 5.6, sign * 38.56], m.glass, { collider: false, cast: false });
      }
      this.addBox('舱门', [1.7, 2.55, 0.11], [0, 1.28, sign * 36.94], m.paintedBlack, { collider: false });
      this.addBox('出生区识别线', [10, 0.025, 0.18], [0, 0.018, sign * 29.5], accent, { collider: false, cast: false });

      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, 6, 10), m.metal);
      mast.position.set(0, 9.1, sign * 40.7);
      mast.castShadow = true;
      this.scene.add(mast);
      const radar = new THREE.Group();
      radar.position.set(0, 10.5, sign * 40.7);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.13, 0.18), m.whitePaint);
      bar.castShadow = true;
      radar.add(bar);
      const aerial = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.08), m.metal);
      aerial.position.y = 0.6;
      radar.add(aerial);
      this.scene.add(radar);
      this.radar.push(radar);

      const signTexture = makeLabelTexture(sign > 0 ? 'A / 07' : 'B / 07', 'TRANSPORT · DECK', '#e6e1cf');
      const signMaterial = new THREE.MeshBasicMaterial({ map: signTexture, transparent: true, side: THREE.DoubleSide });
      const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 1.4), signMaterial);
      signMesh.position.set(-10.5, 2.2, sign * 36.9);
      signMesh.rotation.y = sign > 0 ? Math.PI : 0;
      this.scene.add(signMesh);
    }
  }

  addContainer(x, z, rotation = 0, color = 0, level = 0, label = 'NSC') {
    const group = new THREE.Group();
    group.position.set(x, level * 2.8, z);
    group.rotation.y = rotation;
    const body = new THREE.Mesh(this.containerGeometry, this.materials.containers[color % this.materials.containers.length]);
    body.castShadow = true;
    body.receiveShadow = true;
    body.userData.mergeStatic = true;
    group.add(body);
    const texture = makeLabelTexture(label, `22G1  ·  ${30700 + color * 317} KG`);
    const decalMaterial = new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 0.82, metalness: 0.15, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const side of [-1, 1]) {
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 1.02), decalMaterial);
      decal.position.set(0.8 * side, 1.35, side * 1.448);
      decal.rotation.y = side < 0 ? Math.PI : 0;
      group.add(decal);
    }
    this.scene.add(group);
    const rotated = Math.abs(Math.sin(rotation)) > 0.7;
    const size = rotated ? [2.9, 2.8, 8.1] : [8.1, 2.8, 2.9];
    const collider = this.addCollider('货运集装箱', [x, level * 2.8 + 1.4, z], size, 'container', group);
    this.mapBlocks.push(collider);
    return group;
  }

  addCrate(x, z, level = 0) {
    const mesh = new THREE.Mesh(this.crateGeometry, this.materials.wood);
    mesh.position.set(x, level * 1.34, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.mergeStatic = true;
    this.scene.add(mesh);
    const collider = this.addCollider('木质军需箱', [x, level * 1.34 + 0.67, z], [1.38, 1.34, 1.38], 'wood', mesh);
    this.mapBlocks.push(collider);
  }

  buildCargo() {
    const containers = [
      [-3, -4.8, Math.PI / 2, 2, 0, 'NSC'], [3, -4.8, Math.PI / 2, 0, 0, 'NSC'],
      [-3, 4.8, Math.PI / 2, 4, 0, 'NSC'], [3, 4.8, Math.PI / 2, 1, 0, 'NSC'],
      [3, 4.8, Math.PI / 2, 2, 1, '07'],
      [-11.2, 0, Math.PI / 2, 1, 0, 'TEX'], [11.2, 0, Math.PI / 2, 3, 0, 'TEX'],
      [-7.8, 12.2, 0, 2, 0, 'NSC'], [7.8, 12.2, 0, 1, 0, 'NSC'],
      [-7.8, -12.2, 0, 4, 0, 'NSC'], [7.8, -12.2, 0, 0, 0, 'NSC'],
      [-13.3, 17.8, Math.PI / 2, 0, 0, 'MSK'], [13.3, -17.8, Math.PI / 2, 2, 0, 'MSK'],
      [13.3, 17.8, Math.PI / 2, 4, 0, 'MSK'], [-13.3, -17.8, Math.PI / 2, 1, 0, 'MSK'],
      [0, 23.5, 0, 3, 0, '07'], [0, -23.5, 0, 2, 0, '07'],
      [-9.4, 27.1, Math.PI / 2, 1, 0, 'TEX'], [9.4, -27.1, Math.PI / 2, 0, 0, 'TEX'],
      [-7.8, 12.2, 0, 4, 1, 'NSC'], [7.8, -12.2, 0, 3, 1, 'NSC'],
      [-13.3, -17.8, Math.PI / 2, 3, 1, 'MSK'], [13.3, 17.8, Math.PI / 2, 1, 1, 'MSK'],
    ];
    containers.forEach((args) => this.addContainer(...args));

    const crates = [
      [-5.2, 5.8], [-3.75, 5.8], [5.2, -5.8], [3.75, -5.8],
      [-13.6, 7], [13.6, -7], [-5.2, -6.3], [5.2, 6.3],
      [-6.2, 19], [6.2, -19], [6.2, 19], [-6.2, -19],
      [-11.2, 25.2], [11.2, -25.2], [11.2, 25.2], [-11.2, -25.2],
      [-14.8, -8.5], [14.8, 8.5],
    ];
    crates.forEach(([x, z], index) => {
      this.addCrate(x, z);
      if (index === 0 || index === 3 || index === 8 || index === 9) this.addCrate(x, z, 1);
    });

    for (const [x, z, rotation] of [[-5.8, 0, 0], [5.8, 0, 0], [0, 15.8, 0], [0, -15.8, 0]]) {
      this.addBox('混凝土隔离墩', [2.5, 1.05, 0.55], [x, 0.525, z], this.materials.wall, { rotationY: rotation, kind: 'concrete' });
      this.addBox('隔离墩警示条', [2.52, 0.18, 0.57], [x, 0.77, z], this.materials.orange, { collider: false });
    }
  }

  buildDetails() {
    const m = this.materials;
    for (const side of [-1, 1]) {
      for (const z of [-25, -10, 10, 25]) {
        const reel = new THREE.Group();
        const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.65, 16), m.darkMetal);
        axle.rotation.z = Math.PI / 2;
        reel.add(axle);
        for (const x of [-0.37, 0.37]) {
          const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.53, 0.53, 0.08, 16), m.metal);
          rim.rotation.z = Math.PI / 2;
          rim.position.x = x;
          reel.add(rim);
        }
        reel.position.set(side * 15.8, 0.55, z + side * 2.1);
        this.scene.add(reel);
      }
      for (let z = -31; z <= 31; z += 10) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.15, 0.5), m.light);
        lamp.position.set(side * 17, 1.05, z);
        this.scene.add(lamp);
      }
    }
    for (const z of [-28, -17, 17, 28]) {
      for (const x of [-15.7, 15.7]) {
        this.addBox('甲板标线', [0.08, 0.018, 4.5], [x, 0.012, z], m.whitePaint, { collider: false, cast: false });
      }
    }
    const helipadTexture = makeLabelTexture('07', 'CARGO OPERATIONS', '#d7cba7');
    const helipad = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.95), new THREE.MeshBasicMaterial({ map: helipadTexture, transparent: true, opacity: 0.48, depthWrite: false }));
    helipad.rotation.x = -Math.PI / 2;
    helipad.position.set(0, 0.016, 7.9);
    this.scene.add(helipad);
  }

  mergeStaticMeshes() {
    this.scene.updateMatrixWorld(true);
    const buckets = new Map();
    const sources = [];
    this.scene.traverse((object) => {
      if (!object.isMesh || !object.userData.mergeStatic || Array.isArray(object.material)) return;
      const key = object.material.uuid;
      if (!buckets.has(key)) buckets.set(key, { material: object.material, geometries: [] });
      const geometry = object.geometry.clone();
      geometry.applyMatrix4(object.matrixWorld);
      buckets.get(key).geometries.push(geometry);
      sources.push(object);
    });
    sources.forEach((mesh) => mesh.parent?.remove(mesh));
    this.staticMeshes = [];
    buckets.forEach(({ material, geometries }) => {
      const geometry = mergeGeometries(geometries, false);
      geometries.forEach((item) => item.dispose());
      if (!geometry) return;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `合并静态材质 ${material.name || material.uuid.slice(0, 6)}`;
      mesh.castShadow = !material.transparent && material !== this.materials.light;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.staticMeshes.push(mesh);
    });
  }

  lowMaterialFor(original) {
    if (this.lowMaterialCache.has(original.uuid)) return this.lowMaterialCache.get(original.uuid);
    const material = new THREE.MeshLambertMaterial({
      name: `${original.name || 'material'}-low`,
      color: original.color?.clone() || new THREE.Color(0xffffff),
      map: original.map || null,
      emissive: original.emissive?.clone() || new THREE.Color(0x000000),
      emissiveIntensity: original.emissiveIntensity ?? 1,
      transparent: original.transparent,
      opacity: original.opacity,
      side: original.side,
      depthWrite: original.depthWrite,
      alphaTest: original.alphaTest,
      polygonOffset: original.polygonOffset,
      polygonOffsetFactor: original.polygonOffsetFactor,
    });
    this.lowMaterialCache.set(original.uuid, material);
    return material;
  }

  setQuality(quality) {
    this.quality = quality;
    this.sun.castShadow = quality !== 'low';
    const size = quality === 'high' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(size, size);
    this.water.material = quality === 'low' ? this.simpleWaterMaterial : this.reflectiveWaterMaterial;
    this.water.onBeforeRender = quality === 'low' ? () => {} : this.waterReflection;
    this.scene.traverse((object) => {
      if (!object.isMesh || object === this.water || object === this.sky || Array.isArray(object.material)) return;
      if (quality === 'low' && (object.material.isMeshStandardMaterial || object.material.isMeshPhysicalMaterial)) {
        if (!object.userData.highMaterial) object.userData.highMaterial = object.material;
        object.material = this.lowMaterialFor(object.userData.highMaterial);
      } else if (quality !== 'low' && object.userData.highMaterial) {
        object.material = object.userData.highMaterial;
      }
    });
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
  }

  update(dt, elapsed) {
    if (this.quality === 'low') {
      this.waterNormals.offset.x = (this.waterNormals.offset.x + dt * 0.006) % 1;
      this.waterNormals.offset.y = (this.waterNormals.offset.y + dt * 0.003) % 1;
    } else {
      this.reflectiveWaterMaterial.uniforms.time.value += dt * 0.55;
    }
    this.radar.forEach((radar, index) => { radar.rotation.y = elapsed * (index ? -0.45 : 0.45); });
  }

  canOccupy(x, z, radius = 0.42, feetY = 0, height = 1.72) {
    if (x - radius < this.bounds.minX || x + radius > this.bounds.maxX || z - radius < this.bounds.minZ || z + radius > this.bounds.maxZ) return false;
    for (const box of this.colliders) {
      if (box.kind === 'ground' || feetY >= box.max.y - 0.12 || feetY + height <= box.min.y + 0.02) continue;
      if (x + radius > box.min.x && x - radius < box.max.x && z + radius > box.min.z && z - radius < box.max.z) return false;
    }
    return true;
  }

  groundHeight(x, z, currentY = 0, radius = 0.35) {
    let height = 0;
    for (const box of this.colliders) {
      if (box.kind === 'ground' || box.max.y > currentY + 0.28 || box.max.y <= height) continue;
      if (x + radius > box.min.x && x - radius < box.max.x && z + radius > box.min.z && z - radius < box.max.z) height = box.max.y;
    }
    return height;
  }

  raycast(origin, direction, maxDistance = 200) {
    let nearest = null;
    for (const collider of this.colliders) {
      const distance = rayAABB(origin, direction, collider, maxDistance);
      if (distance === null || distance < 0.015 || distance > maxDistance || (nearest && distance >= nearest.distance)) continue;
      const point = origin.clone().addScaledVector(direction, distance);
      const distances = [
        [Math.abs(point.x - collider.min.x), new THREE.Vector3(-1, 0, 0)],
        [Math.abs(point.x - collider.max.x), new THREE.Vector3(1, 0, 0)],
        [Math.abs(point.y - collider.min.y), new THREE.Vector3(0, -1, 0)],
        [Math.abs(point.y - collider.max.y), new THREE.Vector3(0, 1, 0)],
        [Math.abs(point.z - collider.min.z), new THREE.Vector3(0, 0, -1)],
        [Math.abs(point.z - collider.max.z), new THREE.Vector3(0, 0, 1)],
      ];
      distances.sort((a, b) => a[0] - b[0]);
      nearest = { distance, point, normal: distances[0][1], collider };
    }
    return nearest;
  }

  lineOfSight(start, end, padding = 0.3) {
    _direction.subVectors(end, start);
    const distance = _direction.length();
    if (distance < 0.001) return true;
    _direction.multiplyScalar(1 / distance);
    const hit = this.raycast(start, _direction, distance);
    return !hit || hit.distance >= distance - padding;
  }

  getSpawn(team, index = 0) {
    const points = this.spawnPoints[team];
    const point = points[index % points.length];
    return new THREE.Vector3(point[0], 0, point[1]);
  }

  buildNavigation() {
    const cell = 1;
    const nx = 33;
    const nz = 73;
    const originX = -16;
    const originZ = -36;
    const walkable = new Uint8Array(nx * nz);
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        walkable[z * nx + x] = this.canOccupy(originX + x * cell, originZ + z * cell, 0.47, 0, 1.72) ? 1 : 0;
      }
    }
    this.nav = { cell, nx, nz, originX, originZ, walkable };
  }

  nearestNode(position) {
    const nav = this.nav;
    const cx = clamp(Math.round((position.x - nav.originX) / nav.cell), 0, nav.nx - 1);
    const cz = clamp(Math.round((position.z - nav.originZ) / nav.cell), 0, nav.nz - 1);
    for (let radius = 0; radius < 10; radius++) {
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const x = cx + dx;
          const z = cz + dz;
          if (x < 0 || z < 0 || x >= nav.nx || z >= nav.nz) continue;
          if (nav.walkable[z * nav.nx + x]) return { x, z, index: z * nav.nx + x };
        }
      }
    }
    return null;
  }

  findPath(start, end) {
    const nav = this.nav;
    const from = this.nearestNode(start);
    const to = this.nearestNode(end);
    if (!from || !to) return [];
    if (from.index === to.index) return [new THREE.Vector3(end.x, 0, end.z)];
    const total = nav.nx * nav.nz;
    const costs = new Float32Array(total);
    costs.fill(Infinity);
    const parents = new Int32Array(total);
    parents.fill(-1);
    const closed = new Uint8Array(total);
    const heap = new MinHeap();
    costs[from.index] = 0;
    heap.push(from.index, 0);
    const directions = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    let iterations = 0;
    while (heap.length && iterations++ < 5000) {
      const current = heap.pop();
      if (closed[current]) continue;
      if (current === to.index) break;
      closed[current] = 1;
      const x = current % nav.nx;
      const z = Math.floor(current / nav.nx);
      for (const [dx, dz, step] of directions) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= nav.nx || nz >= nav.nz) continue;
        const next = nz * nav.nx + nx;
        if (!nav.walkable[next] || closed[next]) continue;
        if (dx && dz && (!nav.walkable[z * nav.nx + nx] || !nav.walkable[nz * nav.nx + x])) continue;
        const cost = costs[current] + step;
        if (cost >= costs[next]) continue;
        costs[next] = cost;
        parents[next] = current;
        const heuristic = Math.hypot(to.x - nx, to.z - nz);
        heap.push(next, cost + heuristic);
      }
    }
    if (parents[to.index] === -1) return [];
    const reversed = [];
    let current = to.index;
    while (current !== -1 && current !== from.index) {
      reversed.push(new THREE.Vector3(nav.originX + (current % nav.nx) * nav.cell, 0, nav.originZ + Math.floor(current / nav.nx) * nav.cell));
      current = parents[current];
    }
    reversed.reverse();
    const path = [];
    let anchor = start;
    for (let i = 0; i < reversed.length; i++) {
      let furthest = i;
      for (let j = reversed.length - 1; j > i; j--) {
        if (this.walkableLine(anchor, reversed[j])) { furthest = j; break; }
      }
      path.push(reversed[furthest]);
      anchor = reversed[furthest];
      i = furthest;
    }
    return path;
  }

  walkableLine(start, end) {
    const distance = Math.hypot(end.x - start.x, end.z - start.z);
    const steps = Math.ceil(distance / 0.45);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (!this.canOccupy(THREE.MathUtils.lerp(start.x, end.x, t), THREE.MathUtils.lerp(start.z, end.z, t), 0.47, 0, 1.72)) return false;
    }
    return true;
  }

  getMinimapBlocks() {
    return this.mapBlocks.map((block) => ({
      minX: block.min.x, maxX: block.max.x, minZ: block.min.z, maxZ: block.max.z,
      minY: block.min.y, kind: block.kind,
    }));
  }

  dispose() {
    this.water.geometry.dispose();
    this.water.material.dispose();
    this.environmentTarget.dispose();
    this.containerGeometry.dispose();
    this.crateGeometry.dispose();
    this.unitBox.dispose();
  }
}
