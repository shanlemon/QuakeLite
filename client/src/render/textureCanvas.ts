import * as THREE from 'three';

export type TextureCanvasContext = CanvasRenderingContext2D;
export type RgbTuple = [number, number, number];

/** Deterministic PRNG so procedural textures look identical every load. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: TextureCanvasContext } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('QuakeLite renderer: 2D canvas context unavailable');
  return { canvas, ctx };
}

export function finishTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function tex(
  size: number,
  seed: number,
  draw: (ctx: TextureCanvasContext, s: number, rand: () => number) => void,
): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(size);
  draw(ctx, size, mulberry32(seed));
  return finishTexture(canvas);
}

export function rgb(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}

export function rgba(r: number, g: number, b: number, a: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `rgba(${c(r)},${c(g)},${c(b)},${a.toFixed(3)})`;
}

/** Grainy noise: lots of tiny translucent rects in dark/light tones. */
export function speckle(
  ctx: TextureCanvasContext,
  rand: () => number,
  s: number,
  count: number,
  maxSize: number,
  alpha: number,
): void {
  for (let i = 0; i < count; i++) {
    const v = rand();
    const shade = v < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${shade},${shade},${shade},${(alpha * (0.4 + rand() * 0.6)).toFixed(3)})`;
    ctx.fillRect(rand() * s, rand() * s, 1 + rand() * maxSize, 1 + rand() * maxSize);
  }
}

/** Soft translucent stain blotches, used for wear on pale deck panels. */
export function stains(
  ctx: TextureCanvasContext,
  rand: () => number,
  s: number,
  count: number,
  alpha: number,
): void {
  for (let i = 0; i < count; i++) {
    const x = rand() * s;
    const y = rand() * s;
    const r = 14 + rand() * 42;
    const g = ctx.createRadialGradient(x, y, 2, x, y, r);
    const dark = rand() < 0.7;
    g.addColorStop(0, dark ? rgba(40, 34, 28, alpha) : rgba(255, 250, 240, alpha * 0.8));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

export function drawBrushedMetal(
  ctx: TextureCanvasContext,
  s: number,
  rand: () => number,
  base: RgbTuple,
): void {
  ctx.fillStyle = rgb(base[0], base[1], base[2]);
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 900; i++) {
    const shade = rand() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${shade},${shade},${shade},${(0.02 + rand() * 0.05).toFixed(3)})`;
    ctx.fillRect(rand() * s, rand() * s, 30 + rand() * (s * 0.6), 1);
  }
  speckle(ctx, rand, s, 700, 1.5, 0.04);
}

export function rivet(ctx: TextureCanvasContext, x: number, y: number, r: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.arc(x + 1, y + 1, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(200,210,225,0.55)';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.7, 0, Math.PI * 2);
  ctx.fill();
}
