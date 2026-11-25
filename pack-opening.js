// Booster pack opening — 3D pack, swipe-to-tear, card reveal.
// Self-contained test page; reads card data/images from the parent site (../assets).
import * as THREE from 'three';
import { RoomEnvironment } from './vendor/addons/environments/RoomEnvironment.js';
import { createSlabKit } from './slab.js';
import { addToVault, createVaultUI } from './vault.js';
import { t, applyStatic, setLang, onLangChange } from './i18n.js';

const CFG = {
  packFront: './assets/pack-front.png',
  cardBack: './assets/card-back.png',
  cardList: './assets/cardlist.json',
  cardImage: (name) => `./assets/cards/${name}.jpg`,
  cardsPerPack: 5,
  packW: 2.0,
  packAspect: 824 / 406,      // height / width of the pack art
  cardAspect: 1212 / 868,
  tearFromTop: 0.068,         // tear line, as a fraction of pack height from the top
  crimpTop: 0.040,            // flat sealed band at the top / bottom
  crimpBottom: 0.042,
  puff: 0.2,                  // how much the pillow bulges
  completeAt: 0.78,           // swipe progress that counts as a full tear
};

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const PACK_W = CFG.packW;
const PACK_H = CFG.packW * CFG.packAspect;
const TEAR_V = 1 - CFG.tearFromTop;                  // in uv space (v=1 is the top)
const TEAR_Y = (TEAR_V - 0.5) * PACK_H;
const CARD_W = 1.6;
const CARD_H = CARD_W * CFG.cardAspect;

// ---------------------------------------------------------------- DOM
const $ = (id) => document.getElementById(id);
const canvas = $('po-canvas');
const ui = {
  hint: $('po-hint'), tear: $('po-tear'), skip: $('po-skip'), counter: $('po-counter'),
  results: $('po-results'), grid: $('po-results-grid'), again: $('po-again'),
  finger: $('po-finger'), flash: $('po-flash'), open: $('po-open'),
  toast: $('po-toast'), resultsVault: $('po-results-vault'), vaultBtn: $('po-vault-btn'),
};

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
// cap the pixel ratio: 3x phones gain little visually but pay ~2x fill cost
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 0.95;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
const camBase = new THREE.Vector3(0, 0, 10);
const camFocus = { y: 0, zoom: 1 };   // animated: where the camera looks and how close it is

const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(2.5, 3.5, 5);
key.intensity = 0.9;
scene.add(key);
scene.add(new THREE.AmbientLight(0xffffff, 0.25));

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // fit the pack (plus margin) in both directions
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const fitH = (PACK_H * 1.32) / (2 * t);
  const fitW = (PACK_W * 1.5) / (2 * t * camera.aspect);
  camBase.z = Math.max(fitH, fitW);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- helpers
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const ease = {
  outCubic: (p) => 1 - Math.pow(1 - p, 3),
  inCubic: (p) => p * p * p,
  inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  outBack: (p) => { const c = 1.6; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); },
};
function rand(seed) { const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Failed to load ' + src));
    img.src = src;
  });
}
function canvasTex(cv, srgb = true) {
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }

// Simple tween runner
const tweens = [];
function tween(dur, fn, { delay = 0, easing = (p) => p, done } = {}) {
  return new Promise((resolve) => {
    tweens.push({ t: -delay, dur: reduceMotion ? Math.min(dur, 0.25) : dur, fn, easing, done: () => { done && done(); resolve(); } });
  });
}
function runTweens(dt) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.t += dt;
    if (tw.t < 0) continue;
    const p = clamp(tw.t / tw.dur, 0, 1);
    tw.fn(tw.easing(p), p);
    if (p >= 1) { tweens.splice(i, 1); tw.done(); }
  }
}
const wait = (s) => tween(s, () => {});

// ---------------------------------------------------------------- pack geometry
// One face of a pillow pack: flat, crimped bands at top and bottom, bulging middle, pinched sides.
function packDeform(u, v) {
  const dTop = 1 - v, dBot = v;
  const fy = smooth(CFG.crimpTop, CFG.crimpTop + 0.06, dTop) * smooth(CFG.crimpBottom, CFG.crimpBottom + 0.08, dBot);
  const fx = Math.pow(Math.max(Math.sin(Math.PI * u), 0), 0.55);
  let z = 0.006 + CFG.puff * fx * fy;    // small base thickness keeps front/back/lining from z-fighting
  z += 0.007 * fy * fx * (Math.sin(u * 29 + v * 13) * Math.sin(v * 41 - u * 7));    // foil wrinkles
  const pinch = 1 - 0.035 * fy;
  return [(u - 0.5) * PACK_W * pinch, (v - 0.5) * PACK_H, z];
}
function makePackGeometry(segX = 56, segY = 112) {
  const g = new THREE.PlaneGeometry(PACK_W, PACK_H, segX, segY);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const [x, y, z] = packDeform(uv.getX(i), uv.getY(i));
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- pack textures
const TEX_W = 812, TEX_H = 1648; // 2x the pack art for crisper edges

function drawCrimpRidges(ctx, y0, y1, alpha) {
  // soft vertical ridges (gradient, wide enough to survive mipmapping)
  for (let x = 0; x < TEX_W; x += 16) {
    const g = ctx.createLinearGradient(x, 0, x + 16, 0);
    g.addColorStop(0, `rgba(0,0,0,${alpha})`);
    g.addColorStop(0.5, `rgba(255,255,255,${alpha})`);
    g.addColorStop(1, `rgba(0,0,0,${alpha})`);
    ctx.fillStyle = g;
    ctx.fillRect(x, y0, 16, y1 - y0);
  }
}

function buildFrontTexture(img) {
  const [c, ctx] = makeCanvas(TEX_W, TEX_H);
  ctx.drawImage(img, 0, 0, TEX_W, TEX_H);
  drawCrimpRidges(ctx, 0, CFG.crimpTop * TEX_H, 0.14);
  drawCrimpRidges(ctx, TEX_H * (1 - CFG.crimpBottom), TEX_H, 0.14);
  return canvasTex(c);
}

// Original back design: darkened, mirrored art with an info panel.
function buildBackTexture(img) {
  const [c, ctx] = makeCanvas(TEX_W, TEX_H);
  ctx.save();
  ctx.translate(TEX_W, 0);
  ctx.scale(-1, 1);
  ctx.filter = 'blur(10px) saturate(1.3)';
  ctx.drawImage(img, -40, -40, TEX_W + 80, TEX_H + 80);
  ctx.restore();
  ctx.fillStyle = 'rgba(4, 30, 20, 0.62)';
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  // keep the red sealed bands from the front
  const bandT = CFG.crimpTop * TEX_H + 14, bandB = CFG.crimpBottom * TEX_H + 14;
  ctx.drawImage(img, 0, 0, img.width, img.height * (bandT / TEX_H), 0, 0, TEX_W, bandT);
  ctx.drawImage(img, 0, img.height * (1 - bandB / TEX_H), img.width, img.height * (bandB / TEX_H), 0, TEX_H - bandB, TEX_W, bandB);
  drawCrimpRidges(ctx, 0, CFG.crimpTop * TEX_H, 0.12);
  drawCrimpRidges(ctx, TEX_H * (1 - CFG.crimpBottom), TEX_H, 0.12);
  // diagonal emerald streaks
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 9; i++) {
    const g = ctx.createLinearGradient(0, 0, TEX_W, 0);
    g.addColorStop(0, 'rgba(36,211,141,0)');
    g.addColorStop(0.5, `rgba(36,211,141,${0.05 + rand(i) * 0.08})`);
    g.addColorStop(1, 'rgba(36,211,141,0)');
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(TEX_W / 2, 200 + i * 160);
    ctx.rotate(-0.35);
    ctx.fillRect(-TEX_W, -8 - rand(i + 3) * 18, TEX_W * 2, 16 + rand(i + 5) * 36);
    ctx.restore();
  }
  ctx.restore();
  // info panel
  const px = 90, py = 980, pw = TEX_W - 180, ph = 420;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  roundRect(ctx, px, py, pw, ph, 22); ctx.fill();
  ctx.fillStyle = '#0b2a1d';
  ctx.font = '700 40px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('EMERALD STORM', TEX_W / 2, py + 72);
  ctx.font = '500 26px system-ui, sans-serif';
  ctx.fillText('Mega Evolution Expansion Pack · M6', TEX_W / 2, py + 116);
  ctx.fillText('5 random cards per pack', TEX_W / 2, py + 156);
  // barcode
  let bx = px + 70;
  for (let i = 0; i < 46; i++) {
    const w = 2 + Math.floor(rand(i * 2.3) * 5);
    ctx.fillRect(bx, py + 210, w, 120);
    bx += w + 2 + Math.floor(rand(i * 5.1) * 4);
    if (bx > px + pw - 70) break;
  }
  ctx.font = '500 22px ui-monospace, monospace';
  ctx.fillText('4 521329 000 M6F', TEX_W / 2, py + 370);
  return canvasTex(c);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Alpha masks: serrated top/bottom edges; optional split at a jagged tear line.
const tearPoints = (() => {
  const pts = [];
  const yT = CFG.tearFromTop * TEX_H;
  for (let x = 0, i = 0; x <= TEX_W + 12; x += 12, i++) {
    pts.push([x, yT + (rand(i * 3.7) - 0.5) * 9 + (i % 2 ? 3 : -3)]);
  }
  return pts;
})();

function serratedOutline(ctx) {
  const tooth = 14, depth = 9;
  ctx.beginPath();
  ctx.moveTo(0, depth);
  for (let x = 0; x <= TEX_W; x += tooth) {
    ctx.lineTo(x + tooth / 2, 0);
    ctx.lineTo(x + tooth, depth);
  }
  ctx.lineTo(TEX_W, TEX_H - depth);
  for (let x = TEX_W; x >= 0; x -= tooth) {
    ctx.lineTo(x - tooth / 2, TEX_H);
    ctx.lineTo(x - tooth, TEX_H - depth);
  }
  ctx.closePath();
}

function buildMask(part) {
  const [c, ctx] = makeCanvas(TEX_W / 2, TEX_H / 2);
  ctx.scale(0.5, 0.5);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  ctx.save();
  serratedOutline(ctx);
  ctx.clip();
  if (part !== 'full') {
    ctx.beginPath();
    if (part === 'top') {
      ctx.moveTo(0, 0);
      tearPoints.forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.lineTo(TEX_W, 0);
    } else {
      ctx.moveTo(0, TEX_H);
      tearPoints.forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.lineTo(TEX_W, TEX_H);
    }
    ctx.closePath();
    ctx.clip();
  }
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  ctx.restore();
  return canvasTex(c, false);
}

// ---------------------------------------------------------------- card textures
function buildCardMask() {
  const [c, ctx] = makeCanvas(256, Math.round(256 * CFG.cardAspect));
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#fff'; roundRect(ctx, 1, 1, c.width - 2, c.height - 2, 12); ctx.fill();
  return canvasTex(c, false);
}

function glowTexture(stops, size = 128) {
  const [c, ctx] = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  return canvasTex(c);
}
function starTexture() {
  const s = 128;
  const [c, ctx] = makeCanvas(s, s);
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.15, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.moveTo(s / 2, 2); ctx.quadraticCurveTo(s / 2, s / 2, s - 2, s / 2); ctx.quadraticCurveTo(s / 2, s / 2, s / 2, s - 2);
  ctx.quadraticCurveTo(s / 2, s / 2, 2, s / 2); ctx.quadraticCurveTo(s / 2, s / 2, s / 2, 2); ctx.fill();
  return canvasTex(c);
}
function rayTexture() {
  const [c, ctx] = makeCanvas(64, 256);
  const gx = ctx.createLinearGradient(0, 0, 64, 0);
  gx.addColorStop(0, 'rgba(255,255,255,0)'); gx.addColorStop(0.5, 'rgba(255,255,255,1)'); gx.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gx; ctx.fillRect(0, 0, 64, 256);
  ctx.globalCompositeOperation = 'destination-in';
  const gy = ctx.createLinearGradient(0, 256, 0, 0);
  gy.addColorStop(0, 'rgba(0,0,0,1)'); gy.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gy; ctx.fillRect(0, 0, 64, 256);
  return canvasTex(c);
}

function sunburstTexture(rainbow) {
  const s = 512;
  const [c, ctx] = makeCanvas(s, s);
  ctx.translate(s / 2, s / 2);
  const rays = 28;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const w = 0.05 + rand(i * 1.7) * 0.07;
    const len = s * (0.36 + rand(i * 3.1) * 0.14);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, len);
    const col = rainbow ? `hsla(${(i / rays) * 360}, 100%, 72%,` : `hsla(${42 + rand(i) * 14}, 100%, ${70 + rand(i + 2) * 15}%,`;
    g.addColorStop(0, col + '0.95)'); g.addColorStop(0.35, col + '0.5)'); g.addColorStop(1, col + '0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, len, a - w, a + w);
    ctx.closePath();
    ctx.fill();
  }
  return canvasTex(c);
}

// ---------------------------------------------------------------- build the pack
const packGroup = new THREE.Group();     // idle motion, intro spin, drag tilt
const bodyGroup = new THREE.Group();     // everything below the tear
const topPivot = new THREE.Group();      // the strip that flies away
packGroup.add(bodyGroup, topPivot);
scene.add(packGroup);

const masks = {};
const mats = {};
let cardBackTex, cardMaskTex;

function packMaterials(front, back, mask) {
  const outer = (map) => new THREE.MeshPhysicalMaterial({
    map, alphaMap: mask, alphaTest: 0.5,
    metalness: 0.12, roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.22,
    iridescence: 0.22, iridescenceIOR: 1.5, envMapIntensity: 0.55,
  });
  const inner = () => new THREE.MeshStandardMaterial({
    color: 0xc7ccd2, metalness: 0.9, roughness: 0.32, alphaMap: mask, alphaTest: 0.5, side: THREE.BackSide,
  });
  return { front: outer(front), back: outer(back), innerF: inner(), innerB: inner() };
}

function addFaces(group, geo, m, offsetY = 0, lining = true) {
  const f = new THREE.Mesh(geo, m.front);
  const b = new THREE.Mesh(geo, m.back); b.rotation.y = Math.PI;
  const meshes = [f, b];
  if (lining) {
    const fi = new THREE.Mesh(geo, m.innerF);
    const bi = new THREE.Mesh(geo, m.innerB); bi.rotation.y = Math.PI;
    meshes.push(fi, bi);
  }
  meshes.forEach((mesh) => { mesh.position.y = offsetY; group.add(mesh); });
}

// Glowing tear line (hint dashes before the swipe, lit trail during it)
let tearLine;
function buildTearLine() {
  const seg = 80, half = 0.06;
  const pos = [], uvs = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    const [x, , z] = packDeform(u, TEAR_V);
    pos.push(x, TEAR_Y - half, z + 0.015, x, TEAR_Y + half, z + 0.015);
    uvs.push(u, -1, u, 1);
    if (i < seg) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uProg: { value: 0 }, uHint: { value: 0 }, uTime: { value: 0 }, uFade: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec2 vUv; uniform float uProg, uHint, uTime, uFade;
      void main(){
        float across = vUv.y;
        float core = smoothstep(0.32, 0.12, abs(across));          // crisp centre line
        float glow = exp(-pow(across * 2.2, 2.0));
        float lit = step(vUv.x, uProg);
        float head = exp(-pow((vUv.x - uProg) * 16.0, 2.0)) * step(0.001, uProg) * step(uProg, 0.999);
        vec3 pink = vec3(1.0, 0.18, 0.45);
        // lit trail: hot pink glow with a white core
        vec3 trailCol = mix(pink, vec3(1.0), core);
        float trailA = lit * max(core, glow * 0.55) + head * max(core, glow);
        // hint: white dashes on a soft dark shadow so they read on bright art
        float dashOn = step(0.45, fract(vUv.x * 20.0 - uTime * 1.2)) * (1.0 - lit) * uHint;
        float pulse = 0.7 + 0.3 * sin(uTime * 4.0);
        float dashA = dashOn * core * pulse;
        float shadowA = (1.0 - lit) * uHint * glow * 0.28;
        vec3 col = trailA > 0.001 ? trailCol : mix(vec3(0.0), vec3(1.0), dashA / max(dashA + shadowA, 1e-4));
        float a = max(trailA, max(dashA, shadowA));
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * uFade);
      }`,
  });
  tearLine = new THREE.Mesh(g, m);
  tearLine.renderOrder = 5;
  bodyGroup.add(tearLine);
}

// Effects: flare, rays, sparkles
const fx = {};
function buildEffects() {
  const flareTex = glowTexture([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,240,250,0.65)'], [1, 'rgba(255,200,230,0)']]);
  fx.flare = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: flareTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }),
  );
  fx.flare.renderOrder = 6;
  fx.head = new THREE.Sprite(new THREE.SpriteMaterial({ map: flareTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  fx.head.scale.set(0.5, 0.5, 1);
  fx.head.renderOrder = 7;
  bodyGroup.add(fx.flare, fx.head);

  // Light rays from the opening
  fx.rays = new THREE.Group();
  const rayTex = rayTexture();
  const rayGeo = new THREE.PlaneGeometry(1, 1); rayGeo.translate(0, 0.5, 0);
  const hues = [0.95, 0.08, 0.15, 0.33, 0.5, 0.58, 0.7, 0.8, 0.02, 0.45, 0.62];
  hues.forEach((h, i) => {
    const m = new THREE.MeshBasicMaterial({
      map: rayTex, transparent: true, depthWrite: false,
      color: new THREE.Color().setHSL(h, 0.95, 0.6), opacity: 0,
    });
    const r = new THREE.Mesh(rayGeo, m);
    const t = i / (hues.length - 1);
    r.rotation.z = lerp(0.62, -0.62, t) + (rand(i) - 0.5) * 0.12;
    r.position.x = lerp(-PACK_W * 0.42, PACK_W * 0.42, t);
    r.userData = { w: 0.18 + rand(i + 9) * 0.3, h: 2.2 + rand(i + 4) * 1.6, phase: rand(i + 2) * 6 };
    fx.rays.add(r);
  });
  fx.rays.position.set(0, TEAR_Y - 0.02, 0);
  fx.rays.renderOrder = 4;
  bodyGroup.add(fx.rays);

  // Sparkle particles
  const N = 420;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(N), 1));
  g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(N), 1));
  g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  fx.sparks = new THREE.Points(g, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,          // normal blending: additive vanishes on a white sky
    uniforms: { uTex: { value: starTexture() }, uScale: { value: 1 } },
    vertexShader: `
      attribute float aAlpha; attribute float aSize; attribute vec3 aColor;
      varying float vA; varying vec3 vC; uniform float uScale;
      void main(){ vA = aAlpha; vC = aColor; vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `
      uniform sampler2D uTex; varying float vA; varying vec3 vC;
      void main(){ vec4 t = texture2D(uTex, gl_PointCoord); float core = smoothstep(0.55, 1.0, t.a); gl_FragColor = vec4(mix(vC, vec3(1.0), core * 0.6), t.a * vA); }`,
  }));
  fx.sparks.frustumCulled = false;
  fx.sparks.renderOrder = 8;
  fx.sparkData = Array.from({ length: N }, () => ({ life: 0, max: 1, v: new THREE.Vector3() }));
  scene.add(fx.sparks);

  // Aura behind the special (last) card: soft glow + two counter-rotating sunbursts
  fx.aura = new THREE.Group();
  const additive = (map, color = 0xffffff) => new THREE.MeshBasicMaterial({
    map, color, transparent: true, depthWrite: false, opacity: 0,
  });
  const quad = new THREE.PlaneGeometry(1, 1);
  fx.auraGlow = new THREE.Mesh(quad, additive(glowTexture([[0, 'rgba(255,236,170,1)'], [0.3, 'rgba(255,200,90,0.6)'], [0.65, 'rgba(255,160,60,0.18)'], [1, 'rgba(255,150,60,0)']], 256)));
  fx.auraBurstGold = new THREE.Mesh(quad, additive(sunburstTexture(false)));
  fx.auraBurstRainbow = new THREE.Mesh(quad, additive(sunburstTexture(true)));
  fx.aura.add(fx.auraBurstRainbow, fx.auraBurstGold, fx.auraGlow);
  fx.aura.renderOrder = 1;
  fx.aura.children.forEach((m) => { m.renderOrder = 1; });
  fx.aura.userData = { level: 0, target: 0, rainbow: 0 };
  scene.add(fx.aura);
}

// Aura level eases toward its target; position follows the current card.
function updateAura(dt, t) {
  const a = fx.aura.userData;
  a.level = lerp(a.level, a.target, 1 - Math.pow(0.02, dt));
  const c = cards[current];
  if (c && c.group.visible) {
    c.group.getWorldPosition(fx.aura.position);
    fx.aura.position.z -= 0.25;
  }
  const L = a.level;
  const pulse = 0.85 + 0.15 * Math.sin(t * 3.2);
  const size = CARD_H * (1.6 + 1.4 * L);
  fx.auraGlow.scale.setScalar(size * 1.2 * pulse);
  fx.auraGlow.material.opacity = 0.9 * L;
  fx.auraBurstGold.scale.setScalar(size * 1.55);
  fx.auraBurstGold.rotation.z = t * 0.25;
  fx.auraBurstGold.material.opacity = 0.75 * L * pulse;
  fx.auraBurstRainbow.scale.setScalar(size * 1.8);
  fx.auraBurstRainbow.rotation.z = -t * 0.16;
  fx.auraBurstRainbow.material.opacity = 0.6 * L * a.rainbow;
  fx.aura.visible = L > 0.01;

  // continuous sparkles around the edge of a revealed special card
  if (L > 0.5 && c && c.revealed) {
    a.emit = (a.emit || 0) + dt * 55 * L * (reduceMotion ? 0.2 : 1);
    while (a.emit >= 1) {
      a.emit -= 1;
      const side = Math.random();
      const half = new THREE.Vector2(CARD_W * 0.62, CARD_H * 0.6);
      const p = side < 0.5
        ? new THREE.Vector3((Math.random() * 2 - 1) * half.x, (side < 0.25 ? 1 : -1) * half.y, 0)
        : new THREE.Vector3((side < 0.75 ? 1 : -1) * half.x, (Math.random() * 2 - 1) * half.y, 0);
      p.add(fx.aura.position).setZ(fx.aura.position.z + (Math.random() < 0.25 ? 0.6 : 0.1));
      const out = new THREE.Vector3(p.x - fx.aura.position.x, p.y - fx.aura.position.y, 0).normalize().multiplyScalar(0.5 + Math.random() * 0.6);
      spawnSpark(p, out.setY(out.y + 0.4), a.rainbow > 0.5 ? Math.random() : 0.1 + Math.random() * 0.06, 50 + Math.random() * 60, 0.7 + Math.random() * 0.8);
    }
  }
}

const _col = new THREE.Color();
function spawnSpark(p, v, hue, size, life) {
  const i = fx.sparkData.findIndex((s) => s.life <= 0);
  if (i < 0) return;
  const s = fx.sparkData[i];
  s.max = s.life = life;
  s.v.copy(v);
  const g = fx.sparks.geometry.attributes;
  g.position.setXYZ(i, p.x, p.y, p.z);
  _col.setHSL(hue, 0.95, 0.6);
  g.aColor.setXYZ(i, _col.r, _col.g, _col.b);
  g.aSize.setX(i, size);
  g.aColor.needsUpdate = g.aSize.needsUpdate = true;
}
function burstSparks(origin, count, { spread = 1.2, up = 3, hueBase = null, size = 60, width = PACK_W * 0.8 } = {}) {
  if (reduceMotion) count = Math.ceil(count / 4);
  const p = new THREE.Vector3(), v = new THREE.Vector3();
  for (let n = 0; n < count; n++) {
    p.set(origin.x + (Math.random() - 0.5) * width, origin.y, origin.z + 0.2);
    v.set((Math.random() - 0.5) * spread * 2, up * (0.4 + Math.random()), (Math.random() - 0.2) * 1.2);
    spawnSpark(p, v, hueBase === null ? Math.random() : hueBase + (Math.random() - 0.5) * 0.06, size * (0.4 + Math.random()), 0.8 + Math.random() * 1.1);
  }
}
// Radial burst from a point (used for the special card)
function radialBurst(center, count, { speed = 3, size = 80, rainbow = true } = {}) {
  if (reduceMotion) count = Math.ceil(count / 5);
  const p = new THREE.Vector3(), v = new THREE.Vector3();
  for (let n = 0; n < count; n++) {
    const a = Math.random() * Math.PI * 2, sp = speed * (0.35 + Math.random());
    p.copy(center).add(new THREE.Vector3(Math.cos(a) * CARD_W * 0.45, Math.sin(a) * CARD_H * 0.45, -0.35));
    v.set(Math.cos(a) * sp, Math.sin(a) * sp + 0.6, -0.2 + Math.random() * 0.3);
    spawnSpark(p, v, rainbow ? Math.random() : 0.1 + Math.random() * 0.06, size * (0.5 + Math.random()), 1 + Math.random() * 1.2);
  }
}
function updateSparks(dt) {
  const pos = fx.sparks.geometry.attributes.position;
  const al = fx.sparks.geometry.attributes.aAlpha;
  let alive = false;
  for (let i = 0; i < fx.sparkData.length; i++) if (fx.sparkData[i].life > 0) { alive = true; break; }
  if (!alive && !fx.sparks.visible) return;
  fx.sparks.visible = alive;
  if (!alive) return;
  fx.sparks.material.uniforms.uScale.value = renderer.getPixelRatio() * window.innerHeight / 150;
  fx.sparkData.forEach((s, i) => {
    if (s.life <= 0) { al.setX(i, 0); return; }
    s.life -= dt;
    s.v.y -= 1.2 * dt;
    s.v.multiplyScalar(1 - 0.9 * dt);
    pos.setXYZ(i, pos.getX(i) + s.v.x * dt, pos.getY(i) + s.v.y * dt, pos.getZ(i) + s.v.z * dt);
    const k = s.life / s.max;
    al.setX(i, Math.max(0, Math.sin(k * Math.PI)) * (0.6 + 0.4 * Math.sin(s.life * 30)));
  });
  pos.needsUpdate = al.needsUpdate = true;
}

// ---------------------------------------------------------------- cards
let cardList = [];
const cardStack = new THREE.Group();
let cards = [];          // { data, group, front, holo }
const cardGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);
const texLoader = new THREE.TextureLoader();

const holoMaterial = (mask, strength) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uMask: { value: mask }, uTilt: { value: new THREE.Vector2() }, uTime: { value: 0 }, uStrength: { value: strength } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    varying vec2 vUv; uniform sampler2D uMask; uniform vec2 uTilt; uniform float uTime, uStrength;
    vec3 hsv(float h){ return clamp(abs(mod(h*6.0+vec3(0.,4.,2.),6.)-3.)-1., 0., 1.); }
    void main(){
      float m = texture2D(uMask, vUv).g;
      float h = vUv.x * 1.2 + vUv.y * 0.7 + uTilt.x * 1.4 + uTilt.y * 0.9 + uTime * 0.04;
      float bands = 0.5 + 0.5 * sin((vUv.x + vUv.y) * 20.0 + uTilt.x * 9.0 - uTilt.y * 6.0);
      float sweep = exp(-pow((vUv.x - vUv.y * 0.5 - 0.25 - uTilt.x * 1.2) * 4.0, 2.0));
      vec3 c = hsv(fract(h)) * (0.35 * bands + 0.9 * sweep);
      gl_FragColor = vec4(c, m * uStrength);
    }`,
});

function pickPack() {
  const by = (r) => cardList.filter((c) => c.rarity === r);
  const pool = { C: by('C'), U: by('U'), R: by('R'), RR: by('RR') };
  const pick = (arr, taken) => {
    const free = arr.filter((c) => !taken.includes(c));
    return free[Math.floor(Math.random() * free.length)];
  };
  const taken = [];
  // ?rare=RR or ?rare=R forces the last slot (for testing the special reveal)
  const tokens = location.hash.slice(1).toLowerCase().split('-');
  const forced = new URLSearchParams(location.search).get('rare') || (tokens.includes('rr') ? 'RR' : tokens.includes('r') ? 'R' : null);
  const last = forced === 'RR' || forced === 'R' ? forced : Math.random() < 0.28 ? 'RR' : 'R';
  const slots = ['C', 'C', 'C', Math.random() < 0.75 ? 'U' : 'C', last];
  slots.forEach((r) => taken.push(pick(pool[r].length ? pool[r] : cardList, taken)));
  return taken.slice(0, CFG.cardsPerPack);
}

function buildCards(list) {
  cards.forEach((c) => { cardStack.remove(c.group); c.front.material.map?.dispose(); });
  cards = list.map((data, i) => {
    const group = new THREE.Group();
    const map = texLoader.load(CFG.cardImage(data.name));
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const front = new THREE.Mesh(cardGeo, new THREE.MeshStandardMaterial({
      map, alphaMap: cardMaskTex, alphaTest: 0.5, roughness: 0.62, metalness: 0, envMapIntensity: 0.35,
    }));
    const back = new THREE.Mesh(cardGeo, new THREE.MeshPhysicalMaterial({
      map: cardBackTex, alphaMap: cardMaskTex, alphaTest: 0.5, roughness: 0.45, clearcoat: 0.5, metalness: 0.1, iridescence: 0.15, envMapIntensity: 0.5,
    }));
    back.rotation.y = Math.PI;
    back.position.z = -0.002;
    group.add(front, back);
    let holo = null;
    if (data.rarity === 'RR' || data.rarity === 'R') {
      holo = new THREE.Mesh(cardGeo, holoMaterial(cardMaskTex, data.rarity === 'RR' ? 0.6 : 0.35));
      holo.position.z = 0.003;
      holo.renderOrder = 3;
      group.add(holo);
    }
    group.rotation.y = Math.PI;                       // back faces the viewer
    group.position.z = (list.length - 1 - i) * 0.014;  // first card on top
    cardStack.add(group);
    return { data, group, front, holo, revealed: false };
  });
}

// ---------------------------------------------------------------- state
let state = 'loading';
let tearProgress = 0;
let current = 0;
let shake = 0;
const pointer = { x: 0, y: 0, down: false, startX: 0, startY: 0, swiping: false, cardTilt: new THREE.Vector2() };

let hintKey = '';
let hintVars = {};
function setHint(key, vars = {}) { hintKey = key; hintVars = vars; ui.hint.textContent = key ? t(key, vars) : ''; }

function resetScene() {
  tweens.length = 0;
  document.body.classList.remove('is-rare', 'is-uncommon');
  ui.results.hidden = true;
  ui.counter.hidden = true;
  ui.skip.hidden = true;
  ui.open.hidden = true;
  removeSlab();

  bodyGroup.position.set(0, 0, 0);
  bodyGroup.visible = true;
  [mats.body.front, mats.body.back, mats.body.innerF, mats.body.innerB].forEach((m) => { m.alphaMap = masks.full; m.needsUpdate = true; });
  topPivot.visible = false;
  topPivot.position.set(0, (TEAR_Y + PACK_H / 2) / 2, 0);
  topPivot.rotation.set(0, 0, 0);
  Object.values(mats.top).forEach((m) => { m.opacity = 1; m.transparent = false; });

  tearProgress = 0;
  tearLine.material.uniforms.uProg.value = 0;
  tearLine.material.uniforms.uHint.value = 0;
  tearLine.material.uniforms.uFade.value = 1;
  fx.flare.material.opacity = 0;
  fx.head.material.opacity = 0;
  fx.rays.children.forEach((r) => { r.material.opacity = 0; r.scale.set(0.001, 0.001, 1); });

  camFocus.y = 0; camFocus.zoom = 1;
  fingerHint.on = false;
  fx.aura.userData.target = 0; fx.aura.userData.level = 0; fx.aura.userData.rainbow = 0;

  packGroup.add(cardStack);
  cardStack.position.set(0, -0.45, 0);
  cardStack.rotation.set(0, 0, 0);
  cardStack.scale.setScalar(1);
  buildCards(pickPack());
  current = 0;

  packGroup.position.set(0, 0, 0);
  packGroup.rotation.set(0, 0, 0);
  enterSelect(!resetScene.ran);
  resetScene.ran = true;
}

// ---------------------------------------------------------------- pack carousel
// A ring of packs the user spins freely; the front one can be opened.
const CAROUSEL = { count: 8, radius: 4.0, tilt: 0.16 };
// pull back further on tall screens so the neighbouring packs stay in view
const carouselZoom = () => (camera.aspect < 0.8 ? 1.75 : 1.2);
const STEP = (Math.PI * 2) / CAROUSEL.count;
const carousel = new THREE.Group();
scene.add(carousel);
const ring = { rot: 0, vel: 0, target: null, dragging: false, lastX: 0, lastT: 0, moved: 0, packs: [] };
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const FLOOR_Y = -PACK_H / 2 - 0.14;   // in carousel space
const stage = { reflections: [], reflMats: [], floor: null, opacity: 1 };

// Mirrored copy material: unlit, fades out with distance below the floor.
function reflectionMaterial(map, mask) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,   // three.js already flips the winding for negative scale
    uniforms: {
      map: { value: map }, alphaMap: { value: mask }, uFloor: { value: FLOOR_Y }, uFade: { value: 2.2 }, uOpacity: { value: 0.42 },
      uStageInv: { value: new THREE.Matrix4() },   // world -> carousel space, updated each frame
    },
    vertexShader: `
      varying vec2 vUv; varying float vDepth; uniform float uFloor; uniform mat4 uStageInv;
      void main(){
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vDepth = uFloor - (uStageInv * world).y;      // how far below the floor this point is
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      varying vec2 vUv; varying float vDepth; uniform sampler2D map, alphaMap; uniform float uFade, uOpacity;
      void main(){
        float m = texture2D(alphaMap, vUv).g;
        float fade = 1.0 - smoothstep(0.0, uFade, vDepth);
        float a = m * fade * uOpacity;
        if (a < 0.004) discard;
        gl_FragColor = vec4(texture2D(map, vUv).rgb, a);
        #include <colorspace_fragment>
      }`,
  });
}

function buildCarousel(front, back) {
  const geo = makePackGeometry(28, 56);          // lighter mesh: 8 of these are on screen
  const reflGeo = makePackGeometry(12, 24);      // reflections are blurry and faint: coarser still
  // standard (not physical) material: no clearcoat/iridescence passes for the idle ring
  const std = (map) => new THREE.MeshStandardMaterial({ map, alphaMap: masks.full, alphaTest: 0.5, metalness: 0.15, roughness: 0.36, envMapIntensity: 0.8 });
  const m = { front: std(front), back: std(back) };
  const rf = reflectionMaterial(front, masks.full), rb = reflectionMaterial(back, masks.full);
  stage.reflMats.push(rf, rb);
  for (let i = 0; i < CAROUSEL.count; i++) {
    const g = new THREE.Group();
    addFaces(g, geo, m, 0, false);
    g.userData.index = i;
    carousel.add(g);
    ring.packs.push(g);
    // reflection: same faces, mirrored across the floor
    const r = new THREE.Group();
    const f = new THREE.Mesh(reflGeo, rf);
    const b = new THREE.Mesh(reflGeo, rb); b.rotation.y = Math.PI;
    r.add(f, b);
    r.renderOrder = -1;
    f.renderOrder = b.renderOrder = -1;
    carousel.add(r);
    stage.reflections.push(r);
  }
  // soft glossy floor: a bright pool that sits over the reflections
  const [c, ctx] = makeCanvas(256, 256);
  const gr = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,255,255,0.5)');
  gr.addColorStop(0.45, 'rgba(240,247,255,0.32)');
  gr.addColorStop(1, 'rgba(230,240,250,0)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, 256, 256);
  stage.floor = new THREE.Mesh(
    new THREE.PlaneGeometry(CAROUSEL.radius * 4.5, CAROUSEL.radius * 3.2),
    new THREE.MeshBasicMaterial({ map: canvasTex(c), transparent: true, depthWrite: false, toneMapped: false }),
  );
  stage.floor.rotation.x = -Math.PI / 2;
  stage.floor.position.set(0, FLOOR_Y, -CAROUSEL.radius * 0.6);
  stage.floor.renderOrder = 0;
  carousel.add(stage.floor);
}
function setStageOpacity(o) {
  stage.opacity = o;
  stage.reflMats.forEach((m) => { m.uniforms.uOpacity.value = 0.42 * o; });
  stage.floor.material.opacity = o;
}
function frontIndex() {
  const n = CAROUSEL.count;
  return ((Math.round(-ring.rot / STEP) % n) + n) % n;
}
function layoutCarousel(t) {
  const R = CAROUSEL.radius;
  ring.packs.forEach((g, i) => {
    const th = i * STEP + ring.rot;
    const front = Math.max(0, Math.cos(th));
    const lift = Math.pow(front, 6);
    g.position.set(Math.sin(th) * R, Math.sin(t * 1.3 + i * 1.7) * 0.05 + lift * 0.12, Math.cos(th) * R - R);
    g.rotation.set(0, th, Math.sin(t * 0.9 + i) * 0.015);
    g.scale.setScalar(0.8 + 0.2 * lift);
    const r = stage.reflections[i];
    r.visible = g.visible;
    r.position.set(g.position.x, 2 * FLOOR_Y - g.position.y, g.position.z);
    r.rotation.set(0, th, -g.rotation.z);
    r.scale.set(g.scale.x, -g.scale.y, g.scale.z);
  });
}
function rotateToIndex(i) {
  const goal = -i * STEP;
  ring.vel = 0;
  ring.target = ring.rot + wrapAngle(goal - ring.rot);
}
function updateCarousel(dt, t) {
  if (state === 'select' && !ring.dragging) {
    if (ring.target === null && Math.abs(ring.vel) > 0.35) {
      ring.rot += ring.vel * dt;                       // coast
      ring.vel *= Math.pow(0.08, dt);
    } else {
      if (ring.target === null) { ring.target = Math.round(ring.rot / STEP) * STEP; ring.vel = 0; }
      ring.rot = lerp(ring.rot, ring.target, 1 - Math.pow(0.002, dt));   // ease into place
      if (Math.abs(ring.rot - ring.target) < 0.0005) ring.rot = ring.target;
    }
  }
  if (carousel.visible) {
    layoutCarousel(t);
    carousel.updateMatrixWorld();
    const inv = stage.reflMats[0].uniforms.uStageInv.value.copy(carousel.matrixWorld).invert();
    stage.reflMats[1].uniforms.uStageInv.value.copy(inv);
  }
}

const raycaster = new THREE.Raycaster();
function pickCarouselPack(clientX, clientY) {
  const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(ring.packs.filter((g) => g.visible), true)[0];
  let o = hit && hit.object;
  while (o && o.userData.index === undefined) o = o.parent;
  return o ? o.userData.index : -1;
}

async function enterSelect(first = false) {
  state = 'selectIntro';
  packGroup.visible = false;
  carousel.visible = true;
  carousel.position.set(0, 0, 0);
  ring.packs.forEach((g) => { g.visible = true; });
  ring.vel = 0; ring.target = null;
  ui.tear.hidden = true;
  setHint('');
  const r0 = Math.round(ring.rot / STEP) * STEP;
  carousel.rotation.x = CAROUSEL.tilt;     // tip the ring toward the viewer so the back row shows
  zoomTo(0.35, carouselZoom(), 0.9);
  // the ring sweeps in and rises into place
  await tween(first ? 1.6 : 1.1, (p) => {
    const e = ease.outCubic(p);
    ring.rot = lerp(r0 - Math.PI * 0.75, r0, e);
    carousel.position.y = lerp(-3.5, 0, e);
    setStageOpacity(e);
  });
  ring.rot = r0;
  state = 'select';
  ui.open.hidden = false;
  setHint('hint.select');
}

async function choosePack(i) {
  if (state !== 'select') return;
  state = 'chosen';
  ui.open.hidden = true;
  setHint('');
  const g = ring.packs[i];
  const startRot = wrapAngle(i * STEP + ring.rot);
  const p0 = new THREE.Vector3();
  g.getWorldPosition(p0);
  const s0 = g.scale.x;
  g.visible = false;

  packGroup.visible = true;
  packGroup.position.copy(p0);
  packGroup.rotation.set(0, startRot, 0);
  packGroup.scale.setScalar(s0);

  // the other packs drop away while the chosen one comes forward with a full spin
  const c0 = carousel.position.clone();
  tween(0.9, (p) => {
    carousel.position.set(c0.x, c0.y - 7 * ease.inCubic(p), c0.z - 1.5 * p);
    setStageOpacity(1 - Math.min(1, p * 2.5));
  }, { done: () => { carousel.visible = false; } });
  zoomTo(0, 1, 1.0);
  await tween(1.3, (p) => {
    const e = ease.inOut(p);
    packGroup.position.set(lerp(p0.x, 0, e), lerp(p0.y, 0, e), lerp(p0.z, 0, e) + Math.sin(p * Math.PI) * 1.2);
    packGroup.rotation.y = lerp(startRot, Math.PI * 2, e);
    packGroup.scale.setScalar(lerp(s0, 1, e));
  });
  packGroup.rotation.y = 0;
  packGroup.scale.setScalar(1);
  // glide the camera in on the seal so the tear line fills the width
  await zoomTo(tearFocusY(), tearZoom(), 0.9);
  becomeReady();
}

function becomeReady() {
  state = 'ready';
  tearLine.material.uniforms.uHint.value = 1;
  fingerHint.on = true; fingerHint.t = 0;
  setHint('hint.swipe');
  ui.tear.hidden = false;
}

// ---------------------------------------------------------------- camera zoom
// Distance factor that frames the tear line edge-to-edge with a little margin.
function tearZoom() {
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const d = Math.max((PACK_W * 1.3) / (2 * t * camera.aspect), (PACK_H * 0.5) / (2 * t));
  return clamp(d / camBase.z, 0.35, 1);
}
function zoomTo(y, zoom, dur, easing = ease.inOut) {
  const y0 = camFocus.y, z0 = camFocus.zoom;
  return tween(dur, (p) => { camFocus.y = lerp(y0, y, p); camFocus.zoom = lerp(z0, zoom, p); }, { easing });
}
function tearFocusY() {
  // keep the tear line in the upper-middle of the screen, with some pack art below it
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const visibleH = 2 * t * camBase.z * tearZoom();
  return TEAR_Y - visibleH * 0.14;
}

// ---------------------------------------------------------------- swipe hint (finger)
const fingerHint = { on: false, t: 0 };
function updateFinger(dt) {
  const el = ui.finger;
  if (!fingerHint.on || state !== 'ready') { el.style.opacity = '0'; return; }
  fingerHint.t = (fingerHint.t + dt / 1.9) % 1;
  const ph = fingerHint.t;
  const span = tearScreenSpan();
  // press (0-.15) -> slide along the line (.15-.75) -> lift & fade (.75-1)
  const move = ease.inOut(clamp((ph - 0.15) / 0.6, 0, 1));
  const x = lerp(span.l.x + 14, span.r.x - 14, move);
  const y = lerp(span.l.y, span.r.y, move);
  const press = ph < 0.15 ? ph / 0.15 : ph > 0.75 ? 1 - (ph - 0.75) / 0.25 : 1;
  el.style.opacity = String(clamp(ph < 0.08 ? ph / 0.08 : ph > 0.85 ? 1 - (ph - 0.85) / 0.15 : 1, 0, 1));
  el.style.transform = `translate(${x}px, ${y}px) scale(${1 - 0.12 * press})`;
  el.style.setProperty('--trail', `${Math.max(0, x - lerp(span.l.x + 14, span.r.x - 14, 0))}px`);
  el.classList.toggle('is-pressed', press > 0.5);
}

// ---------------------------------------------------------------- tearing
const _v = new THREE.Vector3();
function toScreen(x, y, z, obj) {
  _v.set(x, y, z).applyMatrix4(obj.matrixWorld).project(camera);
  return { x: (_v.x * 0.5 + 0.5) * window.innerWidth, y: (-_v.y * 0.5 + 0.5) * window.innerHeight };
}
function tearScreenSpan() {
  packGroup.updateMatrixWorld(true);
  const l = toScreen(-PACK_W / 2, TEAR_Y, 0.05, bodyGroup);
  const r = toScreen(PACK_W / 2, TEAR_Y, 0.05, bodyGroup);
  return { l, r, y: (l.y + r.y) / 2 };
}
function updateTearFx() {
  const p = tearProgress;
  tearLine.material.uniforms.uProg.value = p;
  const [x, , z] = packDeform(clamp(p, 0, 1), TEAR_V);
  fx.head.position.set(x, TEAR_Y, z + 0.05);
  fx.head.material.opacity = p > 0 && p < 1 ? 1 : 0;
}

async function completeTear() {
  if (state !== 'swiping' && state !== 'ready') return;
  state = 'tearing';
  fingerHint.on = false;
  ui.tear.hidden = true;
  setHint('');
  tearLine.material.uniforms.uHint.value = 0;
  const from = tearProgress;
  await tween(0.16 * (1 - from) + 0.04, (p) => { tearProgress = lerp(from, 1, p); updateTearFx(); });

  // white flash band
  fx.flare.position.set(0, TEAR_Y, 0.25);
  tween(0.55, (p) => {
    fx.flare.material.opacity = 0.85 * (p < 0.25 ? p / 0.25 : 1 - (p - 0.25) / 0.75);
    fx.flare.scale.set(PACK_W * lerp(1.1, 2.4, ease.outCubic(p)), lerp(0.3, 0.1, p), 1);
  });
  shake = reduceMotion ? 0 : 0.06;

  // pull the camera back out so the burst and the cards have room
  zoomTo(0, 1, 1.15, ease.outCubic);

  // split the pack
  [mats.body.front, mats.body.back, mats.body.innerF, mats.body.innerB].forEach((m) => { m.alphaMap = masks.body; m.needsUpdate = true; });
  topPivot.visible = true;
  tween(0.3, (p) => { tearLine.material.uniforms.uFade.value = 1 - p; });

  // top strip flies off up and to the right, tumbling
  const vel = new THREE.Vector3(1.6, 4.4, 1.2), spin = new THREE.Vector3(2.2, -1.4, -5.5);
  const p0 = topPivot.position.clone();
  Object.values(mats.top).forEach((m) => { m.transparent = true; });
  tween(1.3, (p, raw) => {
    const t = raw * 1.3;
    topPivot.position.set(p0.x + vel.x * t, p0.y + vel.y * t - 3.2 * t * t, p0.z + vel.z * t);
    topPivot.rotation.set(spin.x * t, spin.y * t, spin.z * t);
    Object.values(mats.top).forEach((m) => { m.opacity = 1 - smooth(0.55, 1, raw); });
  }, { done: () => { topPivot.visible = false; } });

  // rainbow rays + sparkles out of the opening
  const rayDur = 1.6;
  tween(rayDur, (p, raw) => {
    const t = raw * rayDur;
    fx.rays.children.forEach((r) => {
      const d = r.userData;
      const grow = ease.outCubic(clamp(raw * 2.4, 0, 1));
      r.scale.set(d.w * (0.6 + grow * 0.6), d.h * grow, 1);
      r.material.opacity = (raw < 0.15 ? raw / 0.15 : 1 - smooth(0.45, 1, raw)) * (0.3 + 0.12 * Math.sin(t * 7 + d.phase)) * (reduceMotion ? 0.5 : 1);
    });
  }, { delay: 0.08 });
  packGroup.updateMatrixWorld(true);
  const opening = new THREE.Vector3(0, TEAR_Y, 0).applyMatrix4(bodyGroup.matrixWorld);
  burstSparks(opening, 70, { spread: 1.4, up: 3.4, size: 70 });
  setTimeout(() => burstSparks(opening, 40, { spread: 1, up: 2.6, size: 50 }), 250);

  await wait(0.85);
  await riseCards();
}

async function riseCards() {
  state = 'rising';
  scene.attach(cardStack);  // keep world transform, leave the pack behind
  const s0 = cardStack.position.clone();
  const r0 = cardStack.rotation.clone();
  const target = new THREE.Vector3(0, 0.15, 0.6);
  const b0 = bodyGroup.position.y;
  // cards slide up out of the opening while the pack drops away
  await tween(1.1, (p) => {
    const up = ease.inOut(p);
    cardStack.position.set(lerp(s0.x, target.x, up), lerp(s0.y, target.y + 0.35, up) - 0.35 * ease.inCubic(Math.max(0, p - 0.6) / 0.4), lerp(s0.z, target.z, up));
    cardStack.rotation.set(lerp(r0.x, 0, up), lerp(r0.y, 0, up), lerp(r0.z, 0, up));
    cardStack.scale.setScalar(lerp(1, 1.12, up));
    bodyGroup.position.y = b0 - 7 * ease.inCubic(clamp((p - 0.25) / 0.75, 0, 1));
  });
  bodyGroup.visible = false;
  state = 'reveal';
  ui.counter.hidden = false;
  ui.skip.hidden = false;
  updateCounter();
  prepareCard();
}

const isSpecial = (i) => i === cards.length - 1;
function prepareCard() {
  if (isSpecial(current)) {
    fx.aura.userData.target = 0.3;           // faint glow leaks from behind the face-down card
    fx.aura.userData.rainbow = cards[current].data.rarity === 'RR' ? 0.6 : 0;
    setHint('hint.special');
  } else {
    fx.aura.userData.target = 0;
    setHint('hint.tapReveal');
  }
}

// ---------------------------------------------------------------- reveal
function updateCounter() { ui.counter.textContent = `${Math.min(current + 1, cards.length)} / ${cards.length}`; }

let busy = false;
async function advance(dir = -1) {
  if (state !== 'reveal' || busy) return;
  const c = cards[current];
  if (!c) return;
  busy = true;
  if (!c.revealed) {
    c.revealed = true;
    const g = c.group;
    const z0 = g.position.z;
    const special = isSpecial(current);
    if (special) {
      // build-up: the card trembles and the glow swells before it turns
      fx.aura.userData.target = 0.6;
      await tween(0.7, (p) => {
        g.rotation.z = Math.sin(p * 60) * 0.03 * p;
        g.position.z = z0 + p * 0.25;
      });
    }
    const zStart = g.position.z;
    await tween(special ? 0.8 : 0.65, (p) => {
      g.rotation.y = lerp(Math.PI, 0, ease.inOut(p));
      g.position.z = zStart + Math.sin(p * Math.PI) * 0.7 + p * 0.3;
      g.rotation.z = Math.sin(p * Math.PI) * 0.08 * dir;
    });
    celebrate(c.data.rarity, g, special);
    setHint(current < cards.length - 1 ? 'hint.next' : 'hint.caseIt');
  } else if (isSpecial(current) && !c.slabbed) {
    await slabCard(c);
  } else if (c.slabbed) {
    busy = false;
    showResults();
    return;
  } else {
    document.body.classList.remove('is-rare', 'is-uncommon');
    fx.aura.userData.target = 0;
    const g = c.group;
    const x0 = g.position.x, z0 = g.position.z, rz = g.rotation.z;
    await tween(0.42, (p) => {
      g.position.x = x0 + dir * 4.2 * ease.inCubic(p);
      g.position.z = z0 + p * 0.4;
      g.rotation.z = rz + dir * 0.5 * p;
    });
    g.visible = false;
    current++;
    if (current >= cards.length) { busy = false; showResults(); return; }
    updateCounter();
    prepareCard();
  }
  busy = false;
}

// ---------------------------------------------------------------- casing the special card
let slabKit = null;
let activeSlab = null;
let vaultUI = null;
let viewerOpen = false;

function toast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.add('is-on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => ui.toast.classList.remove('is-on'), 2600);
}

async function slabCard(c) {
  c.slabbed = true;
  setHint('');
  const g = c.group;
  // settle the card face-on before the case closes around it
  const r0 = g.rotation.clone();
  await tween(0.35, (p) => { g.rotation.set(lerp(r0.x, 0, p), lerp(r0.y, 0, p), lerp(r0.z, 0, p)); }, { easing: ease.outCubic });
  const world = new THREE.Vector3();
  g.getWorldPosition(world);
  const s = cardStack.scale.x;
  const slab = slabKit.build(c.vaultEntry);
  slab.scale.setScalar(s);
  slab.position.set(world.x, world.y - slab.userData.cardY * s, world.z);
  scene.add(slab);
  activeSlab = slab;
  fx.aura.userData.target = 0.25;

  const { shell, labelF, labelB, pocket, insertF, insertB } = slab.userData.parts;
  const labelBase = labelF.position.y;
  const labels = [labelF, labelB, pocket];
  const inserts = [insertF, insertB];
  // shell slides in from the viewer, label drops into its pocket, glitter insert grows behind the card
  await tween(0.95, (p) => {
    const e = ease.outCubic(p);
    shell.position.z = lerp(0.6, 0, e);
    shell.scale.setScalar(lerp(1.06, 1, e));
    shell.visible = p > 0.02;
    labels.forEach((m) => { m.position.y = labelBase + 1.8 * (1 - ease.outBack(clamp(p * 1.15, 0, 1))); });
    inserts.forEach((m) => { m.scale.setScalar(Math.max(0.001, ease.outCubic(clamp(p * 1.4, 0, 1)))); });
  });
  slab.attach(g);                     // the card now rides inside the case
  // glide the whole case to the centre and size it to fit the screen
  {
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = camera.position.z - 0.6;
    const visH = 2 * t * dist, visW = visH * camera.aspect;
    const fit = Math.min(s, (visH * 0.66) / slabKit.dims.H, (visW * 0.8) / slabKit.dims.W);
    const p0 = slab.position.clone(), s0 = slab.scale.x;
    const target = new THREE.Vector3(0, camFocus.y + 0.1, 0.6);
    await tween(0.6, (p) => {
      slab.position.lerpVectors(p0, target, p);
      slab.scale.setScalar(lerp(s0, fit, p));
    }, { easing: ease.inOut });
  }
  shake = reduceMotion ? 0 : 0.03;
  const centre = new THREE.Vector3();
  slab.getWorldPosition(centre);
  radialBurst(centre, 60, { speed: 2.2, size: 55, rainbow: c.data.rarity === 'RR' });
  // one slow turn to show the back, like a turntable
  await tween(reduceMotion ? 0.3 : 2.6, (p) => { slab.rotation.y = Math.PI * 2 * ease.inOut(p); });
  slab.rotation.y = 0;
  toast(t('toast.cased'));
  ui.vaultBtn.classList.remove('is-bump'); void ui.vaultBtn.offsetWidth; ui.vaultBtn.classList.add('is-bump');
  setHint('hint.seeAll');
}

function removeSlab() {
  if (activeSlab) { scene.remove(activeSlab); activeSlab = null; }
}

function celebrate(rarity, group, special = false) {
  const world = new THREE.Vector3();
  group.getWorldPosition(world);
  if (special) {
    const c = cards[current];
    c.vaultEntry = addToVault(c.data);           // saved the moment it is revealed (skip-safe)
    vaultUI.updateCount();
    const rr = rarity === 'RR';
    document.body.classList.add(rr ? 'is-rare' : 'is-uncommon');
    fx.aura.userData.target = rr ? 1 : 0.85;
    fx.aura.userData.rainbow = rr ? 1 : 0.35;
    radialBurst(world, rr ? 170 : 120, { speed: rr ? 4.2 : 3.4, size: 80, rainbow: rr });
    setTimeout(() => radialBurst(world, 70, { speed: 2.4, size: 60, rainbow: rr }), 220);
    shake = reduceMotion ? 0 : 0.08;
    if (!reduceMotion) {
      ui.flash.classList.remove('is-on');
      void ui.flash.offsetWidth;            // restart the CSS animation
      ui.flash.classList.add('is-on');
    }
    return;
  }
  world.y -= CARD_H * 0.55;
  if (rarity === 'RR') {
    document.body.classList.add('is-rare');
    burstSparks(world, 90, { spread: 1.8, up: 3.6, size: 80 });
    shake = reduceMotion ? 0 : 0.04;
  } else if (rarity === 'R') {
    document.body.classList.add('is-uncommon');
    burstSparks(world, 45, { spread: 1.4, up: 3, hueBase: 0.12, size: 60 });
  } else {
    burstSparks(world, 12, { spread: 1, up: 2, hueBase: 0.42, size: 40 });
  }
}

function showResults() {
  state = 'results';
  fx.aura.userData.target = 0;
  removeSlab();
  ui.skip.hidden = true;
  ui.counter.hidden = true;
  setHint('');
  cards.forEach((c) => { c.group.visible = false; });
  ui.grid.innerHTML = '';
  cards.forEach((c, i) => {
    const li = document.createElement('li');
    if (c.data.rarity === 'RR' || c.data.rarity === 'R') li.classList.add('is-rare');
    li.style.animationDelay = `${i * 0.07}s`;
    li.innerHTML = `<img src="${CFG.cardImage(c.data.name)}" alt="${t('card.alt', { n: c.data.number, r: c.data.rarity })}" loading="lazy">
      <span class="po-rarity po-rarity--${c.data.rarity}">No.${String(c.data.number).padStart(3, '0')} · ${c.data.rarity}</span>
      ${c.vaultEntry ? `<span class="po-in-vault">${t('results.inVault')}</span>` : ''}`;
    ui.grid.appendChild(li);
  });
  ui.results.hidden = false;
  ui.again.focus();
}

// ---------------------------------------------------------------- input
function onDown(e) {
  pointer.down = true;
  pointer.startX = e.clientX; pointer.startY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('is-dragging');
  if (state === 'select') {
    ring.dragging = true;
    ring.target = null;
    ring.vel = 0;
    ring.lastX = e.clientX;
    ring.lastT = performance.now();
    ring.moved = 0;
    return;
  }
  if (state === 'ready') {
    const span = tearScreenSpan();
    const band = Math.max(46, window.innerHeight * 0.07);
    const left = Math.min(span.l.x, span.r.x), right = Math.max(span.l.x, span.r.x);
    if (Math.abs(e.clientY - span.y) < band && e.clientX < left + (right - left) * 0.45) {
      state = 'swiping';
      pointer.swiping = true;
      tearLine.material.uniforms.uHint.value = 0;
      onMove(e);
    } else {
      setHint('hint.swipeStart');
    }
  }
}
function onMove(e) {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  if (state === 'select' && ring.dragging) {
    const now = performance.now();
    const dx = e.clientX - ring.lastX;
    const k = (Math.PI * 2) / (window.innerWidth * 2.4);   // a full-width drag turns the ring ~150°
    ring.rot += dx * k;
    const dtS = Math.max((now - ring.lastT) / 1000, 1 / 240);
    ring.vel = clamp(lerp(ring.vel, (dx * k) / dtS, 0.5), -9, 9);
    ring.moved += Math.abs(dx);
    ring.lastX = e.clientX;
    ring.lastT = now;
    return;
  }
  if (state === 'swiping' && pointer.swiping) {
    const span = tearScreenSpan();
    const p = (e.clientX - span.l.x) / (span.r.x - span.l.x);
    tearProgress = Math.max(tearProgress, clamp(p, 0, 1));
    updateTearFx();
    if (tearProgress >= CFG.completeAt) { pointer.swiping = false; completeTear(); }
  }
}
function onUp(e) {
  canvas.classList.remove('is-dragging');
  if (!pointer.down) return;
  pointer.down = false;
  if (state === 'select') {
    ring.dragging = false;
    if (performance.now() - ring.lastT > 80) ring.vel = 0;   // held still before release: no fling
    if (ring.moved < 8) {
      const i = pickCarouselPack(e.clientX, e.clientY);
      if (i === frontIndex() && Math.abs(wrapAngle(i * STEP + ring.rot)) < STEP * 0.3) choosePack(i);
      else if (i >= 0) rotateToIndex(i);
    }
    return;
  }
  if (state === 'swiping') {
    pointer.swiping = false;
    state = 'ready';
    const from = tearProgress;
    tween(0.3, (p) => { tearProgress = lerp(from, 0, ease.outCubic(p)); updateTearFx(); },
      { done: () => { if (state === 'ready') tearLine.material.uniforms.uHint.value = 1; } });
    setHint('hint.keepGoing');
    return;
  }
  if (state === 'reveal') {
    const dx = e.clientX - pointer.startX;
    advance(Math.abs(dx) > 40 ? Math.sign(dx) : -1);
  }
}
canvas.addEventListener('pointerdown', onDown);
canvas.addEventListener('pointermove', onMove);
canvas.addEventListener('pointerup', onUp);
canvas.addEventListener('pointercancel', onUp);
window.addEventListener('pointermove', (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
});
window.addEventListener('keydown', (e) => {
  if (!['Enter', ' ', 'ArrowRight', 'ArrowLeft'].includes(e.key)) return;
  if (viewerOpen) return;
  if (document.activeElement && document.activeElement.tagName === 'BUTTON') return;
  e.preventDefault();
  if (state === 'select') {
    if (e.key === 'ArrowLeft') rotateToIndex((frontIndex() + 1) % CAROUSEL.count);
    else if (e.key === 'ArrowRight') rotateToIndex((frontIndex() + CAROUSEL.count - 1) % CAROUSEL.count);
    else choosePack(frontIndex());
  } else if (state === 'ready') completeTear();
  else if (state === 'reveal') advance(e.key === 'ArrowRight' ? 1 : -1);
});
ui.tear.addEventListener('click', () => completeTear());
ui.open.addEventListener('click', () => choosePack(frontIndex()));
ui.skip.addEventListener('click', () => { if (state === 'reveal' && !busy) showResults(); });
ui.again.addEventListener('click', () => resetScene());

// ---------------------------------------------------------------- language
applyStatic();
document.querySelectorAll('[data-lang-link]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.langLink)));
onLangChange(() => {
  setHint(hintKey, hintVars);
  if (state === 'results') showResults();          // re-render labels in the new language
  vaultUI?.refresh();
});

// ---------------------------------------------------------------- loop
const _tiltTarget = new THREE.Vector2();
const timer = new THREE.Timer();
function frame(now) {
  timer.update(now);
  const dt = Math.min(timer.getDelta(), 1 / 20);
  const t = timer.getElapsed();
  runTweens(dt);

  if (state === 'ready' || state === 'swiping') {
    const k = state === 'swiping' ? 0 : 1;   // hold still while swiping
    // zoomed in on the seal: keep the tilt subtle so the line stays easy to follow
    packGroup.rotation.y = lerp(packGroup.rotation.y, pointer.x * 0.12 * k + Math.sin(t * 0.7) * 0.03 * k, 0.08);
    packGroup.rotation.x = lerp(packGroup.rotation.x, pointer.y * 0.06 * k, 0.08);
    packGroup.position.y = lerp(packGroup.position.y, Math.sin(t * 1.4) * 0.05 * k, 0.1);
  }
  if (state === 'reveal') {
    pointer.cardTilt.lerp(_tiltTarget.set(pointer.x, pointer.y), 0.1);
    const c = cards[current];
    if (c && c.revealed && !busy && !c.slabbed) {
      c.group.rotation.y = pointer.cardTilt.x * 0.28;
      c.group.rotation.x = pointer.cardTilt.y * 0.2;
    }
    if (activeSlab && !busy) {
      activeSlab.rotation.y = lerp(activeSlab.rotation.y, pointer.cardTilt.x * 0.45 + Math.sin(t * 0.6) * 0.18, 0.08);
      activeSlab.rotation.x = lerp(activeSlab.rotation.x, pointer.cardTilt.y * 0.15, 0.08);
    }
    cardStack.position.y = 0.15 + Math.sin(t * 1.3) * 0.03;
    if (c && !c.revealed && !busy && isSpecial(current) && !reduceMotion) {
      c.group.rotation.z = Math.sin(t * 40) * 0.012 * (Math.sin(t * 2.2) > 0.6 ? 1 : 0);
    }
  }
  cards.forEach((c) => {
    if (c.holo) {
      c.holo.material.uniforms.uTime.value = t;
      c.holo.material.uniforms.uTilt.value.set(c.group.rotation.y + pointer.cardTilt.x * 0.3, c.group.rotation.x + pointer.cardTilt.y * 0.3);
    }
  });
  tearLine.material.uniforms.uTime.value = t;
  tearLine.visible = state === 'ready' || state === 'swiping' || state === 'tearing';
  fx.rays.visible = state === 'tearing' || state === 'rising';
  updateCarousel(dt, t);
  updateAura(dt, t);
  updateSparks(dt);
  updateFinger(dt);

  camera.position.set(camBase.x, camFocus.y, camBase.z * camFocus.zoom);
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    shake = Math.max(0, shake - dt * 0.15);
  }
  camera.lookAt(0, camFocus.y, 0);
  if (!viewerOpen) renderer.render(scene, camera);   // the vault has its own renderer
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot
(async function boot() {
  try {
    const [img, backImg, list] = await Promise.all([
      loadImage(CFG.packFront),
      loadImage(CFG.cardBack),
      fetch(CFG.cardList).then((r) => { if (!r.ok) throw new Error('cardlist ' + r.status); return r.json(); }),
    ]);
    cardList = list;
    const front = buildFrontTexture(img);
    const back = buildBackTexture(img);
    masks.full = buildMask('full');
    masks.body = buildMask('body');
    masks.top = buildMask('top');
    cardBackTex = canvasTex((() => { const [c, ctx] = makeCanvas(backImg.width, backImg.height); ctx.drawImage(backImg, 0, 0); return c; })());
    cardMaskTex = buildCardMask();

    const geo = makePackGeometry(40, 80);
    mats.body = packMaterials(front, back, masks.full);
    mats.top = packMaterials(front, back, masks.top);
    addFaces(bodyGroup, geo, mats.body);
    const pivotY = (TEAR_Y + PACK_H / 2) / 2;
    addFaces(topPivot, geo, mats.top, -pivotY);

    slabKit = createSlabKit({ cardW: CARD_W, cardH: CARD_H, cardBackTex, cardMaskTex, anisotropy: renderer.capabilities.getMaxAnisotropy() });
    vaultUI = createVaultUI({
      els: {
        button: ui.vaultBtn, count: $('po-vault-count'), panel: $('po-vault'), grid: $('po-vault-grid'),
        empty: $('po-vault-empty'), summary: $('po-vault-summary'), close: $('po-vault-close'),
        viewer: $('po-viewer'), viewerCanvas: $('po-viewer-canvas'), caption: $('po-viewer-caption'), viewerClose: $('po-viewer-close'),
      },
      cardImage: CFG.cardImage,
      getSlabKit: () => slabKit,
      onOpenChange: (open) => { viewerOpen = open; },
    });
    ui.resultsVault.addEventListener('click', () => vaultUI.open());
    buildCarousel(front, back);
    buildTearLine();
    buildEffects();
    resetScene();
    requestAnimationFrame(frame);
    // test hook (read-only)
    window.__packOpening = { state: () => state, tearSpan: tearScreenSpan, frontIndex, busy: () => busy, current: () => current, info: () => ({ ...renderer.info.render }) };
  } catch (err) {
    console.error(err);
    setHint('hint.error', { m: err.message });
  }
})();
