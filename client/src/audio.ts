// ---------------------------------------------------------------------------
// QuakeLite audio — everything synthesized at call time from oscillators and a
// shared 1s white-noise buffer. No audio files. Lazy AudioContext (browsers
// require a user gesture before audio can run; resume() is called on the
// pointer-lock click). Positional sounds go through a PannerNode; UI sounds go
// straight to the master gain.
// ---------------------------------------------------------------------------

import { vec3, yawForward, type Vec3 } from '../../shared/math';
import type { AudioSys, CreateAudio, SoundName } from './types';

const MAX_PER_SOUND = 6;

interface SoundEnv {
  c: AudioContext;
  out: AudioNode;
  t0: number;
  noise: AudioBuffer;
}

/** Gain node with a click-free attack and an exponential decay to silence. */
function envGain(c: AudioContext, t0: number, peak: number, dur: number, attack = 0.004): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  return g;
}

function noiseSrc(c: AudioContext, buf: AudioBuffer): AudioBufferSourceNode {
  const s = c.createBufferSource();
  s.buffer = buf;
  return s;
}

// Each builder wires its nodes into env.out and returns its duration (sec).
const SOUNDS: Record<SoundName, (env: SoundEnv) => number> = {
  // Signature railgun ZAP: noise crack + falling saw sweep + low thump.
  fire({ c, out, t0, noise }) {
    const n = noiseSrc(c, noise);
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1400;
    n.connect(hp).connect(envGain(c, t0, 0.8, 0.09, 0.001)).connect(out);
    n.start(t0);
    n.stop(t0 + 0.1);

    const saw = c.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.setValueAtTime(2400, t0);
    saw.frequency.exponentialRampToValueAtTime(180, t0 + 0.32);
    saw.connect(envGain(c, t0, 0.5, 0.32)).connect(out);
    saw.start(t0);
    saw.stop(t0 + 0.33);

    const thump = c.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(130, t0);
    thump.frequency.exponentialRampToValueAtTime(45, t0 + 0.16);
    thump.connect(envGain(c, t0, 0.55, 0.18)).connect(out);
    thump.start(t0);
    thump.stop(t0 + 0.2);
    return 0.33;
  },

  // Bright two-note UI ding.
  frag({ c, out, t0 }) {
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(880, t0);
    o.frequency.setValueAtTime(1318.5, t0 + 0.075);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.07);
    g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + 0.16);
    return 0.15;
  },

  // Filtered noise explosion + sub boom.
  death({ c, out, t0, noise }) {
    const n = noiseSrc(c, noise);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2000, t0);
    lp.frequency.exponentialRampToValueAtTime(200, t0 + 0.45);
    n.connect(lp).connect(envGain(c, t0, 0.9, 0.45)).connect(out);
    n.start(t0);
    n.stop(t0 + 0.46);

    const boom = c.createOscillator();
    boom.type = 'sine';
    boom.frequency.value = 60;
    boom.connect(envGain(c, t0, 0.7, 0.4)).connect(out);
    boom.start(t0);
    boom.stop(t0 + 0.42);
    return 0.45;
  },

  // Quick quiet "hup".
  jump({ c, out, t0 }) {
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(170, t0);
    o.frequency.linearRampToValueAtTime(260, t0 + 0.08);
    o.connect(envGain(c, t0, 0.18, 0.08)).connect(out);
    o.start(t0);
    o.stop(t0 + 0.09);
    return 0.08;
  },

  // Low landing thud.
  land({ c, out, t0, noise }) {
    const n = noiseSrc(c, noise);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    n.connect(lp).connect(envGain(c, t0, 0.4, 0.07, 0.002)).connect(out);
    n.start(t0);
    n.stop(t0 + 0.08);
    return 0.07;
  },

  // Tiny tick, filter freq jittered ±15% so steps don't machine-gun.
  footstep({ c, out, t0, noise }) {
    const n = noiseSrc(c, noise);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900 * (1 + (Math.random() * 0.3 - 0.15));
    bp.Q.value = 1.2;
    n.connect(bp).connect(envGain(c, t0, 0.14, 0.025, 0.001)).connect(out);
    n.start(t0);
    n.stop(t0 + 0.03);
    return 0.03;
  },

  // Springy jump-pad boing with vibrato.
  pad({ c, out, t0 }) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(180, t0);
    o.frequency.exponentialRampToValueAtTime(640, t0 + 0.28);
    const lfo = c.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 26;
    const lfoDepth = c.createGain();
    lfoDepth.gain.value = 22;
    lfo.connect(lfoDepth).connect(o.frequency);
    o.connect(envGain(c, t0, 0.4, 0.28, 0.008)).connect(out);
    o.start(t0);
    o.stop(t0 + 0.29);
    lfo.start(t0);
    lfo.stop(t0 + 0.29);
    return 0.28;
  },

  // Bandpass-swept whoosh + a faint high sine arpeggio shimmer.
  teleport({ c, out, t0, noise }) {
    const n = noiseSrc(c, noise);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(250, t0);
    bp.frequency.exponentialRampToValueAtTime(2800, t0 + 0.2);
    bp.frequency.exponentialRampToValueAtTime(250, t0 + 0.4);
    n.connect(bp).connect(envGain(c, t0, 0.55, 0.4, 0.01)).connect(out);
    n.start(t0);
    n.stop(t0 + 0.41);

    const shimmer = [1568, 2093, 2637];
    for (let i = 0; i < shimmer.length; i++) {
      const st = t0 + 0.05 + i * 0.11;
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = shimmer[i] ?? 2000;
      o.connect(envGain(c, st, 0.07, 0.09)).connect(out);
      o.start(st);
      o.stop(st + 0.1);
    }
    return 0.4;
  },

  // Rising three-note arpeggio.
  respawn({ c, out, t0 }) {
    const notes = [392, 523.25, 659.25]; // G4 C5 E5
    for (let i = 0; i < notes.length; i++) {
      const st = t0 + i * 0.085;
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = notes[i] ?? 440;
      o.connect(envGain(c, st, 0.25, 0.11, 0.006)).connect(out);
      o.start(st);
      o.stop(st + 0.12);
    }
    return 0.29;
  },

  // Detuned twin-saw horn through a lowpass.
  matchEnd({ c, out, t0 }) {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.02);
    g.gain.setValueAtTime(0.4, t0 + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    lp.connect(g).connect(out);
    for (const f of [220, 223]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start(t0);
      o.stop(t0 + 0.51);
    }
    return 0.5;
  },
};

export const createAudio: CreateAudio = (): AudioSys => {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noiseBuf: AudioBuffer | null = null;
  let masterVolume = 0.7;
  const active = new Map<SoundName, number>();
  const fwd = vec3();

  function ensure(): AudioContext | null {
    if (ctx) return ctx;
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = masterVolume;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function setPannerPos(p: PannerNode, pos: Vec3): void {
    if (p.positionX) {
      p.positionX.value = pos.x;
      p.positionY.value = pos.y;
      p.positionZ.value = pos.z;
    } else {
      // legacy Safari
      (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(
        pos.x,
        pos.y,
        pos.z,
      );
    }
  }

  return {
    resume(): void {
      const c = ensure();
      if (c && c.state !== 'running') void c.resume();
    },

    setListener(pos: Vec3, yaw: number): void {
      const c = ensure();
      if (!c) return;
      const l = c.listener;
      yawForward(yaw, fwd);
      if (l.forwardX) {
        l.positionX.value = pos.x;
        l.positionY.value = pos.y;
        l.positionZ.value = pos.z;
        l.forwardX.value = fwd.x;
        l.forwardY.value = 0;
        l.forwardZ.value = fwd.z;
        l.upX.value = 0;
        l.upY.value = 1;
        l.upZ.value = 0;
      } else {
        // legacy Safari fallback
        const dl = l as unknown as {
          setPosition(x: number, y: number, z: number): void;
          setOrientation(fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void;
        };
        dl.setPosition(pos.x, pos.y, pos.z);
        dl.setOrientation(fwd.x, 0, fwd.z, 0, 1, 0);
      }
    },

    play(name: SoundName, opts?: { pos?: Vec3; volume?: number }): void {
      const c = ensure();
      if (!c || !master || !noiseBuf) return;
      // While suspended currentTime is frozen — scheduling now would make every
      // queued sound blast at once on resume. Just drop them.
      if (c.state !== 'running') return;
      const count = active.get(name) ?? 0;
      if (count >= MAX_PER_SOUND) return;

      const vol = c.createGain();
      vol.gain.value = opts?.volume ?? 1;
      if (opts?.pos) {
        const p = c.createPanner();
        p.panningModel = 'equalpower';
        p.distanceModel = 'inverse';
        p.refDistance = 250;
        p.maxDistance = 6000;
        p.rolloffFactor = 1.2;
        setPannerPos(p, opts.pos);
        p.connect(master);
        vol.connect(p);
      } else {
        vol.connect(master);
      }

      const dur = SOUNDS[name]({ c, out: vol, t0: c.currentTime, noise: noiseBuf });
      active.set(name, count + 1);
      window.setTimeout(() => {
        active.set(name, Math.max(0, (active.get(name) ?? 1) - 1));
        vol.disconnect();
      }, dur * 1000 + 100);
    },

    setMasterVolume(v: number): void {
      masterVolume = v < 0 ? 0 : v > 1 ? 1 : v;
      if (master) master.gain.value = masterVolume;
    },
  };
};
