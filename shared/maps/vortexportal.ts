// ---------------------------------------------------------------------------
// Vortex Portal — faithful recreation of Quake Live's "vortexportal"
// (originally Quake III: Team Arena mpteam6, id Software).
//
// The real map is a SPACE FLOATER: three separate platform clusters hanging
// in a starfield void — RED base (z<0), BLUE base (z>0) and a neutral
// CENTRAL platform riding anti-grav thrusters at the origin, floating higher
// than the bases. There is NO walkable route between clusters; the only
// transit is the giant swirling vortex portals:
//
//   per base:  two FLANK portals (west/east pedestal stations) that teleport
//              you straight to a drop above the ENEMY middle deck, and one
//              floating MID portal above the flag deck that a launch pad
//              throws you up into, exiting above the CENTRAL platform.
//   central:   one portal back to EACH base (drop above its flag deck).
//
// Portal exits are airborne — you drop onto the destination deck, exactly
// like the original. Every deck edge falls into killing void (the server
// treats leaving MapDef.bounds as a suicide).
//
// Base anatomy (matching the original's HUD area names): a long top FLAG
// deck (with the painted team emblem), a MIDDLE deck below it toward the map
// center (the enemy drop-in zone), a separate RAIL wing platform, and a
// small SCOUT platform below-right of the flag deck. Decks are thin slabs
// with fascia sides and neon trim bands, hopped between on launch pads.
//
// Exact 180° rotational symmetry about the Y axis: the red half (plus the
// north half of the central platform) is authored once and mirrored with
// (x, z) -> (-x, -z), red<->blue accent swaps and yaw+PI rotations.
// ---------------------------------------------------------------------------

import { vec3, wrapAngle, type Vec3 } from '../math';
import type {
  MapDef,
  Brush,
  MaterialName,
  JumpPadDef,
  PortalDef,
  SpawnDef,
  LightDef,
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

// Red-side accents become blue-side accents in the mirrored half.
const MAT_MIRROR: Partial<Record<MaterialName, MaterialName>> = {
  trimRed: 'trimBlue',
  trimBlue: 'trimRed',
  glowRed: 'glowBlue',
  glowBlue: 'glowRed',
  emblemRed: 'emblemBlue',
  emblemBlue: 'emblemRed',
  triangleRed: 'triangleBlue',
  triangleBlue: 'triangleRed',
};

// Team-tinted light colors swap with their counterpart; neutrals map to self.
const LIGHT_MIRROR = new Map<number, number>([
  [0xff5533, 0x3377ff],
  [0x3377ff, 0xff5533],
  [0xff6644, 0x4488ff],
  [0x4488ff, 0xff6644],
]);

const mirrorVec = (v: Vec3): Vec3 => vec3(-v.x, v.y, -v.z);

function mirrorBrush(b: Brush): Brush {
  return {
    min: vec3(-b.max.x, b.min.y, -b.max.z),
    max: vec3(-b.min.x, b.max.y, -b.min.z),
    mat: MAT_MIRROR[b.mat] ?? b.mat,
  };
}

function mirrorPad(p: JumpPadDef): JumpPadDef {
  return {
    trigger: {
      min: vec3(-p.trigger.max.x, p.trigger.min.y, -p.trigger.max.z),
      max: vec3(-p.trigger.min.x, p.trigger.max.y, -p.trigger.min.z),
    },
    velocity: vec3(-p.velocity.x, p.velocity.y, -p.velocity.z),
    padTop: mirrorVec(p.padTop),
  };
}

function mirrorPortal(p: PortalDef, idOffset: number): PortalDef {
  return {
    id: p.id + idOffset,
    trigger: {
      min: vec3(-p.trigger.max.x, p.trigger.min.y, -p.trigger.max.z),
      max: vec3(-p.trigger.min.x, p.trigger.max.y, -p.trigger.min.z),
    },
    center: mirrorVec(p.center),
    radius: p.radius,
    faceYaw: wrapAngle(p.faceYaw + PI),
    exitPos: mirrorVec(p.exitPos),
    exitYaw: wrapAngle(p.exitYaw + PI),
    accent: p.accent === 'red' ? 'blue' : 'red',
    ...(p.tilt !== undefined ? { tilt: p.tilt } : {}),
  };
}

function mirrorSpawn(s: SpawnDef): SpawnDef {
  return { pos: mirrorVec(s.pos), yaw: wrapAngle(s.yaw + PI) };
}

function mirrorLight(l: LightDef): LightDef {
  return {
    pos: mirrorVec(l.pos),
    color: LIGHT_MIRROR.get(l.color) ?? l.color,
    intensity: l.intensity,
    range: l.range,
  };
}

// ---------------------------------------------------------------------------
// Authored half: RED base cluster + north half of the CENTRAL platform.
// ---------------------------------------------------------------------------

const half: Brush[] = [];
const halfDetails: Brush[] = [];

// ==== RED FLAG DECK (top deck, surface y=160) ===============================
// 832 × 448 footprint, thin slab: fascia sides + pale panel top + neon trim.
half.push(box(-416, 96, -1872, 416, 152, -1424, 'wall')); // fascia slab
half.push(box(-416, 152, -1872, 416, 160, -1424, 'floor')); // walk surface
// Neon trim bands along the top edges (red team accent).
half.push(box(-416, 160, -1872, 416, 168, -1864, 'trimRed')); // north edge
half.push(box(-416, 160, -1432, 416, 168, -1424, 'trimRed')); // south edge
half.push(box(-416, 160, -1864, -408, 168, -1432, 'trimRed')); // west edge
half.push(box(408, 160, -1864, 416, 168, -1432, 'trimRed')); // east edge
// Grate strips running the deck's long axis (1u proud, walkable).
half.push(box(-360, 160, -1864, -296, 161, -1432, 'floorAlt'));
half.push(box(296, 160, -1864, 360, 161, -1432, 'floorAlt'));
// Painted team emblem inlay (square so the decal isn't stretched).
half.push(box(-96, 160, -1744, 96, 162, -1552, 'emblemRed'));
// Mid launch pad housing (feeds the floating mid portal overhead).
half.push(box(-36, 160, -1820, 36, 166, -1748, 'padBase'));

// ==== RED MIDDLE DECK (surface y=0, toward map center) ======================
half.push(box(-288, -56, -1424, 288, -8, -1104, 'wall'));
half.push(box(-288, -8, -1424, 288, 0, -1104, 'floor'));
half.push(box(-288, 0, -1424, 288, 8, -1416, 'trimRed'));
half.push(box(-288, 0, -1112, 288, 8, -1104, 'trimRed'));
half.push(box(-288, 0, -1416, -280, 8, -1112, 'trimRed'));
half.push(box(280, 0, -1416, 288, 8, -1112, 'trimRed'));
// Launch pad housings: two up to the flag deck (kept well clear of the deck
// edge so the 56u player box clears the trim band mid-arc), two out to the
// flank stations.
half.push(box(-188, 0, -1366, -116, 6, -1294, 'padBase'));
half.push(box(116, 0, -1366, 188, 6, -1294, 'padBase'));
half.push(box(-288, 0, -1336, -216, 6, -1264, 'padBase'));
half.push(box(216, 0, -1336, 288, 6, -1264, 'padBase'));

// ==== RED RAIL WING (separate platform west, surface y=80) ==================
half.push(box(-784, 24, -1776, -496, 72, -1488, 'wall'));
half.push(box(-784, 72, -1776, -496, 80, -1488, 'floor'));
half.push(box(-784, 80, -1776, -496, 88, -1768, 'trimRed'));
half.push(box(-784, 80, -1496, -496, 88, -1488, 'trimRed'));
half.push(box(-784, 80, -1768, -776, 88, -1496, 'trimRed'));
half.push(box(-504, 80, -1768, -496, 88, -1496, 'trimRed'));
half.push(box(-676, 80, -1668, -604, 86, -1596, 'padBase')); // pad → flag deck
half.push(box(-668, 80, -1740, -612, 81, -1684, 'metal')); // rail spawn grate

// ==== RED SCOUT WING (small low platform east, surface y=16) ================
half.push(box(448, -40, -1696, 672, 8, -1440, 'wall'));
half.push(box(448, 8, -1696, 672, 16, -1440, 'floor'));
half.push(box(448, 16, -1696, 672, 24, -1688, 'trim'));
half.push(box(448, 16, -1448, 672, 24, -1440, 'trim'));
half.push(box(524, 16, -1606, 596, 22, -1534, 'padBase')); // pad → flag deck

// ==== RED FLANK PORTAL STATIONS (west + east, surface y=64) =================
// West station: pedestal deck + upright billboard-gate housing facing east.
half.push(box(-688, 16, -1408, -496, 56, -1232, 'wall'));
half.push(box(-688, 56, -1408, -496, 64, -1232, 'floor'));
half.push(box(-688, 64, -1408, -496, 72, -1400, 'trimRed'));
half.push(box(-688, 64, -1240, -496, 72, -1232, 'trimRed'));
half.push(box(-688, 64, -1392, -672, 280, -1248, 'portalFrame')); // back panel
half.push(box(-672, 64, -1392, -656, 248, -1368, 'portalFrame')); // north col
half.push(box(-672, 64, -1272, -656, 248, -1248, 'portalFrame')); // south col
half.push(box(-672, 232, -1368, -656, 264, -1272, 'portalFrame')); // lintel
half.push(box(-672, 64, -1368, -656, 70, -1272, 'glowRed')); // sill glow strip
// East station (authored too — the map mirror makes the BLUE pair).
half.push(box(496, 16, -1408, 688, 56, -1232, 'wall'));
half.push(box(496, 56, -1408, 688, 64, -1232, 'floor'));
half.push(box(496, 64, -1408, 688, 72, -1400, 'trimRed'));
half.push(box(496, 64, -1240, 688, 72, -1232, 'trimRed'));
half.push(box(672, 64, -1392, 688, 280, -1248, 'portalFrame'));
half.push(box(656, 64, -1392, 672, 248, -1368, 'portalFrame'));
half.push(box(656, 64, -1272, 672, 248, -1248, 'portalFrame'));
half.push(box(656, 232, -1368, 672, 264, -1272, 'portalFrame'));
half.push(box(656, 64, -1368, 672, 70, -1272, 'glowRed'));

// ==== CENTRAL PLATFORM, north half (neutral, surface y=352) =================
// Core (authored z<0 half; the mirror completes it, flush at z=0).
half.push(box(-224, 304, -224, 224, 344, 0, 'wall'));
half.push(box(-224, 344, -224, 224, 352, 0, 'floor'));
// North edge extension (full); east/west south quarters (mirror completes).
half.push(box(-144, 304, -304, 144, 344, -224, 'wall'));
half.push(box(-144, 344, -304, 144, 352, -224, 'floor'));
half.push(box(224, 304, -144, 304, 344, 0, 'wall'));
half.push(box(224, 344, -144, 304, 352, 0, 'floor'));
half.push(box(-304, 304, -144, -224, 344, 0, 'wall'));
half.push(box(-304, 344, -144, -224, 352, 0, 'floor'));
// Neutral cyan neon trim along the outer edges.
half.push(box(-144, 352, -304, 144, 360, -296, 'trim')); // north ext edge
half.push(box(-224, 352, -232, -144, 360, -224, 'trim'));
half.push(box(144, 352, -232, 224, 360, -224, 'trim'));
half.push(box(296, 352, -144, 304, 360, 0, 'trim'));
half.push(box(-304, 352, -144, -296, 360, 0, 'trim'));
// Powerup pedestal at the very center (mirror completes the +z half).
half.push(box(-28, 352, -28, 28, 372, 0, 'pillar'));
half.push(box(-24, 372, -24, 24, 378, 0, 'glowWhite'));
// Hop pad toward the north portal station.
half.push(box(-116, 352, -168, -44, 358, -96, 'padBase'));
// North portal station: jutting deck + housing facing the platform.
half.push(box(-88, 304, -400, 88, 344, -304, 'wall'));
half.push(box(-88, 344, -400, 88, 352, -304, 'floor'));
half.push(box(-88, 352, -404, 88, 568, -388, 'portalFrame')); // back panel
half.push(box(-88, 352, -388, -72, 536, -372, 'portalFrame')); // west col
half.push(box(72, 352, -388, 88, 536, -372, 'portalFrame')); // east col
half.push(box(-72, 520, -388, 72, 552, -372, 'portalFrame')); // lintel
half.push(box(-72, 352, -388, 72, 358, -372, 'glowRed')); // sill glow

// ---------------------------------------------------------------------------
// Render-only Quake Live detail layer. These thin decals and lips are kept
// out of collision so the VQ3 movement tests stay tied to the authored solids.
// ---------------------------------------------------------------------------

// Flag deck: black runway slots, orange title lettering, triangular team mark
// and a bright cyan-white edge lip from the Quake Live levelshot.
halfDetails.push(box(-34, 162.4, -1848, -18, 163.4, -1450, 'stripeDark'));
halfDetails.push(box(18, 162.4, -1848, 34, 163.4, -1450, 'stripeDark'));
halfDetails.push(box(112, 162.8, -1740, 352, 163.8, -1544, 'titleMark'));
halfDetails.push(box(-382, 162.8, -1548, -270, 163.8, -1436, 'triangleRed'));
halfDetails.push(box(-424, 168, -1880, 424, 174, -1872, 'edgeGlow'));
halfDetails.push(box(-424, 168, -1424, 424, 174, -1416, 'edgeGlow'));
halfDetails.push(box(-424, 168, -1872, -416, 174, -1424, 'edgeGlow'));
halfDetails.push(box(416, 168, -1872, 424, 174, -1424, 'edgeGlow'));

// Middle deck drop zone: the same inset grooves and team identifier markings
// visible around the Vortex Portal lower platforms.
halfDetails.push(box(-28, 2, -1392, -14, 3, -1140, 'stripeDark'));
halfDetails.push(box(14, 2, -1392, 28, 3, -1140, 'stripeDark'));
halfDetails.push(box(70, 2.4, -1352, 270, 3.4, -1196, 'titleMark'));
halfDetails.push(box(-258, 2.4, -1406, -166, 3.4, -1314, 'triangleRed'));
halfDetails.push(box(-296, 8, -1432, 296, 14, -1424, 'edgeGlow'));
halfDetails.push(box(-296, 8, -1104, 296, 14, -1096, 'edgeGlow'));
halfDetails.push(box(-296, 8, -1424, -288, 14, -1104, 'edgeGlow'));
halfDetails.push(box(288, 8, -1424, 296, 14, -1104, 'edgeGlow'));

// Wing platforms use small white lips and team triangles so their silhouettes
// match the elevated side decks in the reference shots.
halfDetails.push(box(-792, 88, -1784, -488, 94, -1776, 'edgeGlow'));
halfDetails.push(box(-792, 88, -1488, -488, 94, -1480, 'edgeGlow'));
halfDetails.push(box(-792, 88, -1776, -784, 94, -1488, 'edgeGlow'));
halfDetails.push(box(-496, 88, -1776, -488, 94, -1488, 'edgeGlow'));
halfDetails.push(box(-764, 82, -1534, -692, 83, -1462, 'triangleRed'));
halfDetails.push(box(440, 24, -1704, 680, 30, -1696, 'edgeGlow'));
halfDetails.push(box(440, 24, -1440, 680, 30, -1432, 'edgeGlow'));
halfDetails.push(box(440, 24, -1696, 448, 30, -1440, 'edgeGlow'));
halfDetails.push(box(672, 24, -1696, 680, 30, -1440, 'edgeGlow'));

// Portal station face cards: ornate blue/copper panels behind the swirl discs.
halfDetails.push(box(-655.5, 78, -1380, -654.5, 248, -1260, 'portalCircuit'));
halfDetails.push(box(654.5, 78, -1380, 655.5, 248, -1260, 'portalCircuit'));
halfDetails.push(box(-76, 366, -371.5, 76, 536, -370.5, 'portalCircuit'));

// Central platform: white/cyan lips and paired black insets make the high
// thruster deck read like the QL center platform from the levelshot.
halfDetails.push(box(-152, 360, -312, 152, 366, -304, 'edgeGlow'));
halfDetails.push(box(304, 360, -152, 312, 366, 0, 'edgeGlow'));
halfDetails.push(box(-312, 360, -152, -304, 366, 0, 'edgeGlow'));
halfDetails.push(box(-120, 354, -248, -104, 355, -28, 'stripeDark'));
halfDetails.push(box(104, 354, -248, 120, 355, -28, 'stripeDark'));

// Freestanding side billboard and mast. The reference levelshot has a large
// vertical Quake Live sign just off the deck edge with a lit support pole.
halfDetails.push(box(920, 56, -1860, 936, 536, -1380, 'qlSign'));
halfDetails.push(box(944, -46, -1644, 968, 560, -1604, 'pillar'));
halfDetails.push(box(940, -70, -1656, 972, -46, -1592, 'glowWhite'));

const brushes: Brush[] = [...half, ...half.map(mirrorBrush)];
const details: Brush[] = [...halfDetails, ...halfDetails.map(mirrorBrush)];

// ---------------------------------------------------------------------------
// Launch pads (authored red/north set; mirrored for blue/south).
// ---------------------------------------------------------------------------

const halfPads: JumpPadDef[] = [
  // Flag-deck mid pad: throws the player up through the floating mid portal.
  {
    trigger: { min: vec3(-36, 158, -1820), max: vec3(36, 198, -1748) },
    velocity: vec3(0, 700, 0),
    padTop: vec3(0, 166, -1784),
  },
  // Middle deck → flag deck (west + east pads).
  {
    trigger: { min: vec3(-188, -2, -1366), max: vec3(-116, 38, -1294) },
    velocity: vec3(0, 600, -160),
    padTop: vec3(-152, 6, -1330),
  },
  {
    trigger: { min: vec3(116, -2, -1366), max: vec3(188, 38, -1294) },
    velocity: vec3(0, 600, -160),
    padTop: vec3(152, 6, -1330),
  },
  // Middle deck → west / east flank portal stations (crosses a void gap).
  {
    trigger: { min: vec3(-288, -2, -1336), max: vec3(-216, 38, -1264) },
    velocity: vec3(-360, 445, 0),
    padTop: vec3(-252, 6, -1300),
  },
  {
    trigger: { min: vec3(216, -2, -1336), max: vec3(288, 38, -1264) },
    velocity: vec3(360, 445, 0),
    padTop: vec3(252, 6, -1300),
  },
  // Rail wing → flag deck.
  {
    trigger: { min: vec3(-676, 78, -1668), max: vec3(-604, 118, -1596) },
    velocity: vec3(280, 473, 0),
    padTop: vec3(-640, 86, -1632),
  },
  // Scout wing → flag deck.
  {
    trigger: { min: vec3(524, 14, -1606), max: vec3(596, 54, -1534) },
    velocity: vec3(-170, 566, 0),
    padTop: vec3(560, 22, -1570),
  },
  // Central platform hop toward the north portal station (lands just short
  // of the gate so it never feeds the portal by itself).
  {
    trigger: { min: vec3(-116, 350, -168), max: vec3(-44, 390, -96) },
    velocity: vec3(0, 460, -140),
    padTop: vec3(-80, 358, -132),
  },
];

const jumpPads: JumpPadDef[] = [...halfPads, ...halfPads.map(mirrorPad)];

// ---------------------------------------------------------------------------
// Portals. Authored ids 0..3 (red flanks, red mid, central->red); the mirror
// adds 4..7 (blue flanks, blue mid, central->blue).
// ---------------------------------------------------------------------------

const halfPortals: PortalDef[] = [
  // 0: RED WEST FLANK — run west into the gate, drop above BLUE middle deck
  // moving east (toward that deck's center).
  {
    id: 0,
    trigger: { min: vec3(-672, 64, -1360), max: vec3(-640, 240, -1280) },
    center: vec3(-666, 152, -1320),
    radius: 56,
    faceYaw: -PI / 2, // front normal +x, facing the approach
    exitPos: vec3(-144, 140, 1264),
    exitYaw: -PI / 2, // exit travelling +x
    accent: 'red',
    tilt: 0.22,
  },
  // 1: RED EAST FLANK — mirror-in-base of 0; drops above BLUE middle deck
  // east half moving west.
  {
    id: 1,
    trigger: { min: vec3(640, 64, -1360), max: vec3(672, 240, -1280) },
    center: vec3(666, 152, -1320),
    radius: 56,
    faceYaw: PI / 2,
    exitPos: vec3(144, 140, 1264),
    exitYaw: PI / 2,
    accent: 'red',
    tilt: 0.22,
  },
  // 2: RED MID — floating disc above the flag deck's launch pad; exits in a
  // high drop over the central platform.
  {
    id: 2,
    trigger: { min: vec3(-72, 380, -1820), max: vec3(72, 460, -1748) },
    center: vec3(0, 420, -1784),
    radius: 64,
    faceYaw: PI, // faces the map center
    exitPos: vec3(0, 470, -120),
    exitYaw: PI,
    accent: 'red',
  },
  // 3: CENTRAL NORTH — on the north station, drops above the RED flag deck
  // moving east along the deck's long axis.
  {
    id: 3,
    trigger: { min: vec3(-72, 352, -388), max: vec3(72, 536, -356) },
    center: vec3(0, 448, -386),
    radius: 64,
    faceYaw: PI,
    exitPos: vec3(0, 290, -1648),
    exitYaw: -PI / 2,
    accent: 'red',
    tilt: 0.18,
  },
];

const portals: PortalDef[] = [...halfPortals, ...halfPortals.map((p) => mirrorPortal(p, 4))];

// ---------------------------------------------------------------------------
// Spawns (6 authored → 12 total), lights, thrusters.
// ---------------------------------------------------------------------------

const halfSpawns: SpawnDef[] = [
  { pos: vec3(-260, 160.25, -1648), yaw: -PI / 2 }, // flag deck west, facing east
  { pos: vec3(260, 160.25, -1648), yaw: PI / 2 }, // flag deck east, facing west
  { pos: vec3(0, 0.25, -1180), yaw: 0 }, // middle deck, facing own base
  { pos: vec3(-640, 80.25, -1560), yaw: -PI / 2 }, // rail wing
  { pos: vec3(620, 16.25, -1480), yaw: PI / 2 }, // scout wing
  { pos: vec3(160, 352.25, -80), yaw: PI / 2 }, // central, facing the pedestal
];
const spawns: SpawnDef[] = [...halfSpawns, ...halfSpawns.map(mirrorSpawn)];

const halfLights: LightDef[] = [
  { pos: vec3(0, 560, -1648), color: 0xdfe8ff, intensity: 1.1, range: 1400 }, // flag deck fill
  { pos: vec3(0, 300, -1264), color: 0xcfdcff, intensity: 0.9, range: 900 }, // middle deck fill
  { pos: vec3(-640, 320, -1632), color: 0xcfdcff, intensity: 0.7, range: 600 }, // rail wing fill
  { pos: vec3(-620, 200, -1320), color: 0xff5533, intensity: 1.2, range: 500 }, // W flank accent
  { pos: vec3(620, 200, -1320), color: 0xff5533, intensity: 1.2, range: 500 }, // E flank accent
  { pos: vec3(0, 480, -1784), color: 0x66ccff, intensity: 1.3, range: 600 }, // mid portal glow
  { pos: vec3(0, 620, -180), color: 0xe6eeff, intensity: 1.0, range: 1000 }, // central fill
  { pos: vec3(0, 460, -340), color: 0xff6644, intensity: 1.1, range: 450 }, // N station accent
  { pos: vec3(0, 250, -60), color: 0xb088ff, intensity: 1.4, range: 700 }, // under-central violet
];
const lights: LightDef[] = [...halfLights, ...halfLights.map(mirrorLight)];

const halfThrusters: Vec3[] = [
  vec3(-140, 286, -140), // central (NW + NE authored; mirror adds the south pair)
  vec3(140, 286, -140),
  vec3(-240, 70, -1648), // under the red flag deck
  vec3(240, 70, -1648),
  vec3(0, -70, -1264), // under the red middle deck
  vec3(-640, 0, -1632), // under the rail wing
];
const thrusters: Vec3[] = [...halfThrusters, ...halfThrusters.map(mirrorVec)];

// ---------------------------------------------------------------------------

export const vortexPortal: MapDef = {
  name: 'vortexportal',
  displayName: 'Vortex Portal',
  brushes,
  details,
  jumpPads,
  portals,
  spawns,
  lights,
  ambient: 0.5,
  fogColor: 0x05060c,
  fogDensity: 0, // open space — no fog
  bounds: { min: vec3(-1400, -560, -2100), max: vec3(1400, 1100, 2100) },
  space: true,
  thrusters,
};
