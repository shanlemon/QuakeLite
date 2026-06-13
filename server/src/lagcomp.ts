// ---------------------------------------------------------------------------
// Server-side lag compensation: a per-player ring buffer of historical feet
// positions, recorded once per 60 Hz tick. When resolving a hitscan shot the
// server rewinds every potential victim to the shooter's perceived time
// (cmd.interpTime) by lerping between the two recorded ticks that bracket it,
// clamped to at most GAME.LAGCOMP_MAX_REWIND_MS into the past.
// ---------------------------------------------------------------------------

import { GAME } from '../../shared/constants';
import { clamp, lerp, type Vec3 } from '../../shared/math';

/** 96 ticks ≈ 1.6 s at 60 Hz — comfortably more than LAGCOMP_MAX_REWIND_MS. */
const CAPACITY = 96;

export class LagCompHistory {
  private readonly times = new Float64Array(CAPACITY);
  private readonly px = new Float64Array(CAPACITY);
  private readonly py = new Float64Array(CAPACITY);
  private readonly pz = new Float64Array(CAPACITY);
  private readonly alive = new Uint8Array(CAPACITY);
  private readonly teleport = new Uint8Array(CAPACITY);
  /** Next slot to write. */
  private head = 0;
  private count = 0;

  /** Drop all history (call on respawn so stale pre-death positions can't be hit). */
  reset(): void {
    this.head = 0;
    this.count = 0;
  }

  /** Record one tick of state. `time` must be monotonically non-decreasing. */
  record(time: number, pos: Vec3, alive: boolean, teleportCount = 0): void {
    const i = this.head;
    this.times[i] = time;
    this.px[i] = pos.x;
    this.py[i] = pos.y;
    this.pz[i] = pos.z;
    this.alive[i] = alive ? 1 : 0;
    this.teleport[i] = teleportCount & 0xff;
    this.head = (i + 1) % CAPACITY;
    if (this.count < CAPACITY) this.count++;
  }

  /**
   * Rewound position at `time`, written into `out`. The requested time is
   * clamped to [newest - LAGCOMP_MAX_REWIND_MS, newest]; between recorded
   * ticks the position is linearly interpolated (but never across a portal
   * teleport — that would sweep the hitbox through the map). Returns false if
   * there is no usable history (empty, or the player was dead at that time).
   */
  query(time: number, out: Vec3): boolean {
    if (this.count === 0) return false;
    const newest = this.idx(0);
    const newestTime = this.times[newest]!;
    const t = clamp(time, newestTime - GAME.LAGCOMP_MAX_REWIND_MS, newestTime);

    // Walk back from the newest entry to find the latest sample at-or-before t.
    let after = newest;
    for (let n = 0; n < this.count; n++) {
      const i = this.idx(n);
      if (this.times[i]! <= t) {
        if (!this.alive[i]) return false;
        if (i === after) return this.read(i, out); // t is at/after the newest sample
        if (!this.alive[after]) return false;
        if (this.teleport[i] !== this.teleport[after]) return this.read(after, out);
        const t0 = this.times[i]!;
        const t1 = this.times[after]!;
        const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
        out.x = lerp(this.px[i]!, this.px[after]!, f);
        out.y = lerp(this.py[i]!, this.py[after]!, f);
        out.z = lerp(this.pz[i]!, this.pz[after]!, f);
        return true;
      }
      after = i;
    }

    // Older than everything we kept: clamp to the oldest sample.
    const oldest = this.idx(this.count - 1);
    return this.alive[oldest] ? this.read(oldest, out) : false;
  }

  /** Ring index of the entry `back` steps behind the newest. */
  private idx(back: number): number {
    return (this.head - 1 - back + CAPACITY * 2) % CAPACITY;
  }

  private read(i: number, out: Vec3): boolean {
    out.x = this.px[i]!;
    out.y = this.py[i]!;
    out.z = this.pz[i]!;
    return true;
  }
}
