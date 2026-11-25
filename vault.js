// Vault: saved special cards (localStorage), a gallery grid and a 3D slab viewer.
import * as THREE from 'three';
import { RoomEnvironment } from './vendor/addons/environments/RoomEnvironment.js';
import { serialFor } from './slab.js';
import { t, formatDate } from './i18n.js';

const KEY = 'po-vault-v1';
const rarityName = (r) => (r === 'RR' || r === 'R' ? t('rarity.' + r) : r);

export function loadVault() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
export function addToVault(card) {
  const list = loadVault();
  const entry = {
    name: card.name, number: card.number, rarity: card.rarity,
    serial: Math.floor(10000000 + Math.random() * 89999999), ts: Date.now(),
  };
  list.unshift(entry);
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 300))); } catch { /* storage full or blocked: keep in memory only */ }
  return entry;
}

export function createVaultUI({ els, cardImage, getSlabKit, onOpenChange }) {
  let viewer = null;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function updateCount() {
    const n = loadVault().length;
    els.count.textContent = String(n);
    els.button.setAttribute('aria-label', t('vault.aria', { n }));
  }

  function renderGrid() {
    const list = loadVault();
    els.grid.innerHTML = '';
    els.empty.hidden = list.length > 0;
    els.summary.textContent = list.length ? t('vault.summary', { n: list.length }) : '';
    list.forEach((e, i) => {
      const li = document.createElement('li');
      li.style.animationDelay = `${Math.min(i, 12) * 0.04}s`;
      const date = formatDate(e.ts);
      li.innerHTML = `
        <button class="po-slab po-slab--${e.rarity}" type="button" aria-label="${t('vault.item', { n: e.number, r: rarityName(e.rarity), d: date })}">
          <span class="po-slab__label">
            <span class="po-slab__text"><b>M6 · Emerald Storm</b><span>No.${String(e.number).padStart(3, '0')}/076</span></span>
            <span class="po-slab__grade">${e.rarity}</span>
          </span>
          <span class="po-slab__window"><img src="${cardImage(e.name)}" alt="" loading="lazy"></span>
        </button>
        <span class="po-slab__meta">${date}</span>`;
      li.querySelector('button').addEventListener('click', () => openViewer(e));
      els.grid.appendChild(li);
    });
  }

  function open() {
    renderGrid();
    els.panel.hidden = false;
    onOpenChange(true);
    els.close.focus();
  }
  function close() {
    els.panel.hidden = true;
    onOpenChange(false);
    els.button.focus();
  }

  // ---------------------------------------------------------------- 3D viewer
  function ensureViewer() {
    if (viewer) return viewer;
    const renderer = new THREE.WebGLRenderer({ canvas: els.viewerCanvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.setClearColor(0x000000, 1);
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    camera.position.set(0, 0, 9);
    scene.add(new THREE.AmbientLight(0xffffff, 0.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(2, 3, 4);
    scene.add(key);
    // coloured rim lights orbit the case to throw the pink/cyan edge glints
    const rimA = new THREE.PointLight(0xff3d7f, 18, 12);
    const rimB = new THREE.PointLight(0x3dc8ff, 18, 12);
    scene.add(rimA, rimB);
    const pivot = new THREE.Group();
    scene.add(pivot);
    const loader = new THREE.TextureLoader();
    viewer = { renderer, scene, camera, pivot, loader, rimA, rimB, slab: null, raf: 0, rotY: 0, vel: 0, dragging: false, lastX: 0, idle: 0 };

    const resize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const kit = getSlabKit();
      const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const fitH = (kit.dims.H * 1.3) / (2 * t);
      const fitW = (kit.dims.W * 1.45) / (2 * t * camera.aspect);
      camera.position.z = Math.max(fitH, fitW);
      camera.updateProjectionMatrix();
    };
    viewer.resize = resize;
    window.addEventListener('resize', () => { if (!els.viewer.hidden) resize(); });

    const c = els.viewerCanvas;
    c.addEventListener('pointerdown', (e) => {
      viewer.dragging = true; viewer.lastX = e.clientX; viewer.vel = 0;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!viewer.dragging) return;
      const dx = e.clientX - viewer.lastX;
      viewer.lastX = e.clientX;
      const d = (dx / window.innerWidth) * Math.PI * 2.2;
      viewer.rotY += d;
      viewer.vel = d * 60;
    });
    const up = () => { viewer.dragging = false; viewer.idle = 0; };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    return viewer;
  }

  function openViewer(entry) {
    const v = ensureViewer();
    if (v.slab) { v.pivot.remove(v.slab); v.slab = null; }
    const map = v.loader.load(cardImage(entry.name));
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = v.renderer.capabilities.getMaxAnisotropy();
    v.slab = getSlabKit().build(entry, map);
    v.pivot.add(v.slab);
    v.rotY = -0.5; v.vel = 0; v.idle = 1;
    viewer.entry = entry;
    renderCaption(entry);
    els.viewer.hidden = false;
    v.resize();
    els.viewerClose.focus();
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min((now - last) / 1000, 1 / 20);
      last = now;
      if (!v.dragging) {
        v.idle += dt;
        v.rotY += v.vel * dt;
        v.vel *= Math.pow(0.05, dt);
        if (v.idle > 1.2 && !reduceMotion) v.rotY += dt * 0.45;   // resume a slow turntable spin
      }
      v.pivot.rotation.y = v.rotY;
      v.pivot.rotation.x = Math.sin(now / 2400) * 0.06;
      const a = now / 1600;
      v.rimA.position.set(Math.cos(a) * 3.2, 1.6, Math.sin(a) * 3.2);
      v.rimB.position.set(Math.cos(a + Math.PI) * 3.2, -1.4, Math.sin(a + Math.PI) * 3.2);
      v.renderer.render(v.scene, v.camera);
      v.raf = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(v.raf);
    v.raf = requestAnimationFrame(loop);
  }
  function renderCaption(entry) {
    const date = formatDate(entry.ts, true);
    els.caption.innerHTML = `<b>No.${String(entry.number).padStart(3, '0')}/076 · ${rarityName(entry.rarity)}</b><span>${t('viewer.caption', { s: serialFor(entry), d: date })}</span>`;
  }

  function closeViewer() {
    if (!viewer) return;
    cancelAnimationFrame(viewer.raf);
    els.viewer.hidden = true;
  }

  els.button.addEventListener('click', open);
  els.close.addEventListener('click', close);
  els.viewerClose.addEventListener('click', closeViewer);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!els.viewer.hidden) closeViewer();
    else if (!els.panel.hidden) close();
  });
  updateCount();

  // re-render text after a language change
  function refresh() {
    updateCount();
    if (!els.panel.hidden) renderGrid();
    if (viewer && viewer.entry && !els.viewer.hidden) renderCaption(viewer.entry);
  }

  return { open, close, updateCount, refresh, isOpen: () => !els.panel.hidden };
}
