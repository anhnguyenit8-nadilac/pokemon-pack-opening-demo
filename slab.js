// Display case ("slab") for special cards: clear acrylic shell, glitter insert,
// an info label on the front and a code label on the back. Original "M6 VAULT" design.
import * as THREE from 'three';

const RARITY_NAME = { RR: 'DOUBLE RARE', R: 'RARE', U: 'UNCOMMON', C: 'COMMON' };

function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
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
function barcode(ctx, x, y, w, h, rnd) {
  let bx = x;
  while (bx < x + w) {
    const bw = 1 + Math.floor(rnd() * 4);
    if (rnd() > 0.35) ctx.fillRect(bx, y, bw, h);
    bx += bw + 1;
  }
}

export function serialFor(entry) {
  return String(entry.serial).padStart(8, '0');
}

export function createSlabKit({ cardW, cardH, cardBackTex, cardMaskTex, anisotropy = 4 }) {
  const W = cardW + 0.34;
  const labelH = 0.58;
  const winH = cardH + 0.24;
  const pad = 0.07;
  const H = pad + winH + 0.1 + labelH + pad;
  const D = 0.22;
  const cardY = -H / 2 + pad + winH / 2;           // card centre, relative to slab centre
  const labelY = H / 2 - pad - labelH / 2;

  const tex = (c, srgb = true) => {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = anisotropy;
    return t;
  };

  // --- shared: acrylic shell
  const shape = new THREE.Shape();
  {
    const r = 0.09, x = -W / 2, y = -H / 2;
    shape.moveTo(x + r, y);
    shape.lineTo(x + W - r, y); shape.quadraticCurveTo(x + W, y, x + W, y + r);
    shape.lineTo(x + W, y + H - r); shape.quadraticCurveTo(x + W, y + H, x + W - r, y + H);
    shape.lineTo(x + r, y + H); shape.quadraticCurveTo(x, y + H, x, y + H - r);
    shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
  }
  const bevel = 0.025;
  const shellGeo = new THREE.ExtrudeGeometry(shape, {
    depth: D - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10,
  });
  shellGeo.center();
  const shellMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0.02, transmission: 1, thickness: 0.18, ior: 1.46,
    clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 0.5, iridescenceIOR: 1.35,
    iridescenceThicknessMinimum: 120, iridescenceThicknessMaximum: 700, envMapIntensity: 1.0, specularIntensity: 0.7,
  });

  // inner recess line: a slightly smaller frosted outline that reads as the inner well
  const wellGeo = new THREE.PlaneGeometry(W - 0.16, winH + 0.02);

  // --- shared: silver glitter insert
  const [gc, gx] = makeCanvas(512, 512);
  gx.fillStyle = '#9aa2ab'; gx.fillRect(0, 0, 512, 512);
  const rg = seeded(7);
  for (let i = 0; i < 9000; i++) {
    const hue = [0, 190, 45, 300, 160][Math.floor(rg() * 5)];
    gx.fillStyle = rg() < 0.55 ? `rgba(255,255,255,${0.3 + rg() * 0.7})` : `hsla(${hue},90%,75%,${0.3 + rg() * 0.6})`;
    const s = rg() < 0.9 ? 1 : 2;
    gx.fillRect(Math.floor(rg() * 512), Math.floor(rg() * 512), s, s);
  }
  const glitterTex = tex(gc);
  glitterTex.wrapS = glitterTex.wrapT = THREE.RepeatWrapping;
  glitterTex.repeat.set(3, 4);
  const insertMat = new THREE.MeshStandardMaterial({ map: glitterTex, metalness: 0.75, roughness: 0.38, envMapIntensity: 1.2 });

  const cardGeo = new THREE.PlaneGeometry(cardW, cardH);
  const labelGeo = new THREE.PlaneGeometry(W - 0.14, labelH);

  function labelTextures(entry) {
    const rnd = seeded(entry.serial);
    const rarity = entry.rarity;
    const num = `No.${String(entry.number).padStart(3, '0')}/076`;
    const serial = serialFor(entry);
    // front
    const [f, fx] = makeCanvas(1024, Math.round(1024 * labelH / (W - 0.14)));
    const fh = f.height;
    fx.fillStyle = '#f7f7f4'; fx.fillRect(0, 0, 1024, fh);
    fx.strokeStyle = '#0f8a5f'; fx.lineWidth = 12; roundRect(fx, 8, 8, 1008, fh - 16, 10); fx.stroke();
    fx.fillStyle = '#16211c';
    fx.font = '700 46px system-ui, sans-serif';
    fx.fillText('POKÉMON TCG · M6', 44, 74);
    fx.fillText('EMERALD STORM', 44, 128);
    fx.font = '600 36px system-ui, sans-serif';
    fx.fillText(`${num} · ${RARITY_NAME[rarity] || rarity}`, 44, 178);
    fx.textAlign = 'right';
    fx.font = '800 112px system-ui, sans-serif';
    fx.fillStyle = rarity === 'RR' ? '#c0392b' : '#b7791f';
    fx.fillText(rarity, 980, 140);
    fx.fillStyle = '#16211c';
    fx.font = '600 30px ui-monospace, monospace';
    fx.fillText(serial, 980, 190);
    fx.textAlign = 'left';
    barcode(fx, 44, fh - 56, 300, 30, rnd);
    fx.font = '800 28px system-ui, sans-serif';
    fx.fillStyle = '#0f8a5f';
    fx.fillText('M6 VAULT', 370, fh - 30);
    // back
    const [b, bx] = makeCanvas(1024, fh);
    const bg = bx.createLinearGradient(0, 0, 0, fh);
    bg.addColorStop(0, '#2b3036'); bg.addColorStop(1, '#15181c');
    bx.fillStyle = bg; bx.fillRect(0, 0, 1024, fh);
    // emblem
    bx.save();
    bx.translate(150, fh / 2);
    bx.strokeStyle = '#3ee0a0'; bx.lineWidth = 8;
    bx.beginPath(); bx.moveTo(0, -78); bx.lineTo(58, 0); bx.lineTo(0, 78); bx.lineTo(-58, 0); bx.closePath(); bx.stroke();
    bx.fillStyle = '#fff'; bx.font = '800 38px system-ui, sans-serif'; bx.textAlign = 'center'; bx.textBaseline = 'middle';
    bx.fillText('M6', 0, 2);
    bx.restore();
    bx.fillStyle = '#e9eef0'; bx.font = '800 54px system-ui, sans-serif';
    bx.fillText('VAULT', 250, fh / 2 - 6);
    bx.font = '500 26px system-ui, sans-serif'; bx.fillStyle = '#9fb0aa';
    bx.fillText('Emerald Storm collection', 250, fh / 2 + 36);
    // code grid (decorative, not a real code)
    const n = 21, cell = 8, qx = 1024 - 60 - n * cell, qy = (fh - n * cell) / 2;
    bx.fillStyle = '#fff'; bx.fillRect(qx - 10, qy - 10, n * cell + 20, n * cell + 20);
    bx.fillStyle = '#111';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const corner = (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
      const ring = corner && (x % (n - 7) === 0 || y % (n - 7) === 0 || x % (n - 7) === 6 || y % (n - 7) === 6 || ((x % (n - 7)) >= 2 && (x % (n - 7)) <= 4 && (y % (n - 7)) >= 2 && (y % (n - 7)) <= 4));
      if (corner ? ring : rnd() > 0.5) bx.fillRect(qx + x * cell, qy + y * cell, cell, cell);
    }
    bx.fillStyle = '#d7dde0';
    barcode(bx, 560, fh - 62, 210, 26, rnd);
    bx.font = '600 24px ui-monospace, monospace';
    bx.fillText(serial, 560, fh - 76);
    return { front: tex(f), back: tex(b) };
  }

  /**
   * Build a slab. Pass `cardMap` to include a card inside; omit it to slab an existing card later.
   * Returns a Group; userData.cardY is the card's centre relative to the slab centre.
   */
  function build(entry, cardMap = null) {
    const g = new THREE.Group();
    const { front, back } = labelTextures(entry);

    const insertF = new THREE.Mesh(wellGeo, insertMat);
    insertF.position.set(0, cardY, -0.012);
    const insertB = new THREE.Mesh(wellGeo, insertMat);
    insertB.rotation.y = Math.PI; insertB.position.set(0, cardY, 0.012);

    // labels are printed paper: unlit so the type stays crisp behind the acrylic
    const labelF = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({ map: front, toneMapped: false }));
    labelF.position.set(0, labelY, 0.02);
    const labelB = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({ map: back, toneMapped: false }));
    labelB.rotation.y = Math.PI; labelB.position.set(0, labelY, -0.02);
    // white label pocket behind the labels
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(W - 0.1, labelH + 0.04, 0.03), new THREE.MeshStandardMaterial({ color: 0xdfe3e6, roughness: 0.6 }));
    pocket.position.set(0, labelY, 0);

    const shell = new THREE.Mesh(shellGeo, shellMat);
    shell.renderOrder = 2;

    g.add(insertF, insertB, pocket, labelF, labelB, shell);

    if (cardMap) {
      const cf = new THREE.Mesh(cardGeo, new THREE.MeshStandardMaterial({ map: cardMap, alphaMap: cardMaskTex, alphaTest: 0.5, roughness: 0.5, envMapIntensity: 0.5 }));
      cf.position.set(0, cardY, 0.003);
      const cb = new THREE.Mesh(cardGeo, new THREE.MeshStandardMaterial({ map: cardBackTex, alphaMap: cardMaskTex, alphaTest: 0.5, roughness: 0.5, envMapIntensity: 0.5 }));
      cb.rotation.y = Math.PI; cb.position.set(0, cardY, -0.003);
      g.add(cf, cb);
    }
    g.userData = { cardY, parts: { shell, labelF, labelB, pocket, insertF, insertB } };
    return g;
  }

  return { build, dims: { W, H, D, cardY, labelY } };
}
