// ---------------------------------------------------------------------------
// The Longest Yard - QuakeLite blockout of Quake III Arena q3dm17.
//
// Textures are intentionally local, but the geometry is authored to match the
// recognizable q3dm17 silhouette: lower five-pad base, mirrored upper floors
// with portal walls, center armor bridge, four satellite mid platforms, the
// long railgun launch to an isolated porch, and the chained top power-up route.
// ---------------------------------------------------------------------------

import { vec3, yawOfDir, type Vec3 } from '../math';
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

function mirrorXLight(l: LightDef): LightDef {
  return { pos: vec3(-l.pos.x, l.pos.y, l.pos.z), color: l.color, intensity: l.intensity, range: l.range };
}

const MAP_CENTER = vec3(0, 0, 0);

function spawnFacingCenter(x: number, y: number, z: number): SpawnDef {
  const pos = vec3(x, y, z);
  const dir = vec3(MAP_CENTER.x - pos.x, 0, MAP_CENTER.z - pos.z);
  return { pos, yaw: yawOfDir(dir) };
}

function mirrorXSpawn(s: SpawnDef): SpawnDef {
  return spawnFacingCenter(-s.pos.x, s.pos.y, s.pos.z);
}

const brushes: Brush[] = [];
const prisms: PrismBrush[] = [];
const details: Brush[] = [];
const detailPrisms: PrismBrush[] = [];
const jumpPads: JumpPadDef[] = [];

function addDeck(verts: readonly (readonly [number, number])[], minY: number, topY: number): void {
  prisms.push(...deck(verts, minY, topY));
}

function addMirrorXDeck(verts: readonly (readonly [number, number])[], minY: number, topY: number): void {
  const pieces = deck(verts, minY, topY);
  prisms.push(...pieces, ...pieces.map(mirrorXPrism));
}

function addDetailDeck(verts: readonly (readonly [number, number])[], y: number, mat: MaterialName): void {
  detailPrisms.push(prism(verts, y, y + 1, mat));
}

function addBrush(b: Brush): void {
  brushes.push(b);
}

function addMirrorXBrush(b: Brush): void {
  brushes.push(b, mirrorXBrush(b));
}

function addDetail(b: Brush): void {
  details.push(b);
}

function addMirrorXDetail(b: Brush): void {
  details.push(b, mirrorXBrush(b));
}

function addPad(x: number, floorY: number, z: number, half: number, velocity: Vec3): void {
  brushes.push(box(x - half, floorY, z - half, x + half, floorY + 8, z + half, 'padBase'));
  jumpPads.push({
    trigger: { min: vec3(x - half, floorY - 2, z - half), max: vec3(x + half, floorY + 46, z + half) },
    velocity,
    padTop: vec3(x, floorY + 8, z),
  });
}

// ---------------------------------------------------------------------------
// Lower base: the butterfly shaped ground floor and the rail launch runway.
// ---------------------------------------------------------------------------

const baseCore = [
  [-930, -760],
  [930, -760],
  [930, 610],
  [-930, 610],
] as const;
const baseLeftWing = [
  [-1120, -560],
  [-930, -760],
  [-930, 610],
  [-1120, 390],
] as const;
const baseRearFan = [
  [-470, 610],
  [470, 610],
  [365, 775],
  [130, 845],
  [-130, 845],
  [-365, 775],
] as const;
const sideRoomLeftFloor = [
  [-1480, -340],
  [-1000, -340],
  [-1000, 360],
  [-1480, 360],
] as const;
addDeck(baseCore, -112, 0);
addMirrorXDeck(baseLeftWing, -112, 0);
addDeck(baseRearFan, -112, 0);
addMirrorXDeck(sideRoomLeftFloor, -72, 0);

const railRunway = [
  [-150, -1580],
  [150, -1580],
  [185, -1460],
  [185, -760],
  [-185, -760],
  [-150, -1460],
] as const;
addDeck(railRunway, -80, 0);

// The central five-pad machine is mostly open in q3dm17; keep the collision
// low so it reads structurally without blocking the long rail sightline.
addDetailDeck(
  [
    [-260, -78],
    [-78, -260],
    [78, -260],
    [260, -78],
    [260, 78],
    [78, 260],
    [-78, 260],
    [-260, 78],
  ] as const,
  1,
  'floorAlt',
);
addDetail(box(-130, 2, -20, 130, 3, 20, 'metal'));
addDetail(box(-20, 2, -130, 20, 3, 130, 'metal'));
addDetail(box(-126, 4, -126, -64, 30, -64, 'wallDark'));
addDetail(box(64, 4, -126, 126, 30, -64, 'wallDark'));
addDetail(box(-126, 4, 64, -64, 30, 126, 'wallDark'));
addDetail(box(64, 4, 64, 126, 30, 126, 'wallDark'));

// The two small side rooms are the only real hiding spots.
addMirrorXBrush(box(-1480, 0, -340, -1420, 176, 360, 'wallDark'));
addMirrorXBrush(box(-1480, 126, -340, -1000, 176, -286, 'wallDark'));
addMirrorXBrush(box(-1480, 126, 286, -1000, 176, 360, 'wallDark'));
addMirrorXBrush(box(-1048, 0, -116, -1000, 122, 116, 'wallDark'));
addMirrorXDetail(box(-1420, 1, -280, -1020, 2, -120, 'stripeDark'));
addMirrorXDetail(box(-1420, 1, 120, -1020, 2, 280, 'stripeDark'));

// Runway markings and lip lights make the rail approach obvious from spawn.
addDetail(box(-96, 1, -1540, 96, 2, -820, 'stripeDark'));
addDetail(box(-180, 1, -1540, -164, 3, -820, 'edgeGlow'));
addDetail(box(164, 1, -1540, 180, 3, -820, 'edgeGlow'));
addDetail(box(-94, 1, -1558, 94, 2, -1462, 'titleMark'));

// ---------------------------------------------------------------------------
// Mirrored upper main floors, portal walls, and the armor bridge.
// ---------------------------------------------------------------------------

const upperLeft = [
  [-1780, -650],
  [-920, -650],
  [-760, -500],
  [-720, 660],
  [-940, 850],
  [-1580, 850],
  [-1780, 620],
  [-1780, -390],
] as const;
addMirrorXDeck(upperLeft, 152, 224);

const armorFrontBridgeLeft = [
  [-720, -140],
  [-260, -140],
  [-260, -36],
  [-720, -36],
] as const;
const armorRearBridge = [
  [-720, 300],
  [720, 300],
  [720, 430],
  [-720, 430],
] as const;
const armorLeftFrontConnector = [
  [-720, -36],
  [-520, -36],
  [-520, 40],
  [-720, 40],
] as const;
const armorLeftRearConnector = [
  [-720, 250],
  [-520, 250],
  [-520, 300],
  [-720, 300],
] as const;
addMirrorXDeck(armorFrontBridgeLeft, 160, 224);
addDeck(armorRearBridge, 160, 224);
addMirrorXDeck(armorLeftFrontConnector, 160, 224);
addMirrorXDeck(armorLeftRearConnector, 160, 224);

const armorPod = [
  [-300, 320],
  [300, 320],
  [380, 395],
  [380, 535],
  [300, 610],
  [-300, 610],
  [-380, 535],
  [-380, 395],
] as const;
addDeck(armorPod, 164, 228);

// Portal wall with a large doorway frame on each upper floor.
addMirrorXBrush(box(-1780, 224, 96, -1706, 500, 386, 'portalFrame'));
addMirrorXBrush(box(-1706, 224, 96, -1646, 384, 146, 'portalFrame'));
addMirrorXBrush(box(-1706, 224, 336, -1646, 384, 386, 'portalFrame'));
addMirrorXBrush(box(-1706, 384, 146, -1646, 462, 336, 'portalFrame'));

// Low cover on the bridge matches the classic crouchable armor cover.
addMirrorXBrush(box(-560, 224, -22, -392, 286, 28, 'wallDark'));
addMirrorXBrush(box(-560, 224, 338, -392, 286, 388, 'wallDark'));
addDetail(box(-220, 229, 356, 220, 230, 544, 'emblemRed'));
addMirrorXDetail(box(-1510, 225, -582, -960, 227, -542, 'trim'));
addMirrorXDetail(box(-1570, 225, 748, -1010, 227, 790, 'trim'));

// ---------------------------------------------------------------------------
// Four satellite mid platforms and the high power-up chain.
// ---------------------------------------------------------------------------

const midFrontLeft = [
  [-1480, -1340],
  [-1080, -1340],
  [-900, -1160],
  [-900, -850],
  [-1080, -690],
  [-1480, -690],
  [-1620, -850],
  [-1620, -1160],
] as const;
const midBackLeft = [
  [-1480, 790],
  [-1080, 790],
  [-900, 960],
  [-900, 1250],
  [-1080, 1420],
  [-1480, 1420],
  [-1620, 1250],
  [-1620, 960],
] as const;
addMirrorXDeck(midFrontLeft, 72, 128);
addMirrorXDeck(midBackLeft, 72, 128);

// A small cover strip on each satellite gives the rail porch a recognizable
// partial obstruction without hiding the whole arena.
addMirrorXBrush(box(-1525, 128, -1110, -1445, 196, -920, 'wallDark'));
addMirrorXBrush(box(-1525, 128, 1000, -1445, 196, 1190, 'wallDark'));
addMirrorXDetail(box(-1390, 129, -1320, -1160, 130, -1270, 'trimBlue'));
addMirrorXDetail(box(-1390, 129, 1350, -1160, 130, 1400, 'trimBlue'));

const megaPlatform = [
  [-230, 570],
  [230, 570],
  [330, 670],
  [330, 840],
  [230, 940],
  [-230, 940],
  [-330, 840],
  [-330, 670],
] as const;
addDeck(megaPlatform, 320, 384);

const powerBoost = [
  [-575, 895],
  [-345, 895],
  [-292, 948],
  [-292, 1102],
  [-345, 1155],
  [-575, 1155],
  [-628, 1102],
  [-628, 948],
] as const;
addDeck(powerBoost, 392, 448);

const powerPlatform = [
  [-280, 1220],
  [280, 1220],
  [390, 1330],
  [390, 1570],
  [280, 1680],
  [-280, 1680],
  [-390, 1570],
  [-390, 1330],
] as const;
addDeck(powerPlatform, 584, 648);

addDetail(box(-150, 385, 660, 150, 386, 850, 'emblemBlue'));
addDetail(box(-550, 449, 940, -370, 450, 1110, 'titleMark'));
addDetail(box(-170, 649, 1326, 170, 650, 1560, 'emblemBlue'));

// ---------------------------------------------------------------------------
// The isolated railgun porch and its return pads.
// ---------------------------------------------------------------------------

const railPlatform = [
  [-620, -2720],
  [620, -2720],
  [770, -2565],
  [770, -2140],
  [560, -1925],
  [-560, -1925],
  [-770, -2140],
  [-770, -2565],
] as const;
addDeck(railPlatform, 40, 96);

const railLowerPad = [
  [-300, -1880],
  [300, -1880],
  [380, -1800],
  [380, -1650],
  [300, -1570],
  [-300, -1570],
  [-380, -1650],
  [-380, -1800],
] as const;
addDeck(railLowerPad, 8, 56);

addDetail(box(-285, 97, -2550, 285, 98, -2325, 'titleMark'));
addDetail(box(-150, 57, -1848, 150, 58, -1590, 'stripeDark'));
addMirrorXBrush(box(-740, 96, -2440, -660, 168, -2200, 'wallDark'));
addMirrorXBrush(box(-500, 96, -2720, -330, 156, -2660, 'wallDark'));
addMirrorXDetail(box(-650, 97, -2000, -330, 98, -1958, 'trimRed'));

// ---------------------------------------------------------------------------
// Jump-pad network.
// ---------------------------------------------------------------------------

// Lower five-pad hub: mega, upper floors, armor bridge, and rail porch.
addPad(0, 0, 0, 58, vec3(0, 905, 455));
addPad(-420, 0, 130, 50, vec3(-760, 690, 120));
addPad(420, 0, 130, 50, vec3(760, 690, 120));
addPad(0, 0, -300, 50, vec3(0, 700, 510));
addPad(0, 0, -1500, 54, vec3(0, 790, -460));

// Chained power-up route at the back of the base.
addPad(-470, 0, 520, 48, vec3(20, 880, 360));
addPad(-460, 448, 1025, 46, vec3(290, 760, 250));

// Upper floors to the four satellite platforms.
addPad(-1190, 224, -535, 46, vec3(0, 545, -430));
addPad(1190, 224, -535, 46, vec3(0, 545, -430));
addPad(-1190, 224, 735, 46, vec3(0, 545, 360));
addPad(1190, 224, 735, 46, vec3(0, 545, 360));

// Satellite platforms back to the large upper floors.
addPad(-1260, 128, -1260, 44, vec3(-50, 620, 705));
addPad(1260, 128, -1260, 44, vec3(50, 620, 705));
addPad(-1260, 128, 1340, 44, vec3(-50, 620, -615));
addPad(1260, 128, 1340, 44, vec3(50, 620, -615));

// Rail porch return pads to the mirrored upper floors.
addPad(-315, 96, -2395, 50, vec3(-420, 900, 985));
addPad(315, 96, -2395, 50, vec3(420, 900, 985));

// Small accelerators across the paired satellite platforms.
addPad(-930, 128, -1015, 38, vec3(1680, 520, 0));
addPad(930, 128, -1015, 38, vec3(-1680, 520, 0));
addPad(-930, 128, 1105, 38, vec3(1680, 520, 0));
addPad(930, 128, 1105, 38, vec3(-1680, 520, 0));

// ---------------------------------------------------------------------------
// Teleporters: two upper walls and the top power-up platform, all to armor.
// ---------------------------------------------------------------------------

const upperLeftPortal: PortalDef = {
  id: 0,
  trigger: { min: vec3(-1684, 224, 158), max: vec3(-1618, 394, 324) },
  center: vec3(-1648, 308, 240),
  radius: 62,
  faceYaw: -PI / 2,
  exitPos: vec3(-85, 236.25, 451),
  exitYaw: -PI / 2,
  accent: 'red',
  tilt: 0.08,
};

const portals: PortalDef[] = [
  upperLeftPortal,
  mirrorXPortal(upperLeftPortal, 1),
  {
    id: 2,
    trigger: { min: vec3(-78, 648, 1604), max: vec3(78, 816, 1674) },
    center: vec3(0, 732, 1640),
    radius: 60,
    faceYaw: 0,
    exitPos: vec3(0, 236.25, 451),
    exitYaw: PI,
    accent: 'blue',
    tilt: 0.08,
  },
];

addBrush(box(-100, 648, 1600, -70, 824, 1688, 'portalFrame'));
addBrush(box(70, 648, 1600, 100, 824, 1688, 'portalFrame'));
addBrush(box(-100, 790, 1660, 100, 830, 1688, 'portalFrame'));

// ---------------------------------------------------------------------------
// Spawns, lighting, and anti-grav thrusters.
// ---------------------------------------------------------------------------

const halfSpawns: SpawnDef[] = [
  spawnFacingCenter(-360, 0.25, 250),
  spawnFacingCenter(-610, 0.25, -510),
  spawnFacingCenter(-1030, 0.25, 430),
  spawnFacingCenter(-1220, 0.25, -250),
  spawnFacingCenter(-1280, 0.25, -120),
  spawnFacingCenter(-1220, 0.25, 250),
  spawnFacingCenter(-1560, 224.25, -520),
  spawnFacingCenter(-1290, 224.25, -330),
  spawnFacingCenter(-1260, 224.25, 520),
  spawnFacingCenter(-1500, 224.25, 700),
  spawnFacingCenter(-1270, 128.25, -1010),
  spawnFacingCenter(-1460, 128.25, -1280),
  spawnFacingCenter(-1040, 128.25, -860),
  spawnFacingCenter(-1270, 128.25, 1110),
  spawnFacingCenter(-1460, 128.25, 1380),
  spawnFacingCenter(-1160, 128.25, 900),
];
const spawns: SpawnDef[] = [
  ...halfSpawns,
  ...halfSpawns.map(mirrorXSpawn),
  spawnFacingCenter(-220, 56.25, -1780),
  spawnFacingCenter(0, 56.25, -1690),
  spawnFacingCenter(220, 56.25, -1780),
  spawnFacingCenter(-420, 96.25, -2540),
  spawnFacingCenter(0, 96.25, -2390),
  spawnFacingCenter(420, 96.25, -2540),
  spawnFacingCenter(-220, 384.25, 755),
  spawnFacingCenter(220, 384.25, 755),
  spawnFacingCenter(-540, 448.25, 940),
  spawnFacingCenter(-210, 648.25, 1325),
  spawnFacingCenter(0, 648.25, 1435),
  spawnFacingCenter(210, 648.25, 1540),
  spawnFacingCenter(0, 228.25, 451),
];

const halfLights: LightDef[] = [
  { pos: vec3(-520, 270, -80), color: 0xe8dfd2, intensity: 0.9, range: 1100 },
  { pos: vec3(-1320, 450, 250), color: 0xd5e8ff, intensity: 1.0, range: 930 },
  { pos: vec3(-1260, 305, -1010), color: 0xd5e8ff, intensity: 0.72, range: 760 },
  { pos: vec3(-1260, 305, 1110), color: 0xd5e8ff, intensity: 0.72, range: 760 },
  { pos: vec3(-1648, 332, 240), color: 0xff6644, intensity: 1.1, range: 500 },
];
const lights: LightDef[] = [
  ...halfLights,
  ...halfLights.map(mirrorXLight),
  { pos: vec3(0, 330, -40), color: 0xe8dfd2, intensity: 1.0, range: 1300 },
  { pos: vec3(0, 355, -2300), color: 0xc7dbff, intensity: 0.95, range: 1100 },
  { pos: vec3(0, 520, 760), color: 0x99d6ff, intensity: 0.9, range: 780 },
  { pos: vec3(0, 780, 1450), color: 0x86c8ff, intensity: 1.0, range: 820 },
];

const thrusters: Vec3[] = [
  vec3(-620, -138, -520),
  vec3(620, -138, -520),
  vec3(-650, -138, 500),
  vec3(650, -138, 500),
  vec3(-1320, -90, -120),
  vec3(1320, -90, -120),
  vec3(-1300, 130, -500),
  vec3(1300, 130, -500),
  vec3(-1300, 130, 700),
  vec3(1300, 130, 700),
  vec3(-1260, 48, -1010),
  vec3(1260, 48, -1010),
  vec3(-1260, 48, 1110),
  vec3(1260, 48, 1110),
  vec3(0, -86, -1120),
  vec3(0, -18, -2350),
  vec3(0, 292, 760),
  vec3(-460, 358, 1025),
  vec3(0, 540, 1450),
];

export const longestYard: MapDef = {
  name: 'longestyard',
  displayName: 'The Longest Yard',
  brushes,
  prisms,
  details,
  detailPrisms,
  jumpPads,
  portals,
  spawns,
  lights,
  ambient: 0.48,
  fogColor: 0x05060c,
  fogDensity: 0,
  bounds: { min: vec3(-1980, -760, -2860), max: vec3(1980, 1240, 1780) },
  space: true,
  thrusters,
};
