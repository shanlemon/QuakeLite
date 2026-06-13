// Vortex portal visuals: a metal torus frame, an accent glow ring, a soft
// halo sprite and the centerpiece — an animated swirling-energy shader disc.

import * as THREE from 'three';
import { yawForward } from '../../../shared/math';
import type { MapDef, PortalDef } from '../../../shared/mapdef';
import { createGlowSpriteTexture } from './materials';

const VORTEX_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const VORTEX_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform vec3 uCore;
uniform vec3 uMid;
uniform vec3 uRim;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y);
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float ang = atan(p.y, p.x);
  float t = uTime;

  // Tight spiral arms (the QL vortex is a hard icy swirl): angle twisted
  // strongly toward the center, rotating with time.
  float swirl = ang + (1.0 - r) * 9.5 - t * 2.6;
  float wob = noise(vec2(swirl * 1.3, r * 6.0 - t * 0.9)) * 1.8;
  float arms = sin(swirl * 4.0 + wob);
  arms = pow(arms * 0.5 + 0.5, 2.1);

  // Slow drifting turbulence over the whole disc.
  float turb = noise(p * 3.5 + vec2(t * 0.37, -t * 0.29));

  // Hot pulsing core.
  float core = exp(-r * r * 8.0) * (1.1 + 0.35 * sin(t * 5.3) + 0.18 * sin(t * 8.9 + 1.7));
  // Soft falloff at the rim so the disc melts into the frame.
  float rimFade = smoothstep(1.0, 0.80, r);

  vec3 col = mix(uMid, uRim, smoothstep(0.20, 0.95, r));
  col = mix(col, uMid * 1.5, arms * 0.75);
  col += uMid * turb * 0.30;
  col += uCore * core * 2.3;

  float alpha = rimFade * (0.22 + 0.55 * arms + 0.30 * turb) + core;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
`;

interface AccentColors {
  core: THREE.Color;
  mid: THREE.Color;
  rim: THREE.Color;
  halo: number;
}

// QL restyle (crop_ql_centerdeck / crop_ql_frames_lowerleft): the swirl is
// icy cyan/blue-white for BOTH bases — the team accent shows only in the rim
// tint and the station's halo lighting (red side a subtle warm rim).
const ACCENTS: Record<PortalDef['accent'], AccentColors> = {
  red: {
    core: new THREE.Color(0xfdf7f0),
    mid: new THREE.Color(0x6fcdf2),
    rim: new THREE.Color(0x7c3017),
    halo: 0xe06a3a,
  },
  blue: {
    core: new THREE.Color(0xeffcff),
    mid: new THREE.Color(0x59c8ff),
    rim: new THREE.Color(0x123f8c),
    halo: 0x37b6ff,
  },
};

export interface PortalsView {
  group: THREE.Group;
  update(timeMs: number): void;
  dispose(): void;
}

export function createPortals(map: MapDef): PortalsView {
  const group = new THREE.Group();
  group.name = 'portals';
  const vortexMats: THREE.ShaderMaterial[] = [];
  const glowRings: { mesh: THREE.Mesh; phase: number }[] = [];
  const disposables: { dispose(): void }[] = [];
  const haloTex = createGlowSpriteTexture();
  disposables.push(haloTex);

  for (const portal of map.portals) {
    const accent = ACCENTS[portal.accent];
    const pivot = new THREE.Group();
    // Local +Z should point along the disc's front normal yawForward(faceYaw).
    const n = yawForward(portal.faceYaw);
    // The disc center sits exactly on the monolith face plane — nudge it out
    // along the normal or the coplanar surfaces z-fight (the pads do the same).
    pivot.position.set(
      portal.center.x + n.x * 0.75,
      portal.center.y,
      portal.center.z + n.z * 0.75,
    );
    // Yaw first, then tilt around the already-yawed local X so the disc leans
    // back from vertical (PortalDef.tilt; collision is unaffected by design).
    pivot.rotation.order = 'YXZ';
    pivot.rotation.y = Math.atan2(n.x, n.z);
    pivot.rotation.x = -(portal.tilt ?? 0);

    const vortexMat = new THREE.ShaderMaterial({
      vertexShader: VORTEX_VERT,
      fragmentShader: VORTEX_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uCore: { value: accent.core },
        uMid: { value: accent.mid },
        uRim: { value: accent.rim },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    vortexMats.push(vortexMat);
    disposables.push(vortexMat);

    const discGeo = new THREE.CircleGeometry(portal.radius, 48);
    disposables.push(discGeo);
    const disc = new THREE.Mesh(discGeo, vortexMat);
    disc.renderOrder = 2;
    pivot.add(disc);

    // Slim structural rim ring (near-black; the map builds the physical
    // billboard-gate housing from brushes — this just seats the disc).
    const frameGeo = new THREE.TorusGeometry(portal.radius * 1.03, portal.radius * 0.045, 10, 48);
    disposables.push(frameGeo);
    const frameMat = new THREE.MeshLambertMaterial({ color: 0x14161d, emissive: 0x06101e });
    disposables.push(frameMat);
    pivot.add(new THREE.Mesh(frameGeo, frameMat));

    // Inner accent glow ring, slightly proud of the disc.
    const ringGeo = new THREE.TorusGeometry(portal.radius * 0.97, portal.radius * 0.03, 8, 48);
    disposables.push(ringGeo);
    const ringMat = new THREE.MeshBasicMaterial({
      color: accent.halo,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    disposables.push(ringMat);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.renderOrder = 1;
    pivot.add(ring);
    glowRings.push({ mesh: ring, phase: portal.id * 1.37 });

    // Big soft halo so the portal lights up its chamber from afar.
    const haloMat = new THREE.SpriteMaterial({
      map: haloTex,
      color: accent.halo,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // The sprite is centered on the wall plane; with depth testing the wall
      // would clip half the glow at any off-axis view angle.
      depthTest: false,
    });
    disposables.push(haloMat);
    const halo = new THREE.Sprite(haloMat);
    halo.scale.set(portal.radius * 3.4, portal.radius * 3.4, 1);
    halo.renderOrder = 0;
    pivot.add(halo);

    group.add(pivot);
  }

  return {
    group,
    update(timeMs: number): void {
      const t = timeMs * 0.001;
      for (const m of vortexMats) m.uniforms['uTime']!.value = t;
      for (const r of glowRings) {
        const pulse = 0.78 + 0.22 * Math.sin(t * 3.1 + r.phase);
        (r.mesh.material as THREE.MeshBasicMaterial).opacity = pulse;
      }
    },
    dispose(): void {
      for (const d of disposables) d.dispose();
    },
  };
}
