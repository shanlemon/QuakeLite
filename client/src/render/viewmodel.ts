// First-person railgun viewmodel. Parented to the camera, bottom-right,
// with a time-based idle sway and a fast-decay recoil kick. The silhouette is
// a procedural Quake-style railgun: bulky bronze casing, green charge windows,
// silver collars, exposed side coils, and a long forward rail.

import * as THREE from 'three';
import { playerColor } from '../../../shared/constants';

const BASE_POS = new THREE.Vector3(7.1, -6.1, -14.2);
const BASE_YAW = 0.14;
/** Recoil decays to ~5% in 150 ms: exp(-150/50). */
const RECOIL_DECAY_MS = 50;

export class Viewmodel {
  readonly group: THREE.Group;
  private readonly energyMat: THREE.MeshBasicMaterial;
  private readonly accentMat: THREE.MeshBasicMaterial;
  private recoil = 0;
  private colorIdx = -1;
  private readonly disposables: { dispose(): void }[] = [];

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'viewmodel';
    this.group.position.copy(BASE_POS);

    const bronze = new THREE.MeshLambertMaterial({
      color: 0x7f4a2a,
      emissive: 0x1f1008,
      emissiveIntensity: 0.62,
    });
    const bronzeDark = new THREE.MeshLambertMaterial({
      color: 0x4f2b1b,
      emissive: 0x120905,
      emissiveIntensity: 0.55,
    });
    const silver = new THREE.MeshLambertMaterial({
      color: 0xb4b0a6,
      emissive: 0x1d2028,
      emissiveIntensity: 0.45,
    });
    const darkMetal = new THREE.MeshLambertMaterial({
      color: 0x17181d,
      emissive: 0x090a0f,
      emissiveIntensity: 0.5,
    });
    this.energyMat = new THREE.MeshBasicMaterial({
      color: 0x3dff49,
      transparent: true,
      opacity: 0.86,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.accentMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.disposables.push(bronze, bronzeDark, silver, darkMetal, this.energyMat, this.accentMat);

    const add = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      rx = 0,
      ry = 0,
      rz = 0,
    ): THREE.Mesh => {
      this.disposables.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (rx !== 0 || ry !== 0 || rz !== 0) m.rotation.set(rx, ry, rz);
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    };

    // Chunky receiver and bronze shell.
    add(new THREE.BoxGeometry(4.8, 3.8, 9.2), bronze, 0, 0.05, -6.1);
    add(new THREE.BoxGeometry(3.6, 1.8, 11.4), bronzeDark, 0, -1.2, -7.5);
    add(new THREE.BoxGeometry(4.3, 1.1, 7.0), bronze, 0, 2.05, -7.4);

    // Silver rear drum and forward clamp collars.
    add(new THREE.CylinderGeometry(2.35, 2.55, 2.8, 14), silver, 0, 0.1, -1.9, Math.PI / 2);
    add(new THREE.CylinderGeometry(2.15, 2.15, 1.4, 14), silver, 0, 0.12, -11.8, Math.PI / 2);
    add(new THREE.CylinderGeometry(1.4, 1.4, 0.75, 12), darkMetal, 0, 0.12, -12.95, Math.PI / 2);

    // Bright green railgun charge windows: top and both sides.
    add(new THREE.BoxGeometry(2.65, 0.18, 3.7), this.energyMat, 0, 2.73, -7.4);
    add(new THREE.BoxGeometry(0.18, 1.75, 4.8), this.energyMat, 2.52, 0.25, -7.6);
    add(new THREE.BoxGeometry(0.18, 1.75, 4.8), this.energyMat, -2.52, 0.25, -7.6);
    add(new THREE.BoxGeometry(2.05, 0.2, 2.4), this.energyMat, 0, -2.08, -7.7);
    for (const z of [-5.6, -7.4, -9.2]) {
      add(new THREE.TorusGeometry(2.78, 0.13, 8, 18), this.energyMat, 0, 0.18, z);
    }

    // Long forward barrel/rail and a rectangular muzzle fork.
    add(new THREE.CylinderGeometry(0.58, 0.72, 8.2, 12), silver, 0, 0.18, -16.6, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.28, 0.28, 9.5, 8), darkMetal, 0, 1.0, -16.9, Math.PI / 2);
    for (const z of [-14.0, -15.35, -16.7, -18.05]) {
      add(new THREE.TorusGeometry(0.92, 0.08, 8, 14), this.energyMat, 0, 0.18, z);
    }
    add(new THREE.BoxGeometry(0.42, 1.7, 7.8), darkMetal, -1.08, 0.18, -16.55);
    add(new THREE.BoxGeometry(0.42, 1.7, 7.8), darkMetal, 1.08, 0.18, -16.55);
    add(new THREE.CylinderGeometry(0.76, 0.76, 1.05, 12), silver, 0, 0.18, -21.2, Math.PI / 2);
    add(new THREE.BoxGeometry(3.1, 0.55, 0.7), darkMetal, 0, 0.18, -21.65);
    add(new THREE.BoxGeometry(0.45, 2.0, 0.7), darkMetal, -1.35, 0.18, -21.65);
    add(new THREE.BoxGeometry(0.45, 2.0, 0.7), darkMetal, 1.35, 0.18, -21.65);
    add(new THREE.CylinderGeometry(0.32, 0.32, 0.9, 10), this.accentMat, 0, 0.18, -21.82, Math.PI / 2);

    // Sight blade and rear raised block.
    add(new THREE.BoxGeometry(0.95, 1.15, 2.2), darkMetal, 0, 3.02, -6.1);
    add(new THREE.BoxGeometry(2.3, 0.78, 1.7), silver, 0, 2.95, -2.5);

    // Exposed side pipe and segmented coil stack.
    add(new THREE.CylinderGeometry(0.36, 0.36, 6.2, 8), silver, -2.9, -0.65, -7.0, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.36, 0.36, 6.2, 8), silver, 2.9, -0.65, -7.0, Math.PI / 2);
    for (const z of [-4.7, -5.6, -6.5, -7.4, -8.3]) {
      add(new THREE.CylinderGeometry(0.48, 0.48, 0.64, 8), silver, -3.0, -0.6, z, 0, 0, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.48, 0.48, 0.64, 8), silver, 3.0, -0.6, z, 0, 0, Math.PI / 2);
    }
    add(new THREE.BoxGeometry(0.55, 2.6, 3.4), bronzeDark, -3.25, 0.78, -7.2, 0, 0, -0.16);
    add(new THREE.BoxGeometry(0.55, 2.6, 3.4), bronzeDark, 3.25, 0.78, -7.2, 0, 0, 0.16);

    // Raked grip, guard and trigger.
    add(new THREE.BoxGeometry(2.05, 4.8, 2.25), darkMetal, 0, -3.45, -2.2, 0.31);
    add(new THREE.BoxGeometry(2.6, 0.45, 2.0), silver, 0, -1.7, -3.35, 0.2);
    add(new THREE.BoxGeometry(0.45, 1.0, 0.32), this.accentMat, 0, -2.32, -3.15, 0.15);
  }

  /** Cache the local player's color; cheap no-op when unchanged. */
  setColor(colorIdx: number): void {
    if (colorIdx === this.colorIdx) return;
    this.colorIdx = colorIdx;
    const c = new THREE.Color(playerColor(colorIdx));
    this.accentMat.color.copy(c).lerp(new THREE.Color(0xffffff), 0.15);
  }

  triggerRecoil(): void {
    this.recoil = 1;
  }

  update(timeMs: number, dtMs: number): void {
    this.recoil *= Math.exp(-dtMs / RECOIL_DECAY_MS);
    if (this.recoil < 0.002) this.recoil = 0;
    const t = timeMs * 0.001;
    // Gentle idle sway (no velocity available - purely time-based).
    const swayX = Math.sin(t * 1.05) * 0.22;
    const swayY = Math.sin(t * 1.71 + 0.9) * 0.18;
    this.group.position.set(
      BASE_POS.x + swayX,
      BASE_POS.y + swayY,
      BASE_POS.z + this.recoil * 3.6, // kick back toward the camera
    );
    this.group.rotation.set(
      this.recoil * 0.14,
      BASE_YAW + Math.sin(t * 0.83) * 0.008,
      Math.sin(t * 0.67) * 0.01,
    );
    // Charge windows and muzzle flare brighten while recoil energy bleeds off.
    this.energyMat.opacity = 0.76 + this.recoil * 0.2 + Math.sin(t * 2.3) * 0.06;
    this.accentMat.opacity = 0.66 + this.recoil * 0.34;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
