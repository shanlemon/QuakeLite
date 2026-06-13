// Renderer entry point. Implements the CreateRenderer contract from
// src/types.ts: builds the static world, lighting, portals and pads from the
// MapDef, then drives players/viewmodel/effects every frame.

import * as THREE from 'three';
import type { CreateRenderer, RenderPlayer, ViewState } from '../types';
import { DEG2RAD, RAD2DEG } from '../../../shared/math';
import { createMaterials } from './materials';
import { buildWorld } from './world';
import { createPortals } from './portals';
import { createJumpPads } from './pads';
import { createSkybox } from './skybox';
import { createThrusters } from './thrusters';
import { PlayerAvatars } from './players';
import { Viewmodel } from './viewmodel';
import { Effects } from './effects';

const MAX_FRAME_DT_MS = 100;

export const createRenderer: CreateRenderer = (map, container) => {
  const isSpace = map.space === true;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Slightly hotter exposure in space — the pale QL decks should read bright
  // against the black void.
  renderer.toneMappingExposure = isSpace ? 1.25 : 1.15;
  renderer.domElement.style.display = 'block';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  if (isSpace) {
    // Open starfield void: deep-space black, NO fog (it would gray out the
    // skybox and the long cross-void sightlines).
    scene.background = new THREE.Color(0x030408);
  } else {
    scene.background = new THREE.Color(map.fogColor);
    scene.fog = new THREE.FogExp2(map.fogColor, map.fogDensity);
  }

  const camera = new THREE.PerspectiveCamera(75, 1, 1, 16000);
  camera.rotation.order = 'YXZ';
  scene.add(camera); // the viewmodel is parented to the camera

  // --- static world + lighting ----------------------------------------------
  const materials = createMaterials();
  const world = buildWorld(map, materials);
  scene.add(world);

  if (isSpace) {
    // Cool starlight from above, warm planet-glow bounce from below.
    scene.add(new THREE.AmbientLight(0x9fb0d8, map.ambient));
    scene.add(new THREE.HemisphereLight(0xc4d2f2, 0x33211a, map.ambient * 0.55));
  } else {
    scene.add(new THREE.AmbientLight(0x8090b0, map.ambient));
    scene.add(new THREE.HemisphereLight(0x9aa8cc, 0x1c1410, map.ambient * 0.55));
  }
  for (const def of map.lights) {
    // decay 0 + distance → three's smooth windowed falloff, Quake-light feel.
    const light = new THREE.PointLight(def.color, def.intensity, def.range, 0);
    light.position.set(def.pos.x, def.pos.y, def.pos.z);
    scene.add(light);
  }

  const skybox = isSpace ? createSkybox() : null;
  if (skybox) scene.add(skybox.group);
  const thrusters = createThrusters(map);
  scene.add(thrusters.group);

  const portals = createPortals(map);
  scene.add(portals.group);
  const pads = createJumpPads(map);
  scene.add(pads.group);

  const avatars = new PlayerAvatars(scene);
  const effects = new Effects(scene);
  const viewmodel = new Viewmodel();
  camera.add(viewmodel.group);

  // --- camera / projection ----------------------------------------------------
  let lastHFov = -1;
  let lastAspect = -1;

  /** view.fov is Quake-style horizontal FOV; three wants vertical degrees. */
  function applyFov(hfovDeg: number, aspect: number): void {
    if (hfovDeg === lastHFov && aspect === lastAspect) return;
    lastHFov = hfovDeg;
    lastAspect = aspect;
    const half = Math.tan(hfovDeg * 0.5 * DEG2RAD);
    camera.fov = 2 * Math.atan(half / aspect) * RAD2DEG;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }

  function fitToContainer(): void {
    const w = Math.max(1, container.clientWidth || window.innerWidth);
    const h = Math.max(1, container.clientHeight || window.innerHeight);
    renderer.setSize(w, h);
    if (lastHFov > 0) {
      lastAspect = -1; // force fov recompute for the new aspect
      applyFov(lastHFov, w / h);
    } else {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  fitToContainer();

  let lastTimeMs = -1;
  let localColorIdx = 0;

  function render(_dt: number, view: ViewState, players: RenderPlayer[], timeMs: number): void {
    // Derive a clamped frame delta from the monotonic clock so effect
    // integration stays stable across tab-switch hitches.
    const dtMs = lastTimeMs < 0 ? 16.7 : Math.min(Math.max(timeMs - lastTimeMs, 0), MAX_FRAME_DT_MS);
    lastTimeMs = timeMs;

    camera.position.set(view.pos.x, view.pos.y, view.pos.z);
    camera.rotation.y = view.yaw;
    camera.rotation.x = view.pitch;
    const w = renderer.domElement.width || 1;
    const h = renderer.domElement.height || 1;
    applyFov(view.fov, w / h);

    for (const p of players) {
      if (p.isLocal) {
        localColorIdx = p.colorIdx;
        break;
      }
    }
    viewmodel.setColor(localColorIdx);
    viewmodel.update(timeMs, dtMs);
    viewmodel.group.visible = players.some((p) => p.isLocal && p.alive);

    avatars.update(players, camera.position);
    if (skybox) skybox.update(camera.position);
    thrusters.update(timeMs);
    portals.update(timeMs);
    pads.update(timeMs);
    effects.update(timeMs, dtMs);

    renderer.render(scene, camera);
  }

  return {
    resize(): void {
      fitToContainer();
    },
    render,
    spawnBeam(from, to, colorIdx): void {
      effects.spawnBeam(from, to, colorIdx);
    },
    spawnImpact(pos, colorIdx): void {
      effects.spawnImpact(pos, colorIdx);
    },
    spawnGibs(pos, colorIdx): void {
      effects.spawnGibs(pos, colorIdx);
    },
    triggerRecoil(): void {
      viewmodel.triggerRecoil();
    },
  };
};
