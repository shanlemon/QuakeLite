// Remote player avatars: tinted capsule body, head + visor, a small railgun
// tracking yaw+pitch, and a camera-facing nameplate sprite that fades with
// distance. Avatars are pooled and recycled - no per-frame allocation.

import * as THREE from 'three';
import { playerColor } from '../../../shared/constants';
import type { RenderPlayer } from '../types';

const NAMEPLATE_FADE_START = 1100;
const NAMEPLATE_FADE_END = 1400;

interface ColorMats {
  body: THREE.MeshLambertMaterial;
  glow: THREE.MeshBasicMaterial;
}

interface Avatar {
  group: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Mesh;
  gunPivot: THREE.Group;
  gunGlow: THREE.Mesh;
  plate: THREE.Sprite;
  plateMat: THREE.SpriteMaterial;
  plateCanvas: HTMLCanvasElement;
  plateTex: THREE.CanvasTexture;
  name: string;
  colorIdx: number;
}

function drawNameplate(canvas: HTMLCanvasElement, name: string, colorIdx: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  // Soft dark pill behind the text.
  ctx.fillStyle = 'rgba(8,10,16,0.55)';
  ctx.beginPath();
  ctx.roundRect(8, 6, w - 16, h - 18, 14);
  ctx.fill();
  ctx.font = '600 30px system-ui, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e9edf5';
  ctx.fillText(name, w / 2, h / 2 - 6, w - 36);
  // Player-color underline bar.
  ctx.fillStyle = `#${playerColor(colorIdx).toString(16).padStart(6, '0')}`;
  ctx.fillRect(w / 2 - 48, h - 12, 96, 5);
}

export class PlayerAvatars {
  private readonly scene: THREE.Scene;
  private readonly active = new Map<number, Avatar>();
  private readonly free: Avatar[] = [];
  private readonly colorMats = new Map<number, ColorMats>();
  private readonly seen = new Set<number>();

  // Shared geometries.
  private readonly bodyGeo = new THREE.CapsuleGeometry(13, 18, 4, 12);
  private readonly headGeo = new THREE.SphereGeometry(9, 12, 10);
  private readonly visorGeo = new THREE.BoxGeometry(13, 5, 5);
  private readonly gunBodyGeo = new THREE.BoxGeometry(4.5, 3.1, 11.5);
  private readonly gunTopGeo = new THREE.BoxGeometry(3.3, 0.75, 6.5);
  private readonly gunBarrelGeo = new THREE.CylinderGeometry(0.55, 0.7, 10, 10);
  private readonly gunMuzzleGeo = new THREE.CylinderGeometry(0.8, 0.8, 1.1, 10);
  private readonly gunWindowGeo = new THREE.BoxGeometry(1.75, 0.42, 4.6);
  private readonly gunPipeGeo = new THREE.CylinderGeometry(0.32, 0.32, 5.2, 8);
  private readonly gunGripGeo = new THREE.BoxGeometry(1.6, 3.4, 1.6);
  private readonly visorMat = new THREE.MeshLambertMaterial({ color: 0x0d0f16 });
  private readonly gunMat = new THREE.MeshLambertMaterial({ color: 0x6c3f24, emissive: 0x140905 });
  private readonly gunDarkMat = new THREE.MeshLambertMaterial({ color: 0x17181d, emissive: 0x07080c });
  private readonly gunSilverMat = new THREE.MeshLambertMaterial({ color: 0xa9a49a, emissive: 0x151820 });

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  private matsFor(colorIdx: number): ColorMats {
    let mats = this.colorMats.get(colorIdx);
    if (!mats) {
      const c = playerColor(colorIdx);
      mats = {
        body: new THREE.MeshLambertMaterial({
          color: c,
          emissive: c,
          emissiveIntensity: 0.22,
        }),
        glow: new THREE.MeshBasicMaterial({
          color: new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.3),
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      };
      this.colorMats.set(colorIdx, mats);
    }
    return mats;
  }

  private createAvatar(): Avatar {
    const group = new THREE.Group();
    const mats = this.matsFor(0);

    const body = new THREE.Mesh(this.bodyGeo, mats.body);
    body.position.y = 22; // capsule is 44 tall, feet at group origin
    group.add(body);

    const head = new THREE.Mesh(this.headGeo, mats.body);
    head.position.y = 48;
    group.add(head);

    const visor = new THREE.Mesh(this.visorGeo, this.visorMat);
    visor.position.set(0, 48.5, -6.5); // forward is -Z at yaw 0
    group.add(visor);

    const gunPivot = new THREE.Group();
    gunPivot.position.set(9.5, 42, -2);
    group.add(gunPivot);

    const gun = new THREE.Mesh(this.gunBodyGeo, this.gunMat);
    gun.position.set(0, 0, -8);
    gunPivot.add(gun);
    const gunTop = new THREE.Mesh(this.gunTopGeo, this.gunMat);
    gunTop.position.set(0, 1.8, -8);
    gunPivot.add(gunTop);
    const barrel = new THREE.Mesh(this.gunBarrelGeo, this.gunSilverMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.25, -17);
    gunPivot.add(barrel);
    const muzzle = new THREE.Mesh(this.gunMuzzleGeo, this.gunSilverMat);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, 0.25, -22);
    gunPivot.add(muzzle);
    const pipe = new THREE.Mesh(this.gunPipeGeo, this.gunSilverMat);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(-2.65, -0.65, -8);
    gunPivot.add(pipe);
    const grip = new THREE.Mesh(this.gunGripGeo, this.gunDarkMat);
    grip.position.set(0, -2.9, -3.4);
    grip.rotation.x = 0.28;
    gunPivot.add(grip);
    const gunGlow = new THREE.Mesh(this.gunWindowGeo, mats.glow);
    gunGlow.position.set(0, 2.35, -8.2);
    gunPivot.add(gunGlow);

    const plateCanvas = document.createElement('canvas');
    plateCanvas.width = 256;
    plateCanvas.height = 64;
    const plateTex = new THREE.CanvasTexture(plateCanvas);
    plateTex.colorSpace = THREE.SRGBColorSpace;
    plateTex.minFilter = THREE.LinearFilter;
    plateTex.magFilter = THREE.LinearFilter;
    plateTex.generateMipmaps = false;
    const plateMat = new THREE.SpriteMaterial({
      map: plateTex,
      transparent: true,
      depthWrite: false,
    });
    const plate = new THREE.Sprite(plateMat);
    plate.scale.set(56, 14, 1);
    plate.position.y = 74;
    group.add(plate);

    this.scene.add(group);
    return {
      group,
      body,
      head,
      gunPivot,
      gunGlow,
      plate,
      plateMat,
      plateCanvas,
      plateTex,
      name: '',
      colorIdx: 0,
    };
  }

  private acquire(p: RenderPlayer): Avatar {
    const av = this.free.pop() ?? this.createAvatar();
    av.group.visible = true;
    this.restyle(av, p);
    return av;
  }

  private restyle(av: Avatar, p: RenderPlayer): void {
    if (av.colorIdx !== p.colorIdx || av.name === '') {
      const mats = this.matsFor(p.colorIdx);
      av.body.material = mats.body;
      av.head.material = mats.body;
      av.gunGlow.material = mats.glow;
      av.colorIdx = p.colorIdx;
      // Color changed → nameplate underline needs a redraw too.
      drawNameplate(av.plateCanvas, p.name, p.colorIdx);
      av.plateTex.needsUpdate = true;
      av.name = p.name;
    } else if (av.name !== p.name) {
      drawNameplate(av.plateCanvas, p.name, p.colorIdx);
      av.plateTex.needsUpdate = true;
      av.name = p.name;
    }
  }

  /** Sync avatars to this frame's player list. `cameraPos` drives plate fade. */
  update(players: RenderPlayer[], cameraPos: THREE.Vector3): void {
    this.seen.clear();
    for (const p of players) {
      if (p.isLocal || !p.alive) continue;
      this.seen.add(p.id);
      let av = this.active.get(p.id);
      if (!av) {
        av = this.acquire(p);
        this.active.set(p.id, av);
      } else {
        this.restyle(av, p);
      }
      av.group.position.set(p.pos.x, p.pos.y, p.pos.z);
      av.group.rotation.y = p.yaw;
      av.gunPivot.rotation.x = p.pitch;

      const dist = av.group.position.distanceTo(cameraPos);
      const fade =
        dist <= NAMEPLATE_FADE_START
          ? 1
          : Math.max(0, 1 - (dist - NAMEPLATE_FADE_START) / (NAMEPLATE_FADE_END - NAMEPLATE_FADE_START));
      av.plateMat.opacity = fade * 0.92;
      av.plate.visible = fade > 0.01;
    }
    // Retire avatars whose player left, died or became local.
    for (const [id, av] of this.active) {
      if (!this.seen.has(id)) {
        av.group.visible = false;
        this.active.delete(id);
        this.free.push(av);
      }
    }
  }

  dispose(): void {
    const all = [...this.active.values(), ...this.free];
    for (const av of all) {
      this.scene.remove(av.group);
      av.plateTex.dispose();
      av.plateMat.dispose();
    }
    this.active.clear();
    this.free.length = 0;
    for (const mats of this.colorMats.values()) {
      mats.body.dispose();
      mats.glow.dispose();
    }
    this.colorMats.clear();
    this.bodyGeo.dispose();
    this.headGeo.dispose();
    this.visorGeo.dispose();
    this.gunBodyGeo.dispose();
    this.gunTopGeo.dispose();
    this.gunBarrelGeo.dispose();
    this.gunMuzzleGeo.dispose();
    this.gunWindowGeo.dispose();
    this.gunPipeGeo.dispose();
    this.gunGripGeo.dispose();
    this.visorMat.dispose();
    this.gunMat.dispose();
    this.gunDarkMat.dispose();
    this.gunSilverMat.dispose();
  }
}
