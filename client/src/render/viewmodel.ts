// First-person railgun viewmodel. Parented to the camera, bottom-right,
// with a time-based idle sway and a fast-decay recoil kick. The rail glow
// strips are tinted with the local player's color.

import * as THREE from 'three';
import { playerColor } from '../../../shared/constants';

const BASE_POS = new THREE.Vector3(7, -6, -14);
/** Recoil decays to ~5% in 150 ms: exp(-150/50). */
const RECOIL_DECAY_MS = 50;

export class Viewmodel {
  readonly group: THREE.Group;
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly coilMat: THREE.MeshBasicMaterial;
  private recoil = 0;
  private colorIdx = -1;
  private readonly disposables: { dispose(): void }[] = [];

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'viewmodel';
    this.group.position.copy(BASE_POS);

    const metal = new THREE.MeshLambertMaterial({
      color: 0x2b2e38,
      emissive: 0x141722,
      emissiveIntensity: 0.55,
    });
    const darkMetal = new THREE.MeshLambertMaterial({
      color: 0x191b22,
      emissive: 0x0a0b10,
      emissiveIntensity: 0.5,
    });
    this.glowMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.coilMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.disposables.push(metal, darkMetal, this.glowMat, this.coilMat);

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0): THREE.Mesh => {
      this.disposables.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (rx !== 0) m.rotation.x = rx;
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    };

    // Receiver / body.
    add(new THREE.BoxGeometry(2.8, 3.4, 13), metal, 0, 0, -5);
    // Barrel (cylinder axis Y → rotate to lie along -Z).
    add(new THREE.CylinderGeometry(1.0, 1.1, 11, 10), darkMetal, 0, 0.9, -13.5, Math.PI / 2);
    // Muzzle ring.
    add(new THREE.CylinderGeometry(1.25, 1.25, 1.2, 10), metal, 0, 0.9, -18.6, Math.PI / 2);
    // Top sight blade.
    add(new THREE.BoxGeometry(0.7, 1.2, 2.4), darkMetal, 0, 2.6, -7);
    // Grip, raked back slightly.
    add(new THREE.BoxGeometry(2.0, 4.6, 2.6), darkMetal, 0, -3.4, -0.5, 0.28);
    // Rail glow strips flanking the barrel + a thin under-barrel coil.
    add(new THREE.BoxGeometry(0.5, 0.5, 10.5), this.glowMat, 1.45, 0.9, -13.2);
    add(new THREE.BoxGeometry(0.5, 0.5, 10.5), this.glowMat, -1.45, 0.9, -13.2);
    add(new THREE.CylinderGeometry(0.35, 0.35, 9.5, 6), this.coilMat, 0, -0.8, -12.8, Math.PI / 2);
  }

  /** Cache the local player's color; cheap no-op when unchanged. */
  setColor(colorIdx: number): void {
    if (colorIdx === this.colorIdx) return;
    this.colorIdx = colorIdx;
    const c = new THREE.Color(playerColor(colorIdx));
    this.coilMat.color.copy(c);
    this.glowMat.color.copy(c).lerp(new THREE.Color(0xffffff), 0.35);
  }

  triggerRecoil(): void {
    this.recoil = 1;
  }

  update(timeMs: number, dtMs: number): void {
    this.recoil *= Math.exp(-dtMs / RECOIL_DECAY_MS);
    if (this.recoil < 0.002) this.recoil = 0;
    const t = timeMs * 0.001;
    // Gentle idle sway (no velocity available — purely time-based).
    const swayX = Math.sin(t * 1.05) * 0.22;
    const swayY = Math.sin(t * 1.71 + 0.9) * 0.18;
    this.group.position.set(
      BASE_POS.x + swayX,
      BASE_POS.y + swayY,
      BASE_POS.z + this.recoil * 3.6, // kick back toward the camera
    );
    this.group.rotation.set(this.recoil * 0.13, Math.sin(t * 0.83) * 0.008, Math.sin(t * 0.67) * 0.01);
    // Coil flares bright while the recoil energy bleeds off.
    this.glowMat.opacity = 0.75 + this.recoil * 0.25 + Math.sin(t * 2.3) * 0.06;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
