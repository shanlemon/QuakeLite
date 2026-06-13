// Anti-grav thruster emitters under the floating platforms (map.thrusters):
// each is a downward additive light cone — bright white core, wider violet
// sheath — with a hot glow sprite at the apex and a subtle point light.
// Modeled on crop_ql_topcenter / q3ta_vp_hq2, where the central platform
// visibly hovers on bright white-violet beams. Flicker animated per frame.

import * as THREE from 'three';
import type { MapDef } from '../../../shared/mapdef';
import { createGlowSpriteTexture } from './materials';

const CORE_LEN = 120;
const SHEATH_LEN = 175;
/** Every PointLight raises the cost of all lit materials — cap the count. */
const MAX_LIGHTS = 8;

export interface ThrustersView {
  group: THREE.Group;
  update(timeMs: number): void;
  dispose(): void;
}

/** Vertical fade: bright at the apex (v=1, cone tip), transparent below. */
function beamGradientTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('QuakeLite renderer: 2D canvas context unavailable');
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 128);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

interface Flicker {
  mat: THREE.MeshBasicMaterial | THREE.SpriteMaterial;
  base: number;
  amp: number;
  phase: number;
}

export function createThrusters(map: MapDef): ThrustersView {
  const group = new THREE.Group();
  group.name = 'thrusters';
  const flickers: Flicker[] = [];
  const lights: { light: THREE.PointLight; phase: number }[] = [];
  const disposables: { dispose(): void }[] = [];

  const positions = map.thrusters ?? [];
  if (positions.length > 0) {
    const gradTex = beamGradientTexture();
    const glowTex = createGlowSpriteTexture();
    disposables.push(gradTex, glowTex);
    // ConeGeometry: tip at +h/2 — the tip sits at the emitter, opening down.
    const coreGeo = new THREE.ConeGeometry(11, CORE_LEN, 12, 1, true);
    const sheathGeo = new THREE.ConeGeometry(30, SHEATH_LEN, 14, 1, true);
    disposables.push(coreGeo, sheathGeo);

    positions.forEach((p, i) => {
      const phase = i * 1.73;

      // Hot white core beam.
      const coreMat = new THREE.MeshBasicMaterial({
        color: 0xfff4ff,
        map: gradTex,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false,
      });
      disposables.push(coreMat);
      const core = new THREE.Mesh(coreGeo, coreMat);
      core.position.set(p.x, p.y - CORE_LEN * 0.5, p.z);
      group.add(core);
      flickers.push({ mat: coreMat, base: 0.74, amp: 0.18, phase });

      // Wider violet sheath around it.
      const sheathMat = new THREE.MeshBasicMaterial({
        color: 0xb38cff,
        map: gradTex,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false,
      });
      disposables.push(sheathMat);
      const sheath = new THREE.Mesh(sheathGeo, sheathMat);
      sheath.position.set(p.x, p.y - SHEATH_LEN * 0.5, p.z);
      group.add(sheath);
      flickers.push({ mat: sheathMat, base: 0.26, amp: 0.09, phase: phase + 0.9 });

      // Bright emitter glow right at the apex.
      const glowMat = new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xefe2ff,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
      disposables.push(glowMat);
      const glow = new THREE.Sprite(glowMat);
      glow.scale.set(78, 78, 1);
      glow.position.set(p.x, p.y - 4, p.z);
      group.add(glow);
      flickers.push({ mat: glowMat, base: 0.82, amp: 0.16, phase: phase + 2.2 });

      // Subtle violet-white light cast onto nearby fascia/decks.
      if (lights.length < MAX_LIGHTS) {
        const light = new THREE.PointLight(0xd9c6ff, 1.1, 520, 0);
        light.position.set(p.x, p.y - 36, p.z);
        group.add(light);
        lights.push({ light, phase });
      }
    });
  }

  return {
    group,
    update(timeMs: number): void {
      const t = timeMs * 0.001;
      for (const f of flickers) {
        // Slow pulse plus a fast engine-jitter shimmer.
        const slow = Math.sin(t * 3.4 + f.phase) * 0.5 + 0.5;
        const fast = Math.sin(t * 23.7 + f.phase * 2.1) * 0.5 + 0.5;
        f.mat.opacity = f.base + f.amp * (slow * 0.7 + fast * 0.3);
      }
      for (const l of lights) {
        l.light.intensity = 1.0 + 0.25 * (Math.sin(t * 3.4 + l.phase) * 0.5 + 0.5);
      }
    },
    dispose(): void {
      for (const d of disposables) d.dispose();
    },
  };
}
