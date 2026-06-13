// Space-floater sky for `map.space` maps: a huge inward-facing starfield
// sphere (procedural canvas — thousands of stars, a violet nebula on one side
// and a fiery orange one opposite, per the Q3TA/QL Vortex Portal levelshots)
// plus a big Mars-like planet hanging clearly BELOW deck level so it appears
// when players look over the edges. The whole group follows the camera each
// frame so the sky reads as infinitely far away; nothing here writes depth,
// so all world geometry always draws over it.

import * as THREE from 'three';

export interface SkyboxView {
  group: THREE.Group;
  /** Re-center the sky on the camera (call once per frame). */
  update(cameraPos: THREE.Vector3): void;
  dispose(): void;
}

/** Deterministic PRNG — the sky looks identical every load. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas2d(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('QuakeLite renderer: 2D canvas context unavailable');
  return { canvas, ctx };
}

/** Cluster of soft additive blobs — one nebula. Kept near the equator so the
 *  equirect mapping doesn't smear it at the poles. */
function paintNebula(
  ctx: CanvasRenderingContext2D,
  rand: () => number,
  cx: number,
  cy: number,
  spread: number,
  colors: [number, number, number][],
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 22; i++) {
    const x = cx + (rand() - 0.5) * spread * 2;
    const y = cy + (rand() - 0.5) * spread * 0.9;
    const r = spread * (0.18 + rand() * 0.4);
    const [cr, cg, cb] = colors[i % colors.length]!;
    const a = 0.035 + rand() * 0.055;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, `rgba(${cr},${cg},${cb},${a.toFixed(3)})`);
    g.addColorStop(0.55, `rgba(${cr},${cg},${cb},${(a * 0.45).toFixed(3)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
}

function starfieldTexture(): THREE.CanvasTexture {
  const w = 2048;
  const h = 1024;
  const { canvas, ctx } = canvas2d(w, h);
  const rand = mulberry32(20260612);

  ctx.fillStyle = '#020309';
  ctx.fillRect(0, 0, w, h);

  // Violet nebula on one side, fiery orange opposite (mpteam6 levelshot /
  // q3ta_vp_hq1 palette; QL keeps them faint behind the black starfield).
  paintNebula(ctx, rand, w * 0.26, h * 0.42, 300, [
    [120, 70, 190],
    [160, 100, 220],
    [70, 38, 130],
  ]);
  paintNebula(ctx, rand, w * 0.78, h * 0.56, 320, [
    [255, 120, 40],
    [205, 64, 20],
    [130, 36, 12],
  ]);

  // Draw a star; mirror it across the wrap seam when it lands near an edge.
  const dot = (x: number, y: number, size: number, style: string) => {
    ctx.fillStyle = style;
    ctx.fillRect(x, y, size, size);
    if (x < 4) ctx.fillRect(x + w, y, size, size);
    if (x > w - 4) ctx.fillRect(x - w, y, size, size);
  };

  // Thousands of dim 1-2px stars with subtle blue/warm tints.
  for (let i = 0; i < 2600; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const a = 0.22 + rand() * 0.6;
    const tint = rand();
    const col =
      tint < 0.72
        ? `rgba(255,255,255,${a.toFixed(3)})`
        : tint < 0.88
          ? `rgba(190,212,255,${a.toFixed(3)})`
          : `rgba(255,224,190,${a.toFixed(3)})`;
    dot(x, y, rand() < 0.85 ? 1 : 2, col);
  }

  // A few bright stars with soft halos and cross glints.
  for (let i = 0; i < 16; i++) {
    const x = 30 + rand() * (w - 60);
    const y = 30 + rand() * (h - 60);
    const r = 4 + rand() * 6;
    const g = ctx.createRadialGradient(x, y, 0.5, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.35, 'rgba(225,235,255,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    const glint = r * (1.8 + rand() * 1.4);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(x - glint, y - 0.5, glint * 2, 1);
    ctx.fillRect(x - 0.5, y - glint, 1, glint * 2);
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.fillRect(x - 1, y - 1, 2, 2);
  }

  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Mars-like planet painted as a camera-facing disc: mottled orange/brown,
 *  limb darkening, a shadowed terminator and a faint atmosphere rim. */
function planetTexture(): THREE.CanvasTexture {
  const s = 512;
  const { canvas, ctx } = canvas2d(s, s);
  const rand = mulberry32(40404);
  const c = s / 2;
  const R = s * 0.42;

  // Faint atmosphere halo outside the limb.
  const atmo = ctx.createRadialGradient(c, c, R * 0.96, c, c, R * 1.14);
  atmo.addColorStop(0, 'rgba(255,150,80,0.30)');
  atmo.addColorStop(0.55, 'rgba(255,120,60,0.10)');
  atmo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = atmo;
  ctx.fillRect(0, 0, s, s);

  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, R, 0, Math.PI * 2);
  ctx.clip();

  // Base disc shading.
  const base = ctx.createRadialGradient(c - R * 0.25, c - R * 0.2, R * 0.1, c, c, R);
  base.addColorStop(0, 'rgb(214,128,66)');
  base.addColorStop(0.7, 'rgb(176,92,42)');
  base.addColorStop(1, 'rgb(126,58,26)');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, s, s);

  // Mottled terrain: translucent elliptical blotches, dark browns and pale
  // oranges, plus a few wide latitude band streaks.
  for (let i = 0; i < 420; i++) {
    const x = c + (rand() - 0.5) * 2 * R;
    const y = c + (rand() - 0.5) * 2 * R;
    const rx = 4 + rand() * 34;
    const ry = rx * (0.35 + rand() * 0.5);
    const dark = rand() < 0.55;
    ctx.fillStyle = dark
      ? `rgba(96,44,20,${(0.04 + rand() * 0.07).toFixed(3)})`
      : `rgba(238,164,96,${(0.04 + rand() * 0.06).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 7; i++) {
    const y = c - R + rand() * 2 * R;
    ctx.fillStyle = `rgba(140,70,34,${(0.05 + rand() * 0.05).toFixed(3)})`;
    ctx.fillRect(0, y, s, 6 + rand() * 18);
  }

  // Terminator: night creeping in from one side.
  const term = ctx.createLinearGradient(c + R * 0.2, 0, c + R, 0);
  term.addColorStop(0, 'rgba(8,4,2,0)');
  term.addColorStop(1, 'rgba(8,4,2,0.85)');
  ctx.fillStyle = term;
  ctx.fillRect(0, 0, s, s);

  // Limb darkening all around.
  const limb = ctx.createRadialGradient(c, c, R * 0.7, c, c, R);
  limb.addColorStop(0, 'rgba(0,0,0,0)');
  limb.addColorStop(1, 'rgba(10,4,2,0.55)');
  ctx.fillStyle = limb;
  ctx.fillRect(0, 0, s, s);

  ctx.restore();

  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

export function createSkybox(): SkyboxView {
  const group = new THREE.Group();
  group.name = 'skybox';
  group.matrixAutoUpdate = true;

  const starTex = starfieldTexture();
  const skyGeo = new THREE.SphereGeometry(9000, 48, 32);
  const skyMat = new THREE.MeshBasicMaterial({
    map: starTex,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -10; // first among opaques; writes no depth
  sky.frustumCulled = false;
  group.add(sky);

  // The planet hangs below deck level (QL levelshot: looking over any edge
  // shows it). It follows the camera with the sky, so it never parallaxes
  // closer; depth testing still lets the decks occlude it correctly.
  const planetTex = planetTexture();
  const planetMat = new THREE.SpriteMaterial({
    map: planetTex,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const planet = new THREE.Sprite(planetMat);
  planet.scale.set(5200, 5200, 1);
  planet.position.set(2400, -4800, -2600);
  planet.renderOrder = -5; // before all gameplay transparents/halos
  group.add(planet);

  return {
    group,
    update(cameraPos: THREE.Vector3): void {
      group.position.copy(cameraPos);
    },
    dispose(): void {
      skyGeo.dispose();
      skyMat.dispose();
      starTex.dispose();
      planetMat.dispose();
      planetTex.dispose();
    },
  };
}
