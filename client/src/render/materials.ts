// Procedural canvas-texture materials for every MaterialName in MapDef,
// skinned to a Quake-style space-floater palette:
// pale warm-gray panel decks with dark grooves, white-blue marbled fascia,
// bright cyan neon trim bands, dark hull metal, and painted team emblems.
// No asset files: everything is drawn into <canvas> at startup. Textures are
// world-aligned by the world builder (1 repeat per 128 units), so a 256px
// canvas covers a 128x128-unit patch (2 px per unit). Emblem inlays are the
// exception — world.ts fits exactly one texture tile across each emblem brush.

import * as THREE from 'three';
import type { MaterialName } from '../../../shared/mapdef';
import {
  drawBrushedMetal,
  finishTexture,
  makeCanvas,
  rgb,
  rgba,
  rivet,
  speckle,
  stains,
  tex,
  type TextureCanvasContext,
} from './textureCanvas';

type Ctx = TextureCanvasContext;

export interface MaterialSet {
  byName: Record<MaterialName, THREE.Material>;
  dispose(): void;
}

// --- deck family (crop_ql_centerdeck: pale warm panels, dark grooves) -------

/** Shared pale-deck ground fill used by floor, stairs, ledge and emblems. */
const DECK_BASE: [number, number, number] = [173, 167, 156];

function deckGround(ctx: Ctx, s: number, rand: () => number): void {
  ctx.fillStyle = rgb(DECK_BASE[0], DECK_BASE[1], DECK_BASE[2]);
  ctx.fillRect(0, 0, s, s);
  // Large-scale value drift so big decks don't read flat.
  for (let i = 0; i < 5; i++) {
    const x = rand() * s;
    const y = rand() * s;
    const r = s * (0.25 + rand() * 0.35);
    const g = ctx.createRadialGradient(x, y, 4, x, y, r);
    g.addColorStop(0, rand() < 0.5 ? 'rgba(255,252,244,0.06)' : 'rgba(60,52,44,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }
  stains(ctx, rand, s, 6, 0.06);
  speckle(ctx, rand, s, 1400, 2, 0.035);
}

function floorTex(): THREE.CanvasTexture {
  // One large ~128u panel per tile with a dark groove border grid.
  return tex(256, 101, (ctx, s, rand) => {
    deckGround(ctx, s, rand);
    // Hairline inner seams quartering the panel.
    ctx.fillStyle = 'rgba(70,64,56,0.20)';
    ctx.fillRect(s / 2, 0, 1, s);
    ctx.fillRect(0, s / 2, s, 1);
    // Groove border — tiles into a 128u panel grid.
    ctx.fillStyle = '#46423c';
    ctx.fillRect(0, 0, s, 3);
    ctx.fillRect(0, s - 3, s, 3);
    ctx.fillRect(0, 0, 3, s);
    ctx.fillRect(s - 3, 0, 3, s);
    // Bevel: light inside top/left, shadow inside bottom/right.
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(3, 3, s - 6, 2);
    ctx.fillRect(3, 3, 2, s - 6);
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(3, s - 5, s - 6, 2);
    ctx.fillRect(s - 5, 3, 2, s - 6);
    rivet(ctx, 12, 12, 3);
    rivet(ctx, s - 12, 12, 3);
    rivet(ctx, 12, s - 12, 3);
    rivet(ctx, s - 12, s - 12, 3);
  });
}

function floorAltTex(): THREE.CanvasTexture {
  // Silver-blue diamond lattice grate (the big mid-deck grates in ql_vp_hq1).
  return tex(256, 202, (ctx, s, rand) => {
    ctx.fillStyle = rgb(52, 58, 70); // dark beneath the lattice
    ctx.fillRect(0, 0, s, s);
    const step = 32;
    const bar = (x0: number, y0: number, x1: number, y1: number, w: number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    };
    for (let d = -s; d <= s * 2; d += step) {
      // Drop shadow, body, sheen — both diagonal directions.
      bar(d, 0, d + s, s, 9, 'rgba(10,12,16,0.55)');
      bar(d, s, d + s, 0, 9, 'rgba(10,12,16,0.55)');
      bar(d, 0, d + s, s, 6, rgb(136, 146, 162));
      bar(d, s, d + s, 0, 6, rgb(136, 146, 162));
      bar(d - 1, 0, d + s - 1, s, 1.5, 'rgba(212,222,238,0.5)');
      bar(d - 1, s, d + s - 1, 0, 1.5, 'rgba(212,222,238,0.5)');
    }
    speckle(ctx, rand, s, 900, 1.6, 0.05);
  });
}

function stripeDarkTex(): THREE.CanvasTexture {
  // Black inset runway slots bordered by cyan-white pinstripes, matching the
  // long deck grooves visible in the Quake Live levelshot.
  return tex(256, 212, (ctx, s, rand) => {
    ctx.fillStyle = rgb(8, 12, 16);
    ctx.fillRect(0, 0, s, s);
    const g = ctx.createLinearGradient(0, 0, s, 0);
    g.addColorStop(0, 'rgba(80,220,255,0.55)');
    g.addColorStop(0.5, 'rgba(230,255,255,0.95)');
    g.addColorStop(1, 'rgba(80,220,255,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, 8);
    ctx.fillRect(0, s - 8, s, 8);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 9, s, 2);
    ctx.fillRect(0, s - 11, s, 2);
    for (let y = 24; y < s - 24; y += 24) {
      ctx.fillStyle = `rgba(70,95,115,${(0.18 + rand() * 0.12).toFixed(3)})`;
      ctx.fillRect(0, y, s, 2);
    }
    speckle(ctx, rand, s, 450, 1.2, 0.05);
  });
}

function titleMarkTex(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(512);
  ctx.clearRect(0, 0, 512, 512);
  ctx.save();
  ctx.translate(256, 256);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 58px Rajdhani, Segoe UI, Arial, sans-serif';
  ctx.fillStyle = 'rgba(68,44,16,0.55)';
  ctx.fillText('LONGEST YARD', 3, 3);
  ctx.fillStyle = '#f1a83a';
  ctx.fillText('LONGEST YARD', 0, 0);
  ctx.restore();
  const t = finishTexture(canvas);
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  return t;
}

function triangleTex(seed: number, main: [number, number, number]): THREE.CanvasTexture {
  return tex(256, seed, (ctx, s, rand) => {
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = rgba(main[0], main[1], main[2], 0.18);
    ctx.beginPath();
    ctx.moveTo(s * 0.50, s * 0.12);
    ctx.lineTo(s * 0.88, s * 0.82);
    ctx.lineTo(s * 0.12, s * 0.82);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgba(main[0], main[1], main[2], 0.92);
    ctx.lineWidth = 18;
    ctx.lineJoin = 'bevel';
    ctx.stroke();
    ctx.strokeStyle = 'rgba(245,255,255,0.78)';
    ctx.lineWidth = 6;
    ctx.stroke();
    speckle(ctx, rand, s, 350, 1.3, 0.04);
  });
}

function portalCircuitTex(): THREE.CanvasTexture {
  // Decorative gate-card art inspired by the QL portal station panels: dark
  // grid, copper mechanics, and a hot blue vortex core. It is procedural, not
  // copied from the original texture.
  return tex(512, 444, (ctx, s, rand) => {
    ctx.fillStyle = rgb(18, 20, 24);
    ctx.fillRect(0, 0, s, s);
    const cell = s / 8;
    ctx.strokeStyle = 'rgba(100,125,145,0.24)';
    ctx.lineWidth = 2;
    for (let i = 1; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cell, 0);
      ctx.lineTo(i * cell, s);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * cell);
      ctx.lineTo(s, i * cell);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(235,245,255,0.72)';
    ctx.lineWidth = 18;
    ctx.strokeRect(28, 28, s - 56, s - 56);
    ctx.strokeStyle = 'rgba(40,130,190,0.85)';
    ctx.lineWidth = 6;
    ctx.strokeRect(52, 52, s - 104, s - 104);

    ctx.save();
    ctx.translate(s / 2, s / 2);
    for (let i = 0; i < 14; i++) {
      ctx.rotate(Math.PI / 7);
      ctx.fillStyle = i % 2 === 0 ? 'rgba(176,100,48,0.72)' : 'rgba(120,150,170,0.58)';
      ctx.fillRect(-16, -s * 0.40, 32, s * 0.20);
    }
    for (const r of [130, 96, 58]) {
      ctx.strokeStyle = r === 58 ? 'rgba(160,230,255,0.92)' : 'rgba(120,150,170,0.58)';
      ctx.lineWidth = r === 58 ? 8 : 10;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    const g = ctx.createRadialGradient(0, 0, 8, 0, 0, 96);
    g.addColorStop(0, 'rgba(245,255,255,1)');
    g.addColorStop(0.34, 'rgba(80,220,255,0.86)');
    g.addColorStop(1, 'rgba(20,70,120,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 96, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    speckle(ctx, rand, s, 1000, 2, 0.055);
  });
}

function qlSignTex(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(512);
  const s = 512;
  ctx.fillStyle = rgb(28, 30, 34);
  ctx.fillRect(0, 0, s, s);
  const g = ctx.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, 'rgba(255,255,255,0.13)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.02)');
  g.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = 'rgba(235,240,245,0.86)';
  ctx.lineWidth = 18;
  ctx.strokeRect(32, 64, s - 64, s - 128);
  ctx.fillStyle = '#f3f3f0';
  ctx.fillRect(62, 196, 388, 120);
  ctx.fillStyle = '#bb241f';
  ctx.fillRect(72, 210, 368, 92);
  ctx.fillStyle = '#f7f7f2';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 82px Rajdhani, Segoe UI, Arial, sans-serif';
  ctx.fillText('QUAKE', 188, 256);
  ctx.fillText('LIVE', 348, 256);
  ctx.fillStyle = '#f7f7f2';
  ctx.beginPath();
  ctx.arc(264, 256, 74, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#bb241f';
  ctx.beginPath();
  ctx.arc(264, 256, 54, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#f7f7f2';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(264, 256, 30, -Math.PI * 0.2, Math.PI * 1.2);
  ctx.stroke();
  const t = finishTexture(canvas);
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  return t;
}

function wallTex(): THREE.CanvasTexture {
  // White-blue marbled fascia blocks with horizontal seams — the platform
  // sides in crop_ql_topcenter, very visible across the void.
  return tex(256, 303, (ctx, s, rand) => {
    ctx.fillStyle = rgb(197, 201, 210);
    ctx.fillRect(0, 0, s, s);
    // Marble veining: wandering translucent curves, blue-gray and white.
    for (let i = 0; i < 52; i++) {
      const blue = rand() < 0.62;
      ctx.strokeStyle = blue
        ? rgba(118, 132, 162, 0.05 + rand() * 0.1)
        : rgba(255, 255, 255, 0.06 + rand() * 0.1);
      ctx.lineWidth = 1 + rand() * 2.2;
      ctx.beginPath();
      let x = rand() * s;
      let y = rand() * s;
      ctx.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        const nx = x + (rand() - 0.5) * 76;
        const ny = y + (rand() - 0.5) * 76;
        ctx.quadraticCurveTo(x + (rand() - 0.5) * 44, y + (rand() - 0.5) * 44, nx, ny);
        x = nx;
        y = ny;
      }
      ctx.stroke();
    }
    speckle(ctx, rand, s, 800, 1.5, 0.03);
    // Block joints: horizontal seams every 64u, offset verticals per course.
    for (const y of [0, s / 2]) {
      ctx.fillStyle = 'rgba(38,44,56,0.85)';
      ctx.fillRect(0, y, s, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(0, y + 3, s, 1);
    }
    ctx.fillStyle = 'rgba(38,44,56,0.45)';
    ctx.fillRect(s * 0.25, 0, 2, s / 2);
    ctx.fillRect(s * 0.75, s / 2, 2, s / 2);
  });
}

function wallDarkTex(): THREE.CanvasTexture {
  // Darker steel panel (under-deck structure, housing backs).
  return tex(256, 404, (ctx, s, rand) => {
    drawBrushedMetal(ctx, s, rand, [64, 70, 82]);
    ctx.fillStyle = 'rgba(8,10,14,0.6)';
    const half = s / 2;
    for (let i = 0; i <= 2; i++) {
      ctx.fillRect(i * half - 1, 0, 3, s);
      ctx.fillRect(0, i * half - 1, s, 3);
    }
    ctx.fillStyle = 'rgba(220,228,242,0.10)';
    for (let gy = 0; gy < 2; gy++) ctx.fillRect(2, gy * half + 2, s - 4, 2);
    rivet(ctx, 14, 14, 4);
    rivet(ctx, s - 14, 14, 4);
    rivet(ctx, 14, s - 14, 4);
    rivet(ctx, s - 14, s - 14, 4);
  });
}

function ceilingTex(): THREE.CanvasTexture {
  // Dark hull metal — deck undersides seen from below decks.
  return tex(256, 505, (ctx, s, rand) => {
    drawBrushedMetal(ctx, s, rand, [40, 44, 54]);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 3;
    const step = s / 2;
    for (let i = 0; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * step, 0);
      ctx.lineTo(i * step, s);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * step);
      ctx.lineTo(s, i * step);
      ctx.stroke();
    }
    for (let gx = 0; gx < 2; gx++) {
      for (let gy = 0; gy < 2; gy++) {
        rivet(ctx, gx * step + 12, gy * step + 12, 4);
        rivet(ctx, gx * step + step - 12, gy * step + step - 12, 4);
      }
    }
  });
}

// --- neon trim family (deck-edge bands in ql_vp_ig_hq1/hq2) -----------------
// These are used on thin brushes whose world-aligned UVs sample arbitrary
// slices of the tile, so every texel must read as glowing neon — no dark
// borders. Rendered unlit (MeshBasicMaterial) so they look emissive.

function neonTex(seed: number, edge: [number, number, number], core: [number, number, number]): THREE.CanvasTexture {
  return tex(128, seed, (ctx, s, rand) => {
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, rgb(edge[0], edge[1], edge[2]));
    g.addColorStop(0.5, rgb(core[0], core[1], core[2]));
    g.addColorStop(1, rgb(edge[0], edge[1], edge[2]));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    // Faint vertical energy streaks so long bands aren't perfectly flat.
    for (let i = 0; i < 24; i++) {
      ctx.fillStyle = `rgba(255,255,255,${(0.04 + rand() * 0.08).toFixed(3)})`;
      ctx.fillRect(rand() * s, 0, 1 + rand() * 2, s);
    }
  });
}

// --- hull metal details ------------------------------------------------------

function metalTex(): THREE.CanvasTexture {
  // Dark fine-mesh grate strip (the dark strips inset between deck panels
  // in crop_ql_centerdeck).
  return tex(256, 707, (ctx, s, rand) => {
    ctx.fillStyle = rgb(12, 14, 18);
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = rgb(56, 62, 74);
    for (let y = 0; y < s; y += 16) ctx.fillRect(0, y, s, 6);
    for (let x = 0; x < s; x += 16) ctx.fillRect(x, 0, 6, s);
    ctx.fillStyle = 'rgba(170,192,218,0.18)';
    for (let y = 0; y < s; y += 16) ctx.fillRect(0, y, s, 1);
    speckle(ctx, rand, s, 600, 1.5, 0.05);
  });
}

function pillarTex(): THREE.CanvasTexture {
  // Ribbed light metal — support columns and housing pylons.
  return tex(256, 808, (ctx, s, rand) => {
    ctx.fillStyle = rgb(150, 154, 164);
    ctx.fillRect(0, 0, s, s);
    const flutes = 10;
    const fw = s / flutes;
    for (let i = 0; i < flutes; i++) {
      const g = ctx.createLinearGradient(i * fw, 0, (i + 1) * fw, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.30)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.16)');
      g.addColorStop(1, 'rgba(0,0,0,0.30)');
      ctx.fillStyle = g;
      ctx.fillRect(i * fw, 0, fw, s);
    }
    // Banding top/bottom of each 128-unit repeat.
    ctx.fillStyle = 'rgba(30,34,44,0.6)';
    ctx.fillRect(0, 0, s, 10);
    ctx.fillRect(0, s - 10, s, 10);
    ctx.fillStyle = 'rgba(235,240,250,0.4)';
    ctx.fillRect(0, 10, s, 2);
    ctx.fillRect(0, s - 12, s, 2);
    speckle(ctx, rand, s, 1200, 2, 0.04);
  });
}

function stairsTex(): THREE.CanvasTexture {
  // Deck-family steps: pale treads with bright worn edges.
  return tex(256, 909, (ctx, s, rand) => {
    ctx.fillStyle = rgb(166, 161, 150);
    ctx.fillRect(0, 0, s, s);
    const rows = 4;
    const rh = s / rows;
    for (let r = 0; r < rows; r++) {
      const k = 1 + (rand() - 0.5) * 0.08;
      ctx.fillStyle = rgb(166 * k, 161 * k, 150 * k);
      ctx.fillRect(0, r * rh + 2, s, rh - 4);
      ctx.fillStyle = 'rgba(240,245,252,0.5)';
      ctx.fillRect(0, r * rh + 2, s, 2);
      ctx.fillStyle = 'rgba(20,18,16,0.35)';
      ctx.fillRect(0, r * rh + rh - 4, s, 4);
    }
    speckle(ctx, rand, s, 1100, 2, 0.04);
  });
}

function ledgeTex(): THREE.CanvasTexture {
  // Deck-family bordered plate for edges and rims.
  return tex(256, 111, (ctx, s, rand) => {
    deckGround(ctx, s, rand);
    ctx.strokeStyle = 'rgba(220,225,235,0.45)';
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, s - 16, s - 16);
    ctx.strokeStyle = 'rgba(40,36,30,0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(14, 14, s - 28, s - 28);
    rivet(ctx, 20, 20, 4);
    rivet(ctx, s - 20, 20, 4);
    rivet(ctx, 20, s - 20, 4);
    rivet(ctx, s - 20, s - 20, 4);
  });
}

function padBaseTex(): THREE.CanvasTexture {
  // Dark machined ring housing under the launch-pad glow discs.
  return tex(256, 222, (ctx, s, rand) => {
    drawBrushedMetal(ctx, s, rand, [34, 37, 44]);
    const c = s / 2;
    for (const r of [36, 64, 92, 116]) {
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(150,176,210,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(c, c, r - 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      rivet(ctx, c + Math.cos(a) * 104, c + Math.sin(a) * 104, 4);
    }
  });
}

function portalFrameTex(): THREE.CanvasTexture {
  // Near-black housing metal (crop_ql_frames_lowerleft) — the blue rim light
  // comes from the emissive map below.
  return tex(256, 333, (ctx, s, rand) => {
    drawBrushedMetal(ctx, s, rand, [20, 22, 28]);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    for (let y = 0; y < s; y += s / 4) ctx.fillRect(0, y, s, 3);
    for (let x = 16; x < s; x += 64) {
      rivet(ctx, x, s * 0.125, 3);
      rivet(ctx, x + 32, s * 0.625, 3);
    }
    speckle(ctx, rand, s, 700, 2, 0.05);
  });
}

function portalFrameEmissiveTex(): THREE.CanvasTexture {
  // Thin cyan rim-light lines running through the housing panels.
  return tex(256, 334, (ctx, s) => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, s, s);
    for (const y of [s * 0.22, s * 0.78]) {
      ctx.fillStyle = 'rgba(34,120,200,0.35)';
      ctx.fillRect(0, y - 3, s, 7);
      ctx.fillStyle = rgb(120, 220, 255);
      ctx.fillRect(0, y - 1, s, 2);
    }
  });
}

// --- team emblems (big circular insignia on the flag decks, aerial levelshot)

function emblemTex(seed: number, main: [number, number, number], dark: [number, number, number]): THREE.CanvasTexture {
  return tex(512, seed, (ctx, s, rand) => {
    // Ground matches the 'floor' deck so the inlay blends in.
    deckGround(ctx, s, rand);
    const c = s / 2;
    const mainCss = rgb(main[0], main[1], main[2]);
    const darkCss = rgb(dark[0], dark[1], dark[2]);

    // Chevron notch ticks around the outside.
    ctx.fillStyle = darkCss;
    for (let i = 0; i < 8; i++) {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate((i / 8) * Math.PI * 2);
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.478);
      ctx.lineTo(-s * 0.032, -s * 0.418);
      ctx.lineTo(s * 0.032, -s * 0.418);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Bold outer ring with a darker inner edge.
    ctx.strokeStyle = mainCss;
    ctx.lineWidth = s * 0.055;
    ctx.beginPath();
    ctx.arc(c, c, s * 0.375, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = darkCss;
    ctx.lineWidth = s * 0.012;
    ctx.beginPath();
    ctx.arc(c, c, s * 0.335, 0, Math.PI * 2);
    ctx.stroke();

    // Translucent inner field + inner ring.
    ctx.fillStyle = rgba(main[0], main[1], main[2], 0.16);
    ctx.beginPath();
    ctx.arc(c, c, s * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgba(main[0], main[1], main[2], 0.85);
    ctx.lineWidth = s * 0.02;
    ctx.beginPath();
    ctx.arc(c, c, s * 0.23, 0, Math.PI * 2);
    ctx.stroke();

    // Diagonal connector bars between inner ring and outer ring.
    ctx.fillStyle = mainCss;
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(Math.PI / 4 + (i / 4) * Math.PI * 2);
      ctx.fillRect(-s * 0.0175, -s * 0.335, s * 0.035, s * 0.095);
      ctx.restore();
    }

    // Solid center disc with a dark core dot.
    ctx.fillStyle = mainCss;
    ctx.beginPath();
    ctx.arc(c, c, s * 0.125, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = darkCss;
    ctx.beginPath();
    ctx.arc(c, c, s * 0.05, 0, Math.PI * 2);
    ctx.fill();

    // Painted-on wear so it reads as a decal, not a sticker.
    speckle(ctx, rand, s, 1600, 2, 0.04);
  });
}

// --- public API --------------------------------------------------------------

export function createMaterials(): MaterialSet {
  const textures: THREE.Texture[] = [];
  const track = (t: THREE.CanvasTexture): THREE.CanvasTexture => {
    textures.push(t);
    return t;
  };

  const lambert = (map: THREE.CanvasTexture, extra?: Partial<THREE.MeshLambertMaterialParameters>) =>
    new THREE.MeshLambertMaterial({ map: track(map), ...extra });
  // Unlit — neon bands must read emissive regardless of lighting.
  const neon = (map: THREE.CanvasTexture) => new THREE.MeshBasicMaterial({ map: track(map) });
  const decal = (map: THREE.CanvasTexture, opacity = 1) =>
    new THREE.MeshBasicMaterial({
      map: track(map),
      transparent: true,
      opacity,
      alphaTest: 0.02,
      depthWrite: false,
    });

  const byName: Record<MaterialName, THREE.Material> = {
    floor: lambert(floorTex()),
    floorAlt: lambert(floorAltTex()),
    stripeDark: lambert(stripeDarkTex()),
    edgeGlow: new THREE.MeshBasicMaterial({ color: 0xe5fdff }),
    titleMark: decal(titleMarkTex(), 0.94),
    wall: lambert(wallTex()),
    wallDark: lambert(wallDarkTex()),
    ceiling: lambert(ceilingTex()),
    // Bright cyan-blue edge band (the signature QL deck-edge neon).
    trim: neon(neonTex(606, [62, 150, 255], [196, 246, 255])),
    trimRed: neon(neonTex(616, [212, 36, 20], [255, 158, 112])),
    trimBlue: neon(neonTex(626, [36, 84, 235], [150, 212, 255])),
    metal: lambert(metalTex()),
    pillar: lambert(pillarTex()),
    stairs: lambert(stairsTex()),
    ledge: lambert(ledgeTex()),
    padBase: lambert(padBaseTex()),
    portalFrame: lambert(portalFrameTex(), {
      emissive: 0xffffff,
      emissiveMap: track(portalFrameEmissiveTex()),
      emissiveIntensity: 1.0,
    }),
    // Unlit brights — small glow inlays and strips.
    glowRed: new THREE.MeshBasicMaterial({ color: 0xff5030 }),
    glowBlue: new THREE.MeshBasicMaterial({ color: 0x46c8ff }),
    glowWhite: new THREE.MeshBasicMaterial({ color: 0xeffaff }),
    portalCircuit: lambert(portalCircuitTex(), { emissive: 0x123040, emissiveIntensity: 0.45 }),
    qlSign: lambert(qlSignTex(), { emissive: 0x2b1717, emissiveIntensity: 0.3 }),
    triangleRed: decal(triangleTex(891, [225, 44, 36]), 0.84),
    triangleBlue: decal(triangleTex(892, [70, 142, 255]), 0.84),
    // Painted team insignia inlays (world.ts fits one tile per brush).
    emblemRed: lambert(emblemTex(881, [198, 44, 32], [116, 20, 14])),
    emblemBlue: lambert(emblemTex(882, [44, 110, 226], [18, 50, 128])),
  };

  return {
    byName,
    dispose(): void {
      for (const t of textures) t.dispose();
      for (const m of Object.values(byName)) m.dispose();
    },
  };
}

/**
 * Soft radial white glow — shared sprite texture for beam flashes, impact
 * bursts, spark points and portal halos. Tint via material color.
 */
export function createGlowSpriteTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(128);
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}
