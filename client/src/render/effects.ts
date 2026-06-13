// Transient effects, all pooled and recycled — beams, impact bursts and gib
// showers never allocate during play and never grow unbounded.

import * as THREE from 'three';
import { GAME, playerColor } from '../../../shared/constants';
import type { Vec3 } from '../../../shared/math';
import { createGlowSpriteTexture } from './materials';

const BEAM_POOL = 24;
const IMPACT_POOL = 12;
const IMPACT_LIGHTS = 3;
const IMPACT_SPARKS = 12;
const IMPACT_LIFE_MS = 380;
const IMPACT_FLASH_MS = 160;
const IMPACT_LIGHT_MS = 120;
const GIB_BURSTS = 6;
const GIBS_PER_BURST = 14;
const GIB_LIFE_MS = 900;
const GIB_GRAVITY = 800;

const WHITE = new THREE.Color(0xffffff);
const UP = new THREE.Vector3(0, 1, 0);
const _v1 = new THREE.Vector3();
const _c1 = new THREE.Color();

interface Beam {
  group: THREE.Group;
  core: THREE.Mesh;
  glow: THREE.Mesh;
  coreMat: THREE.MeshBasicMaterial;
  glowMat: THREE.MeshBasicMaterial;
  flash: THREE.Sprite;
  flashMat: THREE.SpriteMaterial;
  start: number;
  len: number;
  active: boolean;
}

interface Impact {
  sprite: THREE.Sprite;
  spriteMat: THREE.SpriteMaterial;
  points: THREE.Points;
  pointsMat: THREE.PointsMaterial;
  positions: THREE.BufferAttribute;
  vels: Float32Array;
  start: number;
  active: boolean;
}

interface GibBurst {
  meshes: THREE.Mesh[];
  mat: THREE.MeshLambertMaterial;
  vels: Float32Array;
  angVels: Float32Array;
  start: number;
  active: boolean;
}

export class Effects {
  private readonly scene: THREE.Scene;
  private readonly glowTex: THREE.CanvasTexture;
  private now = 0;

  private readonly beamGeo: THREE.CylinderGeometry;
  private readonly beams: Beam[] = [];
  private beamNext = 0;

  private readonly impacts: Impact[] = [];
  private impactNext = 0;
  private readonly lights: THREE.PointLight[] = [];
  private readonly lightStarts: number[] = [];
  private lightNext = 0;

  private readonly gibGeos: THREE.BoxGeometry[];
  private readonly bursts: GibBurst[] = [];
  private burstNext = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.glowTex = createGlowSpriteTexture();
    this.beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    this.gibGeos = [
      new THREE.BoxGeometry(5, 4, 3),
      new THREE.BoxGeometry(3, 3, 3),
      new THREE.BoxGeometry(6, 3, 4),
    ];

    for (let i = 0; i < BEAM_POOL; i++) this.beams.push(this.makeBeam());
    for (let i = 0; i < IMPACT_POOL; i++) this.impacts.push(this.makeImpact());
    for (let i = 0; i < IMPACT_LIGHTS; i++) {
      // Lights stay in the scene at zero intensity — adding/removing lights
      // at runtime would force shader recompiles (a visible hitch).
      const light = new THREE.PointLight(0xffffff, 0, 260, 0);
      light.visible = true;
      scene.add(light);
      this.lights.push(light);
      this.lightStarts.push(-1e9);
    }
    for (let i = 0; i < GIB_BURSTS; i++) this.bursts.push(this.makeBurst());
  }

  // --- pool construction ----------------------------------------------------

  private makeBeam(): Beam {
    const group = new THREE.Group();
    group.visible = false;
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const core = new THREE.Mesh(this.beamGeo, coreMat);
    const glow = new THREE.Mesh(this.beamGeo, glowMat);
    core.frustumCulled = false;
    glow.frustumCulled = false;
    group.add(glow);
    group.add(core);
    const flashMat = new THREE.SpriteMaterial({
      map: this.glowTex,
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const flash = new THREE.Sprite(flashMat);
    group.add(flash);
    this.scene.add(group);
    return { group, core, glow, coreMat, glowMat, flash, flashMat, start: 0, len: 1, active: false };
  }

  private makeImpact(): Impact {
    const spriteMat = new THREE.SpriteMaterial({
      map: this.glowTex,
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.visible = false;
    this.scene.add(sprite);

    const positions = new THREE.BufferAttribute(new Float32Array(IMPACT_SPARKS * 3), 3);
    positions.setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', positions);
    const pointsMat = new THREE.PointsMaterial({
      map: this.glowTex,
      color: 0xffffff,
      size: 4,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, pointsMat);
    points.frustumCulled = false;
    points.visible = false;
    this.scene.add(points);

    return {
      sprite,
      spriteMat,
      points,
      pointsMat,
      positions,
      vels: new Float32Array(IMPACT_SPARKS * 3),
      start: 0,
      active: false,
    };
  }

  private makeBurst(): GibBurst {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true });
    const meshes: THREE.Mesh[] = [];
    for (let i = 0; i < GIBS_PER_BURST; i++) {
      const mesh = new THREE.Mesh(this.gibGeos[i % this.gibGeos.length]!, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      meshes.push(mesh);
    }
    return {
      meshes,
      mat,
      vels: new Float32Array(GIBS_PER_BURST * 3),
      angVels: new Float32Array(GIBS_PER_BURST * 3),
      start: 0,
      active: false,
    };
  }

  // --- spawns -----------------------------------------------------------------

  spawnBeam(from: Vec3, to: Vec3, colorIdx: number): void {
    const beam = this.beams[this.beamNext]!;
    this.beamNext = (this.beamNext + 1) % BEAM_POOL;

    _v1.set(to.x - from.x, to.y - from.y, to.z - from.z);
    const len = _v1.length();
    if (len < 0.01) return;
    _v1.multiplyScalar(1 / len);
    beam.group.quaternion.setFromUnitVectors(UP, _v1);
    beam.group.position.set((from.x + to.x) * 0.5, (from.y + to.y) * 0.5, (from.z + to.z) * 0.5);
    beam.len = len;
    beam.start = this.now;
    beam.active = true;
    beam.group.visible = true;

    const tint = _c1.setHex(playerColor(colorIdx));
    beam.glowMat.color.copy(tint);
    beam.flashMat.color.copy(tint).lerp(WHITE, 0.4);
    beam.coreMat.color.copy(tint).lerp(WHITE, 0.7);
    beam.flash.position.set(0, -len * 0.5, 0); // muzzle end in beam-local space
    this.styleBeam(beam, 0);
  }

  spawnImpact(pos: Vec3, colorIdx: number): void {
    const imp = this.impacts[this.impactNext]!;
    this.impactNext = (this.impactNext + 1) % IMPACT_POOL;
    imp.start = this.now;
    imp.active = true;

    const tint = _c1.setHex(playerColor(colorIdx));
    imp.spriteMat.color.copy(tint).lerp(WHITE, 0.55);
    imp.pointsMat.color.copy(tint).lerp(WHITE, 0.3);
    imp.sprite.position.set(pos.x, pos.y, pos.z);
    imp.sprite.visible = true;
    imp.points.visible = true;

    for (let i = 0; i < IMPACT_SPARKS; i++) {
      imp.positions.setXYZ(i, pos.x, pos.y, pos.z);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 90 + Math.random() * 220;
      imp.vels[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      imp.vels[i * 3 + 1] = Math.abs(Math.cos(phi)) * speed * 0.9 + 40; // upward bias
      imp.vels[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;
    }
    imp.positions.needsUpdate = true;

    const light = this.lights[this.lightNext]!;
    this.lightStarts[this.lightNext] = this.now;
    this.lightNext = (this.lightNext + 1) % IMPACT_LIGHTS;
    light.color.copy(tint).lerp(WHITE, 0.4);
    light.position.set(pos.x, pos.y, pos.z);
    light.intensity = 1.7;
  }

  spawnGibs(pos: Vec3, colorIdx: number): void {
    const burst = this.bursts[this.burstNext]!;
    this.burstNext = (this.burstNext + 1) % GIB_BURSTS;
    burst.start = this.now;
    burst.active = true;
    // Player tint pulled toward dark red — chunky, gory, readable.
    burst.mat.color.setHex(playerColor(colorIdx)).lerp(_c1.setHex(0x7a1410), 0.45);
    burst.mat.opacity = 1;

    for (let i = 0; i < GIBS_PER_BURST; i++) {
      const mesh = burst.meshes[i]!;
      mesh.visible = true;
      mesh.position.set(
        pos.x + (Math.random() - 0.5) * 14,
        pos.y + 18 + (Math.random() - 0.5) * 22,
        pos.z + (Math.random() - 0.5) * 14,
      );
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      const ang = Math.random() * Math.PI * 2;
      const h = 100 + Math.random() * 240; // horizontal 100-340
      burst.vels[i * 3] = Math.cos(ang) * h;
      burst.vels[i * 3 + 1] = 150 + Math.random() * 280; // upward bias
      burst.vels[i * 3 + 2] = Math.sin(ang) * h;
      burst.angVels[i * 3] = (Math.random() - 0.5) * 11;
      burst.angVels[i * 3 + 1] = (Math.random() - 0.5) * 11;
      burst.angVels[i * 3 + 2] = (Math.random() - 0.5) * 11;
    }
  }

  // --- per-frame update --------------------------------------------------------

  private styleBeam(beam: Beam, t: number): void {
    const fade = 1 - t;
    const radius = 1 - 0.4 * t; // slight shrink as it dies
    beam.core.scale.set(1.5 * radius, beam.len, 1.5 * radius);
    beam.glow.scale.set(4 * radius, beam.len, 4 * radius);
    beam.coreMat.opacity = fade;
    beam.glowMat.opacity = 0.45 * fade;
    const tf = Math.min(1, t * 2.4);
    beam.flashMat.opacity = 1 - tf;
    const fs = 30 * (1 - tf) + 8;
    beam.flash.scale.set(fs, fs, 1);
  }

  update(timeMs: number, dtMs: number): void {
    this.now = timeMs;
    const dt = dtMs * 0.001;

    for (const beam of this.beams) {
      if (!beam.active) continue;
      const t = (timeMs - beam.start) / GAME.BEAM_LIFE_MS;
      if (t >= 1) {
        beam.active = false;
        beam.group.visible = false;
        continue;
      }
      this.styleBeam(beam, t);
    }

    for (const imp of this.impacts) {
      if (!imp.active) continue;
      const age = timeMs - imp.start;
      if (age >= IMPACT_LIFE_MS) {
        imp.active = false;
        imp.sprite.visible = false;
        imp.points.visible = false;
        continue;
      }
      const tf = Math.min(1, age / IMPACT_FLASH_MS);
      imp.spriteMat.opacity = 1 - tf;
      const s = 12 + 26 * tf;
      imp.sprite.scale.set(s, s, 1);

      const tp = age / IMPACT_LIFE_MS;
      imp.pointsMat.opacity = 1 - tp;
      for (let i = 0; i < IMPACT_SPARKS; i++) {
        imp.vels[i * 3 + 1]! -= GIB_GRAVITY * dt;
        imp.positions.setXYZ(
          i,
          imp.positions.getX(i) + imp.vels[i * 3]! * dt,
          imp.positions.getY(i) + imp.vels[i * 3 + 1]! * dt,
          imp.positions.getZ(i) + imp.vels[i * 3 + 2]! * dt,
        );
      }
      imp.positions.needsUpdate = true;
    }

    for (let li = 0; li < IMPACT_LIGHTS; li++) {
      const age = timeMs - this.lightStarts[li]!;
      const light = this.lights[li]!;
      if (age >= 0 && age < IMPACT_LIGHT_MS) {
        light.intensity = 1.7 * (1 - age / IMPACT_LIGHT_MS);
      } else if (light.intensity !== 0) {
        light.intensity = 0;
      }
    }

    for (const burst of this.bursts) {
      if (!burst.active) continue;
      const t = (timeMs - burst.start) / GIB_LIFE_MS;
      if (t >= 1) {
        burst.active = false;
        for (const m of burst.meshes) m.visible = false;
        continue;
      }
      burst.mat.opacity = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
      for (let i = 0; i < GIBS_PER_BURST; i++) {
        const mesh = burst.meshes[i]!;
        burst.vels[i * 3 + 1]! -= GIB_GRAVITY * dt;
        mesh.position.x += burst.vels[i * 3]! * dt;
        mesh.position.y += burst.vels[i * 3 + 1]! * dt;
        mesh.position.z += burst.vels[i * 3 + 2]! * dt;
        mesh.rotation.x += burst.angVels[i * 3]! * dt;
        mesh.rotation.y += burst.angVels[i * 3 + 1]! * dt;
        mesh.rotation.z += burst.angVels[i * 3 + 2]! * dt;
      }
    }
  }

  dispose(): void {
    for (const beam of this.beams) {
      this.scene.remove(beam.group);
      beam.coreMat.dispose();
      beam.glowMat.dispose();
      beam.flashMat.dispose();
    }
    for (const imp of this.impacts) {
      this.scene.remove(imp.sprite);
      this.scene.remove(imp.points);
      imp.spriteMat.dispose();
      imp.pointsMat.dispose();
      (imp.points.geometry as THREE.BufferGeometry).dispose();
    }
    for (const light of this.lights) this.scene.remove(light);
    for (const burst of this.bursts) {
      for (const m of burst.meshes) this.scene.remove(m);
      burst.mat.dispose();
    }
    this.beamGeo.dispose();
    for (const g of this.gibGeos) g.dispose();
    this.glowTex.dispose();
  }
}
