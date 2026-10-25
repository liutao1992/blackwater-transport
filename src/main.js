import * as THREE from 'three';
import '@fontsource/barlow-condensed/latin-400.css';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './styles.css';
import { GameUI } from './ui.js';
import { TransportGame } from './game.js';

const canvas = document.querySelector('#game-canvas');
const loadingStatus = document.querySelector('#loading-status');

async function boot() {
  try {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    const ui = new GameUI();
    const gl = renderer.getContext();
    const debugRenderer = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererName = debugRenderer ? gl.getParameter(debugRenderer.UNMASKED_RENDERER_WEBGL) : '';
    if (/swiftshader|llvmpipe|software/i.test(rendererName) && ui.settings.quality !== 'low') {
      ui.settings.quality = 'low';
      ui.syncSettingInputs();
      ui.saveSettings();
    }
    const pixelRatio = ui.settings.quality === 'high' ? Math.min(window.devicePixelRatio, 1.75) : ui.settings.quality === 'medium' ? Math.min(window.devicePixelRatio, 1.25) : 1;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = ui.settings.quality !== 'low';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x91a4aa);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.045, 650);
    scene.add(camera);
    loadingStatus.textContent = '生成货轮、集装箱与实时海面…';
    const game = new TransportGame({ scene, camera, renderer, canvas, ui });
    game.setQuality(ui.settings.quality);

    let lastTime = performance.now();
    function frame(now) {
      const dt = Math.min(0.1, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;
      game.update(dt);
      game.render();
      game.input.endFrame();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    await renderer.compileAsync(scene, camera);
    ui.showMenu();
    document.documentElement.dataset.ready = 'true';
  } catch (error) {
    console.error('Transport initialization failed:', error);
    loadingStatus.textContent = '无法初始化 WebGL。请使用支持硬件加速的 Chrome / Edge，并刷新重试。';
    document.querySelector('.loading-track').classList.add('is-hidden');
    const retry = document.createElement('button');
    retry.className = 'secondary-button';
    retry.style.width = '250px';
    retry.style.marginTop = '24px';
    retry.textContent = '重新加载';
    retry.addEventListener('click', () => location.reload());
    document.querySelector('#loading-screen').appendChild(retry);
  }
}

boot();
