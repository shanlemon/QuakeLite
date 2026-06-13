// Jump pad visuals: a pulsing energy disc on the pad surface plus a very
// faint additive light-beam cone hinting at the launch direction.

import * as THREE from 'three';
import type { MapDef } from '../../../shared/mapdef';

const PAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const PAD_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform vec3 uColor;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  // Rings sweeping outward from the center.
  float rings = sin(r * 12.0 - uTime * 5.0) * 0.5 + 0.5;
  float pulse = 0.78 + 0.22 * sin(uTime * 3.2);
  float core = exp(-r * r * 3.0);
  // Bright inset ring — QL pads read as a flat glowing cyan ring in the deck.
  float edge = smoothstep(0.16, 0.02, abs(r - 0.80));
  float a = smoothstep(1.0, 0.85, r) * (0.18 + 0.40 * rings * (1.0 - r)) + core * 0.80 + edge * 0.85;
  vec3 col = uColor * (0.55 + 0.80 * core + 0.90 * edge) + vec3(1.0) * (core * 0.55 + edge * 0.25);
  gl_FragColor = vec4(col * pulse, clamp(a * pulse, 0.0, 1.0));
}
`;

// Icy cyan, matching the launch rings in crop_ql_centerdeck.
const PAD_COLOR = new THREE.Color(0x55dcff);

export interface PadsView {
  group: THREE.Group;
  update(timeMs: number): void;
  dispose(): void;
}

export function createJumpPads(map: MapDef): PadsView {
  const group = new THREE.Group();
  group.name = 'jumpPads';
  const padMats: { mat: THREE.ShaderMaterial; phase: number }[] = [];
  const cones: { mat: THREE.MeshBasicMaterial; phase: number }[] = [];
  const disposables: { dispose(): void }[] = [];

  map.jumpPads.forEach((pad, i) => {
    const phase = i * 1.91;
    // Disc radius inferred from the trigger footprint.
    const tw = pad.trigger.max.x - pad.trigger.min.x;
    const td = pad.trigger.max.z - pad.trigger.min.z;
    const radius = Math.min(64, Math.max(16, (Math.min(tw, td) * 0.5) * 0.95));

    const mat = new THREE.ShaderMaterial({
      vertexShader: PAD_VERT,
      fragmentShader: PAD_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: PAD_COLOR },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    padMats.push({ mat, phase });
    disposables.push(mat);

    const discGeo = new THREE.CircleGeometry(radius, 32);
    disposables.push(discGeo);
    const disc = new THREE.Mesh(discGeo, mat);
    disc.rotation.x = -Math.PI / 2; // face up
    disc.position.set(pad.padTop.x, pad.padTop.y + 0.6, pad.padTop.z);
    disc.renderOrder = 1;
    group.add(disc);

    // Soft upward light shaft above the pad.
    const coneH = 150;
    const coneGeo = new THREE.CylinderGeometry(radius * 0.35, radius * 0.85, coneH, 14, 1, true);
    disposables.push(coneGeo);
    const coneMat = new THREE.MeshBasicMaterial({
      color: PAD_COLOR,
      transparent: true,
      opacity: 0.06,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    cones.push({ mat: coneMat, phase });
    disposables.push(coneMat);
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(pad.padTop.x, pad.padTop.y + coneH * 0.5 + 1, pad.padTop.z);
    cone.renderOrder = 0;
    group.add(cone);
  });

  return {
    group,
    update(timeMs: number): void {
      const t = timeMs * 0.001;
      for (const p of padMats) p.mat.uniforms['uTime']!.value = t + p.phase;
      for (const c of cones) c.mat.opacity = 0.05 + 0.03 * (Math.sin(t * 3.2 + c.phase) * 0.5 + 0.5);
    },
    dispose(): void {
      for (const d of disposables) d.dispose();
    },
  };
}
