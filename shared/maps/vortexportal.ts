// ---------------------------------------------------------------------------
// The Longest Yard - QuakeLite recreation of Quake III Arena's q3dm17.
//
// Geometry is prioritized over textures: a space-floater arena with a broad
// lower base floor, two large upper landings joined by the armor bridge, side
// rooms, mid platforms, a high power-up perch, and the isolated long railgun
// platform reached by a risky launch across the void.
// ---------------------------------------------------------------------------

import { vec3, type Vec3 } from '../math';
import type {
  Brush,
  JumpPadDef,
  LightDef,
  MapDef,
  MaterialName,
  PortalDef,
  PrismBrush,
  SpawnDef,
} from '../mapdef';

const PI = Math.PI;

function box(
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number,
  mat: MaterialName,
): Brush {
  return { min: vec3(x1, y1, z1), max: vec3(x2, y2, z2), mat };
}

function prism(
  verts: readonly (readonly [number, number])[],
  minY: number,
  maxY: number,
  mat: MaterialName,
): PrismBrush {
  return { verts: verts.map(([x, z]) => ({ x, z })), minY, maxY, mat };
}

function deck(verts: readonly (readonly [number, number])[], minY: number, topY: number): PrismBrush[] {
  return [prism(verts, minY, topY - 8, 'wall'), prism(verts, topY - 8, topY, 'floor')];
}

function mirrorXBrush(b: Brush): Brush {
  return {
    min: vec3(-b.max.x, b.min.y, b.min.z),
    max: vec3(-b.min.x, b.max.y, b.max.z),
    mat: b.mat,
  };
}

function mirrorXPrism(p: PrismBrush): PrismBrush {
  return {
    verts: p.verts.map((v) => ({ x: -v.x, z: v.z })).reverse(),
    minY: p.minY,
    maxY: p.maxY,
    mat: p.mat,
  };
}

function mirrorXPad(p: JumpPadDef): JumpPadDef {
  return {
    trigger: {
      min: vec3(-p.trigger.max.x, p.trigger.min.y, p.trigger.min.z),
      max: vec3(-p.trigger.min.x, p.trigger.max.y, p.trigger.max.z),
    },
    velocity: vec3(-p.velocity.x, p.velocity.y, p.velocity.z),
    padTop: vec3(-p.padTop.x, p.padTop.y, p.padTop.z),
  };
}

function mirrorXPortal(p: PortalDef, id: number): PortalDef {
  return {
    id,
    trigger: {
      min: vec3(-p.trigger.max.x, p.trigger.min.y, p.trigger.min.z),
      max: vec3(-p.trigger.min.x, p.trigger.max.y, p.trigger.max.z),
    },
    center: vec3(-p.center.x, p.center.y, p.center.z),
    radius: p.radius,
    faceYaw: -p.faceYaw,
    exitPos: vec3(-p.exitPos.x, p.exitPos.y, p.exitPos.z),
    exitYaw: -p.exitYaw,
    accent: p.accent === 'red' ? 'blue' : 'red',
    ...(p.tilt !== undefined ? { tilt: p.tilt } : {}),
  };
}

function mirrorXSpawn(s: SpawnDef): SpawnDef {
  return { pos: vec3(-s.pos.x, s.pos.y, s.pos.z), yaw: -s.yaw };
}

function mirrorXLight(l: LightDef): LightDef {
  return { pos: vec3(-l.pos.x, l.pos.y, l.pos.z), color: l.color, intensity: l.intensity, range: l.range };
}

const brushes: Brush[] = [];
const prisms: PrismBrush[] = [];
const details: Brush[] = [];

// ---------------------------------------------------------------------------
// Lower base floor and side rooms.
// ---------------------------------------------------------------------------

const baseFloor = [
  [-560, -520],
  [560, -520],
  [680, -360],
  [680, 320],
  [520, 520],
  [-520, 520],
  [-680, 320],
  [-680, -360],
] as const;
prisms.push(...deck(baseFloor, -64, 0));

const leftRoom = [
  [-1040, -300],
  [-680, -300],
  [-680, 300],
  [-1040, 300],
] as const;
prisms.push(...deck(leftRoom, -56, 0), ...deck(leftRoom, -56, 0).map(mirrorXPrism));

// Side-room partial covers, low enough to shoot over but useful as geometry.
brushes.push(box(-1040, 0, -300, -1000, 160, 300, 'wallDark'));
brushes.push(box(-1040, 128, -300, -680, 160, -260, 'wallDark'));
brushes.push(box(-1040, 128, 260, -680, 160, 300, 'wallDark'));
brushes.push(...brushes.map(mirrorXBrush));

// ---------------------------------------------------------------------------
// Upper landings, armor bridge, mid platforms, rail platform, power-up perch.
// ---------------------------------------------------------------------------

const upperLeft = [
  [-1260, -460],
  [-560, -460],
  [-480, -360],
  [-480, 360],
  [-560, 500],
  [-1180, 500],
  [-1280, 340],
  [-1280, -340],
] as const;
prisms.push(...deck(upperLeft, 128, 192), ...deck(upperLeft, 128, 192).map(mirrorXPrism));

const armorBridge = [
  [-520, 340],
  [520, 340],
  [520, 500],
  [-520, 500],
] as const;
prisms.push(...deck(armorBridge, 144, 192));

const leftMidFront = [
  [-1120, -980],
  [-780, -980],
  [-700, -900],
  [-700, -620],
  [-780, -540],
  [-1120, -540],
  [-1200, -620],
  [-1200, -900],
] as const;
const leftMidBack = [
  [-1120, 720],
  [-780, 720],
  [-700, 800],
  [-700, 1080],
  [-780, 1160],
  [-1120, 1160],
  [-1200, 1080],
  [-1200, 800],
] as const;
prisms.push(
  ...deck(leftMidFront, 64, 128),
  ...deck(leftMidFront, 64, 128).map(mirrorXPrism),
  ...deck(leftMidBack, 64, 128),
  ...deck(leftMidBack, 64, 128).map(mirrorXPrism),
);

const railPlatform = [
  [-360, -1600],
  [360, -1600],
  [480, -1480],
  [480, -1220],
  [360, -1100],
  [-360, -1100],
  [-480, -1220],
  [-480, -1480],
] as const;
prisms.push(...deck(railPlatform, 32, 96));

const railCatwalk = [
  [-96, -900],
  [96, -900],
  [96, -520],
  [-96, -520],
] as const;
prisms.push(...deck(railCatwalk, 0, 48));

const powerPlatform = [
  [-170, 660],
  [170, 660],
  [220, 710],
  [220, 870],
  [170, 920],
  [-170, 920],
  [-220, 870],
  [-220, 710],
] as const;
prisms.push(...deck(powerPlatform, 512, 560));

// Thin visual plates for pad housings, bridge insets, and the far rail porch.
details.push(box(-460, 1, -420, 460, 2, -360, 'stripeDark'));
details.push(box(-90, 193, 360, 90, 194, 480, 'emblemRed'));
details.push(box(-80, 561, 730, 80, 562, 850, 'emblemBlue'));
details.push(box(-100, 97, -1510, 100, 98, -1390, 'titleMark'));

// Pad bases: lower complex, catwalk-to-rail, upper/mid transfer pads, rail returns.
brushes.push(box(-56, 0, -56, 56, 8, 56, 'padBase')); // high power-up
brushes.push(box(-248, 0, 64, -168, 8, 144, 'padBase')); // upper left
brushes.push(box(168, 0, 64, 248, 8, 144, 'padBase')); // upper right
brushes.push(box(-56, 0, -220, 56, 8, -140, 'padBase')); // armor bridge
brushes.push(box(-56, 48, -860, 56, 56, -780, 'padBase')); // rail
brushes.push(box(-1090, 192, 320, -1010, 200, 400, 'padBase')); // left upper to front mid
brushes.push(box(1010, 192, 320, 1090, 200, 400, 'padBase')); // right upper to front mid
brushes.push(box(-960, 128, -890, -880, 136, -810, 'padBase')); // front mid back to upper
brushes.push(box(880, 128, -890, 960, 136, -810, 'padBase'));
brushes.push(box(-960, 128, 810, -880, 136, 890, 'padBase')); // rear mid back to upper
brushes.push(box(880, 128, 810, 960, 136, 890, 'padBase'));
brushes.push(box(-210, 96, -1500, -130, 104, -1420, 'padBase')); // rail return left
brushes.push(box(130, 96, -1500, 210, 104, -1420, 'padBase')); // rail return right

// Teleporter frames on the two upper landings and the power-up perch.
brushes.push(box(-1276, 192, 140, -1252, 392, 300, 'portalFrame'));
brushes.push(box(-1252, 192, 140, -1228, 360, 164, 'portalFrame'));
brushes.push(box(-1252, 192, 276, -1228, 360, 300, 'portalFrame'));
brushes.push(box(-1252, 344, 164, -1228, 384, 276, 'portalFrame'));
brushes.push(box(1252, 192, 140, 1276, 392, 300, 'portalFrame'));
brushes.push(box(1228, 192, 140, 1252, 360, 164, 'portalFrame'));
brushes.push(box(1228, 192, 276, 1252, 360, 300, 'portalFrame'));
brushes.push(box(1228, 344, 164, 1252, 384, 276, 'portalFrame'));
brushes.push(box(196, 560, 700, 220, 744, 880, 'portalFrame'));

// ---------------------------------------------------------------------------
// Jump pads and teleporters.
// ---------------------------------------------------------------------------

const jumpPads: JumpPadDef[] = [
  {
    trigger: { min: vec3(-56, -2, -56), max: vec3(56, 44, 56) },
    velocity: vec3(0, 1010, 450),
    padTop: vec3(0, 8, 0),
  },
  {
    trigger: { min: vec3(-248, -2, 64), max: vec3(-168, 44, 144) },
    velocity: vec3(-450, 635, 250),
    padTop: vec3(-208, 8, 104),
  },
  {
    trigger: { min: vec3(168, -2, 64), max: vec3(248, 44, 144) },
    velocity: vec3(450, 635, 250),
    padTop: vec3(208, 8, 104),
  },
  {
    trigger: { min: vec3(-56, -2, -220), max: vec3(56, 44, -140) },
    velocity: vec3(0, 660, 420),
    padTop: vec3(0, 8, -180),
  },
  {
    trigger: { min: vec3(-56, 46, -860), max: vec3(56, 92, -780) },
    velocity: vec3(0, 670, -330),
    padTop: vec3(0, 56, -820),
  },
  {
    trigger: { min: vec3(-1090, 190, 320), max: vec3(-1010, 236, 400) },
    velocity: vec3(90, 560, -650),
    padTop: vec3(-1050, 200, 360),
  },
  {
    trigger: { min: vec3(1010, 190, 320), max: vec3(1090, 236, 400) },
    velocity: vec3(-90, 560, -650),
    padTop: vec3(1050, 200, 360),
  },
  {
    trigger: { min: vec3(-960, 126, -890), max: vec3(-880, 172, -810) },
    velocity: vec3(-20, 520, 520),
    padTop: vec3(-920, 136, -850),
  },
  {
    trigger: { min: vec3(880, 126, -890), max: vec3(960, 172, -810) },
    velocity: vec3(20, 520, 520),
    padTop: vec3(920, 136, -850),
  },
  {
    trigger: { min: vec3(-960, 126, 810), max: vec3(-880, 172, 890) },
    velocity: vec3(0, 520, -500),
    padTop: vec3(-920, 136, 850),
  },
  {
    trigger: { min: vec3(880, 126, 810), max: vec3(960, 172, 890) },
    velocity: vec3(0, 520, -500),
    padTop: vec3(920, 136, 850),
  },
  {
    trigger: { min: vec3(-210, 94, -1500), max: vec3(-130, 140, -1420) },
    velocity: vec3(-300, 940, 740),
    padTop: vec3(-170, 104, -1460),
  },
  {
    trigger: { min: vec3(130, 94, -1500), max: vec3(210, 140, -1420) },
    velocity: vec3(300, 940, 740),
    padTop: vec3(170, 104, -1460),
  },
];

const portals: PortalDef[] = [
  {
    id: 0,
    trigger: { min: vec3(-1268, 200, 164), max: vec3(-1218, 360, 276) },
    center: vec3(-1250, 282, 220),
    radius: 58,
    faceYaw: -PI / 2,
    exitPos: vec3(-80, 260, 420),
    exitYaw: -PI / 2,
    accent: 'red',
    tilt: 0.12,
  },
  mirrorXPortal(
    {
      id: 0,
      trigger: { min: vec3(-1268, 200, 164), max: vec3(-1218, 360, 276) },
      center: vec3(-1250, 282, 220),
      radius: 58,
      faceYaw: -PI / 2,
      exitPos: vec3(-80, 260, 420),
      exitYaw: -PI / 2,
      accent: 'red',
      tilt: 0.12,
    },
    1,
  ),
  {
    id: 2,
    trigger: { min: vec3(160, 560, 720), max: vec3(228, 720, 860) },
    center: vec3(208, 640, 790),
    radius: 54,
    faceYaw: PI / 2,
    exitPos: vec3(0, 260, 420),
    exitYaw: PI,
    accent: 'blue',
    tilt: 0.1,
  },
];

// ---------------------------------------------------------------------------
// Spawns, lights, and anti-grav thrusters.
// ---------------------------------------------------------------------------

const halfSpawns: SpawnDef[] = [
  { pos: vec3(-320, 0.25, -260), yaw: PI / 4 },
  { pos: vec3(-860, 0.25, -60), yaw: 0 },
  { pos: vec3(-920, 128.25, -760), yaw: PI / 4 },
  { pos: vec3(-920, 192.25, 250), yaw: PI / 2 },
  { pos: vec3(-920, 128.25, 940), yaw: -PI / 4 },
];
const spawns: SpawnDef[] = [
  ...halfSpawns,
  ...halfSpawns.map(mirrorXSpawn),
  { pos: vec3(0, 96.25, -1380), yaw: 0 },
  { pos: vec3(0, 192.25, 420), yaw: PI },
];

const halfLights: LightDef[] = [
  { pos: vec3(-380, 300, 0), color: 0xe7e2d7, intensity: 0.9, range: 1000 },
  { pos: vec3(-900, 430, 260), color: 0xd8e4ff, intensity: 0.9, range: 900 },
  { pos: vec3(-940, 320, -760), color: 0xd8e4ff, intensity: 0.7, range: 700 },
  { pos: vec3(-1250, 300, 220), color: 0xff6644, intensity: 1.1, range: 460 },
];
const lights: LightDef[] = [
  ...halfLights,
  ...halfLights.map(mirrorXLight),
  { pos: vec3(0, 360, -120), color: 0xe8e0d0, intensity: 1.0, range: 1200 },
  { pos: vec3(0, 360, -1320), color: 0xcfe0ff, intensity: 0.8, range: 900 },
  { pos: vec3(0, 700, 780), color: 0x88ccff, intensity: 1.0, range: 700 },
];

const thrusters: Vec3[] = [
  vec3(-420, -88, -320),
  vec3(420, -88, -320),
  vec3(-420, -88, 320),
  vec3(420, -88, 320),
  vec3(-960, 106, 320),
  vec3(960, 106, 320),
  vec3(-920, 42, -760),
  vec3(920, 42, -760),
  vec3(0, 6, -1360),
  vec3(0, 486, 780),
];

export const vortexPortal: MapDef = {
  name: 'longestyard',
  displayName: 'The Longest Yard',
  brushes,
  prisms,
  details,
  jumpPads,
  portals,
  spawns,
  lights,
  ambient: 0.48,
  fogColor: 0x05060c,
  fogDensity: 0,
  bounds: { min: vec3(-1700, -620, -1900), max: vec3(1700, 1150, 1300) },
  space: true,
  thrusters,
};
