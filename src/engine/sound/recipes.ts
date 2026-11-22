/**
 * Original procedural recipes for every sound cue. Each recipe renders one variant (or one loop layer) into a
 * Float32Array at any sample rate. The shapes are designed from measured targets only (duration, attack, decay to
 * -20/-40 dB, spectral centroid, band energy split, tonality, onset rhythm); no recorded audio is used.
 *
 * Shared knobs on every cue: `level` (peak 10 ms RMS of the rendering, dBFS), `length` (time scale), `pitch`
 * (frequency scale), `seed` (variation). Cue specific knobs are documented in each `params` block.
 */
import type { SoundName } from '../contracts';
import type { Def } from '../core/tune';
import {
  addTone, bandNoise, bump, dbCurve, dbToGain, fadeEdges, filter, loopWrap, modes, normalizeLimited, normalizePeak, rng, shape, white,
  type Mode, type Rng,
} from './dsp';

export interface CueTarget {
  durMs: number;
  centroid: number;
  peakDb: number;
  attackMs: number;
  t20Ms: number | null;
  t40Ms: number | null;
  bands: readonly number[];
  flatness: number;
}

export type CueParams = Record<string, number>;

export interface CueRecipe {
  name: SoundName;
  /** Registry id suffix: `sound.<id>`. */
  id: string;
  label: string;
  describe: string;
  loop: boolean;
  /** Layer names of a layered loop (crossfaded by the engine); each layer renders as one variant. */
  layers?: readonly string[];
  variants: number;
  /** Tunable parameter definitions (registered under `sound.<id>`), including `gain`, the playback level. */
  params: Record<string, Def>;
  render(sr: number, p: CueParams, variant: number): Float32Array;
  /** Measured targets per variant: the analysis test and the sound board compare renderings with these. */
  targets: readonly CueTarget[];
}

const common = (level: number, extra: Record<string, Def> = {}): Record<string, Def> => ({
  gain: { value: 1, min: 0, max: 3, step: 0.01, help: 'Playback gain multiplier for this cue' },
  level: { value: level, min: -40, max: -3, step: 0.1, unit: 'dBFS', help: 'Peak 10 ms RMS of the rendered clip' },
  length: { value: 1, min: 0.5, max: 2, step: 0.01, help: 'Time scale of the whole clip (1 = measured length)' },
  pitch: { value: 1, min: 0.5, max: 2, step: 0.01, help: 'Frequency scale of every band, mode and tone' },
  seed: { value: 1, min: 1, max: 999, step: 1, help: 'Variation seed; change it for a different take' },
  ...extra,
});

const T = (d: number, c: number, pk: number, at: number, t20: number | null, t40: number | null, bands: readonly number[], fl: number): CueTarget =>
  ({ durMs: d, centroid: c, peakDb: pk, attackMs: at, t20Ms: t20, t40Ms: t40, bands, flatness: fl });

const N = (sr: number, sec: number) => Math.max(1, Math.round(sec * sr));
const sum = (fns: readonly ((t: number) => number)[]) => (t: number) => {
  let s = 0;
  for (const f of fns) s += f(t);
  return s;
};
/** A grain at t0 with peak level db (dB), rise `a`, decay `tau`. */
const grain = (t0: number, db: number, a: number, tau: number) => {
  const g = dbToGain(db);
  return (t: number) => g * bump(t, t0, a, tau);
};
const scaleModes = (list: readonly Mode[], pitch: number, ring = 1): Mode[] => list.map((m) => ({ f: m.f * pitch, tau: m.tau * ring, gain: m.gain }));
/** Short noise clicks at the given times, used as an excitation for resonators. */
function clicks(n: number, sr: number, r: Rng, events: readonly (readonly [number, number])[], width = 0.0015): Float32Array {
  const e = new Float32Array(n);
  const w = N(sr, width);
  for (const [t, db] of events) {
    const a = dbToGain(db);
    const s = N(sr, t);
    for (let i = 0; i < w && s + i < n; i++) e[s + i]! += (r() * 2 - 1) * a * (1 - i / w);
  }
  return e;
}
const mix = (a: Float32Array, b: Float32Array, kb: number) => {
  for (let i = 0; i < a.length; i++) a[i]! += b[i]! * kb;
  return a;
};
const rms = (b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < b.length; i++) s += b[i]! * b[i]!;
  return Math.sqrt(s / Math.max(1, b.length));
};
/** Mixes `b` into `a` so b's RMS is `ratio` times a's RMS. */
const blend = (a: Float32Array, b: Float32Array, ratio: number) => mix(a, b, (ratio * rms(a)) / Math.max(1e-9, rms(b)));
/**
 * A decaying room and texture tail: band-shaped noise following absolute dBFS points. Added after the main body is
 * normalised, so the points read directly as levels in the finished clip.
 */
const room = (main: Float32Array, sr: number, r: Rng, w: readonly number[], pitch: number, pts: readonly (readonly [number, number])[]) =>
  mix(main, shape(bandNoise(main.length, sr, r, w, pitch), sr, dbCurve(pts)), 1);
/** The air band rolls off above 15 kHz, like any real recording chain. */
const air = (buf: Float32Array, sr: number) => filter(buf, sr, [['lowpass', 15000, 0.6], ['lowpass', 15000, 0.6]]);
/** Finishes a one-shot: air roll-off, edge fades, peak level. */
const finish = (buf: Float32Array, sr: number, level: number, fadeIn: number, fadeOut: number) =>
  normalizeLimited(fadeEdges(air(buf, sr), sr, fadeIn, fadeOut), sr, level);
/** Finishes a loop: air roll-off before wrapping, so the wrap stays seamless. */
const finishLoop = (buf: Float32Array, sr: number, level: number, loop: number, xf: number) =>
  normalizeLimited(loopWrap(air(buf, sr), sr, loop, xf), sr, level);

// ---------------------------------------------------------------------------------------------- page turn

const PAGE: readonly { dur: number; land: number; tau: number; w: readonly number[]; bed: readonly (readonly [number, number])[]; grains: readonly (readonly [number, number])[] }[] = [
  {
    dur: 0.635, land: 0.43, tau: 0.04, w: [0.12, 0.221, 0.47, 0.175, 0.015],
    bed: [[0, -48], [0.02, -38], [0.18, -36], [0.26, -30], [0.4, -30], [0.43, -30]],
    grains: [[0.02, -27], [0.09, -31], [0.145, -32], [0.165, -33], [0.25, -27], [0.31, -26], [0.395, -29], [0.5, -28]],
  },
  {
    dur: 0.48, land: 0.335, tau: 0.045, w: [0.148, 0.106, 0.321, 0.3, 0.32],
    bed: [[0, -55], [0.04, -44], [0.1, -34], [0.17, -27], [0.33, -26]],
    grains: [[0.035, -38], [0.165, -24], [0.215, -27], [0.27, -25], [0.385, -21], [0.41, -27]],
  },
  {
    dur: 0.47, land: 0.31, tau: 0.028, w: [0.061, 0.069, 0.258, 0.5, 0.22],
    bed: [[0, -70], [0.02, -46], [0.06, -36], [0.15, -34], [0.3, -33]],
    grains: [[0.018, -41], [0.078, -21], [0.095, -21], [0.175, -32], [0.285, -20], [0.44, -45]],
  },
];

const pageTurn: CueRecipe = {
  name: 'pageTurn', id: 'page-turn', label: 'Page turn', loop: false, variants: 3,
  describe: 'A single leaf turning: a rising paper rustle with crinkles, then the page landing on the block. Three takes, never the same twice in a row.',
  params: common(-13, {
    landDecay: { value: 1, min: 0.3, max: 3, step: 0.01, help: 'Scale of the landing decay time' },
    rustle: { value: 0, min: -12, max: 12, step: 0.5, unit: 'dB', help: 'Level of the rustle before the landing' },
  }),
  render(sr, p, v) {
    const d = PAGE[v % PAGE.length]!;
    const L = p.length!, P = p.pitch!;
    const n = N(sr, d.dur * L);
    const r = rng(p.seed! * 31 + v);
    const src = bandNoise(n, sr, r, d.w, P);
    const bed = dbCurve(d.bed.map(([t, db]) => [t * L, db + p.rustle!] as const));
    const parts = [bed, ...d.grains.map(([t, db]) => grain(t * L, db + p.rustle!, 0.003, 0.012 * L)), grain(d.land * L, 0, 0.012 * L, d.tau * L * p.landDecay!)];
    shape(src, sr, sum(parts));
    return finish(src, sr, p.level! + [0, -4.2, -3.1][v % 3]!, 0.003, 0.02);
  },
  targets: [
    T(635, 1861, -13, 430, 95, 175, [0.12, 0.221, 0.47, 0.175, 0.015], 0.097),
    T(480, 3722, -17.2, 335, 110, 125, [0.148, 0.106, 0.321, 0.274, 0.151], 0.166),
    T(470, 4083, -16.1, 310, 65, 120, [0.061, 0.069, 0.258, 0.488, 0.124], 0.153),
  ],
};

// ---------------------------------------------------------------------------------------------- riffle

const riffle: CueRecipe = {
  name: 'riffle', id: 'riffle', label: 'Riffle', loop: false, variants: 1,
  describe: 'Several leaves flicking past for a jump of more than one spread: a train of page ticks swelling to a final landing.',
  params: common(-18.2, {
    tickGap: { value: 0.045, min: 0.015, max: 0.15, step: 0.001, unit: 's', help: 'Mean time between page ticks' },
    tickDecay: { value: 0.014, min: 0.004, max: 0.05, step: 0.001, unit: 's', help: 'Decay time of each tick' },
  }),
  render(sr, p) {
    const L = p.length!;
    const n = N(sr, 0.99 * L);
    const r = rng(p.seed! * 17 + 3);
    const src = bandNoise(n, sr, r, [0.086, 0.088, 0.294, 0.4, 0.33], p.pitch!);
    const swell = dbCurve([[0, -40], [0.15, -31], [0.6, -24], [0.86, -23], [0.9, -30], [0.99, -60]]);
    const fns: ((t: number) => number)[] = [(t) => swell(t / L) * 0.35];
    for (let t = 0.022; t < 0.92; t += p.tickGap! * (0.6 + r() * 0.8)) {
      const lv = 20 * Math.log10(Math.max(1e-6, swell(t))) + (r() - 0.5) * 6;
      fns.push(grain(t * L, lv, 0.002, p.tickDecay! * L));
    }
    fns.push(grain(0.645 * L, -16, 0.003, 0.02 * L), grain(0.84 * L, -19.5, 0.003, 0.018 * L), grain(0.155 * L, -24, 0.002, 0.012 * L));
    shape(src, sr, sum(fns));
    return finish(src, sr, p.level!, 0.004, 0.05);
  },
  targets: [T(990, 4191, -18.2, 650, 255, 315, [0.086, 0.088, 0.294, 0.374, 0.158], 0.164)],
};

// ---------------------------------------------------------------------------------------------- flap

const flap: CueRecipe = {
  name: 'flap', id: 'flap', label: 'Paper flap', loop: false, variants: 1,
  describe: 'A paper flap lifting off the page and snapping open: a dry card rustle, a short whoosh, then a crisp papery snap.',
  params: common(-14.2, {
    snapDecay: { value: 0.03, min: 0.008, max: 0.12, step: 0.001, unit: 's', help: 'Decay time of the snap' },
    paper: { value: 0.35, min: 0, max: 2, step: 0.01, help: 'Amount of card resonance in the snap' },
  }),
  render(sr, p) {
    const L = p.length!, P = p.pitch!;
    const n = N(sr, 0.56 * L);
    const r = rng(p.seed! * 13 + 5);
    const src = bandNoise(n, sr, r, [0.002, 0.08, 0.56, 0.4, 0.06], P);
    const card = modes(src, sr, scaleModes([
      { f: 1073, tau: 0.02, gain: 0.6 }, { f: 1211, tau: 0.025, gain: 1 }, { f: 1268, tau: 0.025, gain: 0.9 },
      { f: 1405, tau: 0.02, gain: 0.7 }, { f: 2100, tau: 0.015, gain: 0.5 },
    ], P));
    blend(src, card, p.paper!);
    const bed = dbCurve([[0, -60], [0.02, -44], [0.1, -35], [0.18, -32], [0.205, -36], [0.24, -54], [0.25, -54]].map(([t, d]) => [t! * L, d!] as const));
    shape(src, sr, sum([
      bed, grain(0.255 * L, -28, 0.008, 0.02 * L), grain(0.28 * L, -25, 0.004, 0.012 * L), grain(0.335 * L, -27, 0.005, 0.01 * L),
      grain(0.355 * L, -14.2, 0.004, p.snapDecay! * L), grain(0.385 * L, -27, 0.004, 0.02 * L), grain(0.41 * L, -28, 0.004, 0.018 * L),
    ]));
    return finish(src, sr, p.level!, 0.003, 0.03);
  },
  targets: [T(560, 2934, -14.2, 355, 75, 155, [0.002, 0.08, 0.56, 0.321, 0.037], 0.131)],
};

// ---------------------------------------------------------------------------------------------- pen (loop)

const pen: CueRecipe = {
  name: 'pen', id: 'pen', label: 'Pen on paper', loop: true, variants: 1,
  describe: 'A nib scratching across paper in short strokes; a seamless one-second loop played while a drawing inks itself, or as a 0.5 s tick for a choice.',
  params: common(-16.9, {
    strokeLen: { value: 0.11, min: 0.03, max: 0.4, step: 0.005, unit: 's', help: 'Mean length of a pen stroke' },
    strokeGap: { value: 0.04, min: 0.005, max: 0.2, step: 0.005, unit: 's', help: 'Mean pause between strokes' },
    nib: { value: 0.3, min: 0, max: 2, step: 0.01, help: 'Amount of nib body resonance (the woody 400-700 Hz tone)' },
    hiss: { value: -34, min: -60, max: -20, step: 0.5, unit: 'dBFS', help: 'Paper hiss between strokes' },
  }),
  render(sr, p) {
    const L = p.length!, P = p.pitch!;
    const loop = 1.0 * L, xf = 0.08;
    const n = N(sr, loop + xf);
    const r = rng(p.seed! * 7 + 11);
    const src = bandNoise(n, sr, r, [0.001, 0.62, 0.25, 0.07, 0.06], P);
    const body = modes(src, sr, scaleModes([
      { f: 419, tau: 0.012, gain: 0.6 }, { f: 452, tau: 0.015, gain: 1 }, { f: 492, tau: 0.015, gain: 0.8 },
      { f: 665, tau: 0.012, gain: 0.6 }, { f: 703, tau: 0.012, gain: 0.7 },
    ], P));
    blend(src, body, p.nib!);
    const strokes: (readonly [number, number, number])[] = [];
    for (let t = 0.012; t < loop + xf; ) {
      const len = p.strokeLen! * (0.45 + r() * 1.1) * L;
      strokes.push([t, len, -22 - r() * 12]);
      t += len + p.strokeGap! * (0.4 + r() * 1.4) * L;
    }
    const flutter = white(n, r);
    filter(flutter, sr, [['lowpass', 45], ['lowpass', 45]]);
    const fk = 1 / Math.max(1e-6, rms(flutter));
    shape(src, sr, (t) => {
      let g = 0;
      for (const [t0, len, db] of strokes) {
        if (t < t0 || t > t0 + len + 0.03) continue;
        const a = Math.min(1, (t - t0) / 0.008) * (t > t0 + len ? Math.exp(-(t - t0 - len) / 0.008) : 1);
        g += a * dbToGain(db);
      }
      return g;
    });
    for (let i = 0; i < n; i++) src[i]! *= Math.max(0.15, 1 + 0.45 * flutter[i]! * fk);
    normalizePeak(src, sr, p.level!);
    room(src, sr, r, [0, 0.35, 0.4, 0.13, 0.12], P, [[0, p.hiss!], [loop + xf, p.hiss!]]);
    return finishLoop(src, sr, p.level!, loop, xf);
  },
  targets: [T(1000, 1156, -16.9, 710, 15, null, [0.001, 0.762, 0.165, 0.037, 0.035], 0.103)],
};

// ---------------------------------------------------------------------------------------------- book thud

const THUD = [
  {
    dur: 0.443, hits: [[0, -14], [0.012, -14], [0.026, -15], [0.04, -10], [0.165, -30]] as const,
    modes: [{ f: 158, tau: 0.022, gain: 1 }, { f: 210, tau: 0.02, gain: 0.7 }, { f: 332, tau: 0.018, gain: 0.7 }, { f: 375, tau: 0.02, gain: 1 }, { f: 420, tau: 0.018, gain: 0.9 }, { f: 900, tau: 0.01, gain: 0.7 }, { f: 1450, tau: 0.008, gain: 0.6 }],
    slap: [0, 0.05, 0.5, 0.35, 0.05], slapMix: 0.45,
    tail: [[0.03, -42], [0.05, -28], [0.075, -32], [0.12, -35], [0.15, -44], [0.16, -45], [0.168, -37], [0.19, -45], [0.21, -51], [0.3, -61], [0.443, -82]] as const,
  },
  {
    dur: 0.492, hits: [[0.002, -16], [0.015, -12.5], [0.032, -14], [0.132, -30], [0.177, -28]] as const,
    modes: [{ f: 175, tau: 0.018, gain: 0.3 }, { f: 264, tau: 0.02, gain: 0.5 }, { f: 331, tau: 0.02, gain: 0.8 }, { f: 386, tau: 0.022, gain: 1 }, { f: 431, tau: 0.022, gain: 1 }, { f: 1100, tau: 0.008, gain: 0.5 }],
    slap: [0, 0.05, 0.5, 0.35, 0.05], slapMix: 0.6,
    tail: [[0.01, -42], [0.04, -24], [0.06, -30], [0.08, -34], [0.12, -40], [0.134, -34], [0.15, -38], [0.176, -31], [0.2, -46], [0.24, -57], [0.3, -62], [0.4, -69], [0.492, -95]] as const,
  },
];

const bookThud: CueRecipe = {
  name: 'bookThud', id: 'book-thud', label: 'Book thud', loop: false, variants: 2,
  describe: 'A book landing flat on the desk: a quick cluster of contacts, a woody body ring and one small settle.',
  params: common(-10.5, { ring: { value: 1, min: 0.3, max: 3, step: 0.01, help: 'Scale of the body ring time' } }),
  render(sr, p, v) {
    const d = THUD[v % THUD.length]!;
    const L = p.length!, P = p.pitch!;
    const n = N(sr, d.dur * L);
    const r = rng(p.seed! * 19 + v);
    const ex = clicks(n, sr, r, d.hits.map(([t, db]) => [t * L, db] as const), 0.003);
    const out = modes(ex, sr, scaleModes(d.modes, P, p.ring!));
    const slap = bandNoise(n, sr, r, d.slap, P);
    shape(slap, sr, sum(d.hits.map(([t, db]) => grain(t * L, db, 0.001, 0.007))));
    blend(out, slap, d.slapMix);
    const level = p.level! + (v ? -2.5 : 0);
    normalizePeak(out, sr, level);
    room(out, sr, r, this.targets[v % 2]!.bands, P, d.tail.map(([t, db]) => [t * L * p.ring!, db + level - this.targets[v % 2]!.peakDb] as const));
    return finish(out, sr, level, 0.001, 0.03);
  },
  targets: [
    T(443, 1001, -10.5, 40, 30, 170, [0.2, 0.415, 0.316, 0.065, 0.004], 0.069),
    T(492, 832, -13, 15, 55, 215, [0.112, 0.609, 0.227, 0.049, 0.003], 0.067),
  ],
};

// ---------------------------------------------------------------------------------------------- roll (loop)

const roll: CueRecipe = {
  name: 'roll', id: 'roll', label: 'Ball rolling', loop: true, variants: 1,
  describe: 'A ball rolling along a wooden track: a steady gritty rumble with the track ringing; looped while the ball moves, rate and gain follow its speed.',
  params: common(-17.5, {
    grit: { value: 30, min: 0, max: 120, step: 1, unit: '/s', help: 'Small grit clicks per second' },
    wobble: { value: 2, min: 0, max: 8, step: 0.1, unit: 'dB', help: 'Slow level wobble of the rumble' },
  }),
  render(sr, p) {
    const L = p.length!, P = p.pitch!;
    const loop = 1.08 * L, xf = 0.1;
    const n = N(sr, loop + xf);
    const r = rng(p.seed! * 23 + 1);
    const src = bandNoise(n, sr, r, [0.013, 0.12, 0.617, 0.3, 0.03], P);
    const track = modes(src, sr, scaleModes([{ f: 798, tau: 0.02, gain: 0.5 }, { f: 1373, tau: 0.03, gain: 0.8 }, { f: 1750, tau: 0.03, gain: 1 }], P));
    blend(src, track, 0.4);
    const hum = new Float32Array(n);
    addTone(hum, sr, 0, 100 * P, 100 * P, 1, 60, 1, 0.01);
    blend(src, hum, 0.07);
    const grits: (readonly [number, number])[] = [];
    for (let t = 0; t < loop + xf; t += (1 / Math.max(1, p.grit!)) * (0.3 + r() * 1.4)) grits.push([t, -6 - r() * 8]);
    const ph1 = r() * 6.28, ph2 = r() * 6.28;
    shape(src, sr, (t) => {
      const w = Math.sin(2 * Math.PI * (5.5 / L) * t + ph1) * 0.6 + Math.sin(2 * Math.PI * (2.3 / L) * t + ph2) * 0.4;
      return dbToGain(w * p.wobble!);
    });
    if (p.grit! > 0) mix(src, shape(bandNoise(n, sr, r, [0, 0.1, 0.5, 0.4, 0], P), sr, sum(grits.map(([t, db]) => grain(t, db, 0.0008, 0.004)))), 0.35);
    return finishLoop(src, sr, p.level!, loop, xf);
  },
  targets: [T(1080, 2261, -17.5, 410, null, null, [0.013, 0.134, 0.617, 0.218, 0.018], 0.105)],
};

// ---------------------------------------------------------------------------------------------- stamp

const stamp: CueRecipe = {
  name: 'stamp', id: 'stamp', label: 'Rubber stamp', loop: false, variants: 1,
  describe: 'A rubber stamp pressed onto the page: a few quick contacts rocking down into one firm press, then a short ring of the book.',
  params: common(-11.1, { ring: { value: 1, min: 0.3, max: 3, step: 0.01, help: 'Scale of the ring time after the press' } }),
  render(sr, p) {
    const L = p.length!, P = p.pitch!;
    const n = N(sr, 0.355 * L);
    const r = rng(p.seed! * 29 + 7);
    const hits = [[0.018, -30], [0.04, -22], [0.05, -19], [0.06, -15.5], [0.08, -17.5], [0.09, -16], [0.1, -11]] as const;
    const ex = clicks(n, sr, r, hits.map(([t, d]) => [t * L, d] as const), 0.002);
    const body = modes(ex, sr, scaleModes([
      { f: 110, tau: 0.012, gain: 0.35 }, { f: 161, tau: 0.01, gain: 0.25 }, { f: 282, tau: 0.01, gain: 0.35 },
      { f: 724, tau: 0.008, gain: 1 }, { f: 842, tau: 0.008, gain: 1 }, { f: 1500, tau: 0.005, gain: 0.6 },
    ], P));
    const slap = bandNoise(n, sr, r, [0, 0.15, 0.5, 0.25, 0.1], P);
    shape(slap, sr, sum(hits.map(([t, d]) => grain(t * L, d, 0.001, 0.004))));
    blend(body, slap, 0.8);
    normalizePeak(body, sr, p.level!);
    const o = p.level! + 11.1, k = p.ring! * L, c = (x: number) => Math.min(x, 0.35 * L);
    room(body, sr, r, this.targets[0]!.bands, P, [[0.1 * L, -80], [0.112 * L, -31 + o], [c(0.15 * k), -31 + o], [c(0.18 * k), -38 + o], [c(0.2 * k), -35 + o], [c(0.25 * k), -44 + o], [c(0.29 * k), -45 + o], [c(0.31 * k), -54 + o], [0.355 * L, -78 + o]]);
    return finish(body, sr, p.level!, 0.001, 0.02);
  },
  targets: [T(355, 1519, -11.1, 100, 20, 200, [0.109, 0.323, 0.473, 0.069, 0.026], 0.105)],
};

// ---------------------------------------------------------------------------------------------- bounce

const bounce: CueRecipe = {
  name: 'bounce', id: 'bounce', label: 'Bounce', loop: false, variants: 1,
  describe: 'A small hard ball hitting the table: a brief contact and a short, dull knock.',
  params: common(-15.8, {
    contact: { value: 0.022, min: 0.002, max: 0.06, step: 0.001, unit: 's', help: 'How long the contact stays loud' },
    decay: { value: 0.016, min: 0.004, max: 0.08, step: 0.001, unit: 's', help: 'Decay time after the contact' },
  }),
  render(sr, p) {
    const L = p.length!, P = p.pitch!;
    const n = N(sr, 0.2 * L);
    const r = rng(p.seed! * 37 + 2);
    const out = new Float32Array(n);
    for (const [f, a] of [[95, 0.6], [160, 0.35], [295, 0.7], [350, 0.9], [410, 0.6], [820, 0.2]] as const) addTone(out, sr, 0, f * P * 1.04, f * P, 0.01, 10, a, 0.0005);
    const knock = bandNoise(n, sr, r, [0.05, 0.35, 0.45, 0.15, 0], P);
    blend(out, knock, 0.45);
    const c = p.contact! * L, k = p.decay! * L;
    shape(out, sr, (t) => (t < c ? 1 - 0.1 * Math.sin((t / c) * Math.PI) : Math.exp(-(t - c) / k)));
    return finish(out, sr, p.level!, 0.0005, 0.01);
  },
  targets: [T(200, 497, -15.8, 0, 45, 95, [0.316, 0.571, 0.094, 0.018, 0.001], 0.041)],
};

// ---------------------------------------------------------------------------------------------- bounce ball

const BALL = [
  { dur: 0.287, at: 0.006, tones: [[104, 1, 0.04], [63, 0.7, 0.05], [136, 0.6, 0.035], [178, 0.25, 0.03], [254, 0.2, 0.025]], echo: null },
  { dur: 0.305, at: 0.003, tones: [[102, 1, 0.038], [62, 0.75, 0.048], [134, 0.55, 0.035], [174, 0.3, 0.03], [220, 0.2, 0.025]], echo: null },
  { dur: 0.301, at: 0.003, tones: [[103, 1, 0.03], [63, 0.8, 0.042], [153, 0.45, 0.028], [199, 0.25, 0.025], [262, 0.2, 0.02]], echo: 0.215 },
] as const;

const bounceBall: CueRecipe = {
  name: 'bounceBall', id: 'bounce-ball', label: 'Ball bounce', loop: false, variants: 3,
  describe: 'A big rubber ball bouncing on the table: a deep hollow boom with a dull slap.',
  params: common(-13.3, { decay: { value: 1, min: 0.3, max: 3, step: 0.01, help: 'Scale of the boom decay' } }),
  render(sr, p, v) {
    const d = BALL[v % BALL.length]!;
    const L = p.length!, P = p.pitch!;
    const n = N(sr, d.dur * L);
    const r = rng(p.seed! * 41 + v);
    const out = new Float32Array(n);
    for (const [f, a, tau] of d.tones) addTone(out, sr, 0, f * P * 1.12, f * P, 0.012, tau * p.decay! * L, a, d.at);
    if (d.echo) for (const [f, a, tau] of d.tones) addTone(out, sr, d.echo * L, f * P, f * P, 1, tau * 0.6 * L, a * 0.06, 0.003);
    const slap = bandNoise(n, sr, r, [0.2, 0.3, 0.4, 0.1, 0], P);
    shape(slap, sr, (t) => bump(t, 0, 0.001, 0.006));
    blend(out, slap, 0.18);
    const level = p.level! + [0, -0.4, 1.5][v % 3]!;
    normalizePeak(out, sr, level);
    const o = level + 13.3 + [2, 3.5, -3][v % 3]!;
    room(out, sr, r, [0.08, 0.47, 0.35, 0.1, 0], P, [[0, -56 + o], [0.02 * L, -38 + o], [0.1 * L, -44 + o], [0.18 * L, -50 + o], [0.21 * L, -56 + o], [d.dur * L, -72 + o]]);
    return finish(out, sr, level, 0.0005, 0.02);
  },
  targets: [
    T(287, 170, -13.3, 10, 75, 195, [0.939, 0.033, 0.022, 0.005, 0], 0.05),
    T(305, 195, -13.7, 5, 55, 185, [0.915, 0.043, 0.036, 0.005, 0], 0.06),
    T(301, 145, -11.8, 5, 20, 160, [0.965, 0.02, 0.01, 0.004, 0], 0.053),
  ],
};

// ---------------------------------------------------------------------------------------------- kettle (layered loop)

const kettle: CueRecipe = {
  name: 'kettle', id: 'kettle', label: 'Kettle', loop: true, layers: ['heat', 'boil'], variants: 2,
  describe: 'A kettle heating water: a resonant hiss (heat layer) crossfades into a low bubbling rumble (boil layer) as the gain rises.',
  params: common(-22.8, {
    bubbles: { value: 7, min: 0, max: 30, step: 0.5, unit: '/s', help: 'Bubbles per second in the boil layer' },
    boilLevel: { value: -16.2, min: -40, max: -3, step: 0.1, unit: 'dBFS', help: 'Peak level of the boil layer' },
  }),
  render(sr, p, v) {
    const L = p.length!, P = p.pitch!;
    const loop = 3 * L, xf = 0.25;
    const n = N(sr, loop + xf);
    const r = rng(p.seed! * 43 + v);
    if (v % 2 === 0) {
      const src = bandNoise(n, sr, r, [0.08, 0.25, 0.45, 0.2, 0.03], P);
      const body = modes(src, sr, scaleModes([{ f: 678, tau: 0.12, gain: 0.8 }, { f: 741, tau: 0.15, gain: 1 }, { f: 775, tau: 0.15, gain: 1 }, { f: 1381, tau: 0.1, gain: 0.9 }, { f: 169, tau: 0.2, gain: 0.35 }], P));
      blend(src, body, 0.3);
      const ph = r() * 6.28;
      shape(src, sr, (t) => dbToGain(1.6 * Math.sin(2 * Math.PI * (0.67 / L) * t + ph) + 0.8 * Math.sin(2 * Math.PI * (1.67 / L) * t)));
      return finishLoop(src, sr, p.level!, loop, xf);
    }
    const src = bandNoise(n, sr, r, [0.6, 0.4, 0.01, 0, 0], P);
    const ph = r() * 6.28;
    shape(src, sr, (t) => dbToGain(1.2 * Math.sin(2 * Math.PI * (1.33 / L) * t + ph)));
    const freqs = [140, 176, 213, 255, 323];
    const bub = new Float32Array(n);
    for (let t = 0.02; t < loop + xf; t += (1 / Math.max(0.5, p.bubbles!)) * -Math.log(1 - r() * 0.95)) {
      const f = freqs[Math.floor(r() * freqs.length)]! * P * (0.92 + r() * 0.16);
      addTone(bub, sr, t, f, f * 1.25, 0.06, 0.025 + r() * 0.035, 0.4 + r() * 0.8, 0.003);
    }
    blend(src, bub, 0.8);
    return finishLoop(src, sr, p.boilLevel!, loop, xf);
  },
  targets: [
    T(3000, 1632, -22.8, 1540, null, null, [0.1, 0.349, 0.389, 0.147, 0.016], 0.048),
    T(3000, 232, -16.2, 1815, null, null, [0.529, 0.457, 0.011, 0.002, 0.001], 0.062),
  ],
};

// ---------------------------------------------------------------------------------------------- kettle click

const kettleClick: CueRecipe = {
  name: 'kettleClick', id: 'kettle-click', label: 'Switch click', loop: false, variants: 1,
  describe: 'A plastic rocker switch: a sharp click with a short hollow ring of the casing.',
  params: common(-11.5, { ring: { value: 1, min: 0.3, max: 3, step: 0.01, help: 'Scale of the casing ring' } }),
  render(sr, p) {
    const L = p.length!, P = p.pitch!;
    const n = N(sr, 0.172 * L);
    const r = rng(p.seed! * 47 + 9);
    const ex = clicks(n, sr, r, [[0, 0], [0.006 * L, -4]], 0.0012);
    const body = modes(ex, sr, scaleModes([
      { f: 581, tau: 0.022, gain: 0.45 }, { f: 628, tau: 0.025, gain: 0.55 }, { f: 663, tau: 0.025, gain: 0.55 }, { f: 790, tau: 0.02, gain: 0.4 },
      { f: 1999, tau: 0.03, gain: 1 }, { f: 3900, tau: 0.008, gain: 0.5 },
    ], P, p.ring!));
    const click = bandNoise(n, sr, r, [0, 0.2, 0.35, 0.3, 0.15], P);
    shape(click, sr, sum([grain(0, 0, 0.0005, 0.006), grain(0.006 * L, -4, 0.0005, 0.005)]));
    blend(body, click, 0.9);
    shape(body, sr, (t) => (t < 0.01 * L ? 1 : 0.55 + 0.45 * Math.exp(-(t - 0.01 * L) / 0.008)));
    normalizePeak(body, sr, p.level!);
    const o = p.level! + 11.5, k = p.ring! * L;
    room(body, sr, r, [0.01, 0.42, 0.3, 0.17, 0.1], P, [[0, -70 + o], [0.008 * L, -27 + o], [0.03 * k, -33 + o], [0.09 * k, -38 + o], [0.125 * k, -43 + o], [0.172 * L, -75 + o]].sort((a, b) => a[0]! - b[0]!) as [number, number][]);
    return finish(body, sr, p.level!, 0.0004, 0.025);
  },
  targets: [T(172, 2084, -11.5, 5, 30, 140, [0.016, 0.413, 0.4, 0.119, 0.053], 0.098)],
};

// ---------------------------------------------------------------------------------------------- spring stretch (loop)

const springStretch: CueRecipe = {
  name: 'springStretch', id: 'spring-stretch', label: 'Spring stretch', loop: true, variants: 1,
  describe: 'A steel spring being pulled: irregular tonal creaks of its coils; looped while the launcher is drawn back.',
  params: common(-13.8, {
    creakRate: { value: 48, min: 15, max: 140, step: 1, unit: 'Hz', help: 'Stick-slip pulse rate inside a creak' },
    creakGap: { value: 0.26, min: 0.08, max: 0.8, step: 0.01, unit: 's', help: 'Mean time between creak onsets' },
  }),
  render(sr, p) {
    const L = p.length!, P = p.pitch!;
    const loop = 1.4 * L, xf = 0.12;
    const n = N(sr, loop + xf);
    const r = rng(p.seed! * 53 + 4);
    const ex = new Float32Array(n);
    const env = new Float32Array(n);
    for (let t = 0.03; t < loop + xf; t += p.creakGap! * (0.6 + r() * 0.8) * L) {
      const len = (0.1 + r() * 0.14) * L;
      const lv = dbToGain(-r() * 9);
      const rate0 = p.creakRate! * (0.7 + r() * 0.3), rate1 = p.creakRate! * (1.1 + r() * 0.5);
      for (let u = 0; u < len; ) {
        const i = N(sr, t + u);
        if (i >= n) break;
        ex[i] = (r() * 0.4 + 0.8) * lv;
        u += 1 / (rate0 + (rate1 - rate0) * (u / len));
      }
      const a = N(sr, t), b = Math.min(n, N(sr, t + len));
      for (let i = a; i < b; i++) {
        const k = (i - a) / Math.max(1, b - a);
        env[i] = Math.max(env[i]!, lv * Math.min(1, k / 0.15) * Math.min(1, (1 - k) / 0.25));
      }
    }
    const out = modes(ex, sr, scaleModes([
      { f: 161, tau: 0.03, gain: 0.5 }, { f: 494, tau: 0.06, gain: 1 }, { f: 533, tau: 0.06, gain: 0.9 },
      { f: 583, tau: 0.05, gain: 0.7 }, { f: 615, tau: 0.05, gain: 0.7 }, { f: 1150, tau: 0.02, gain: 0.3 }, { f: 2300, tau: 0.01, gain: 0.12 },
    ], P));
    for (let i = 0; i < n; i++) out[i]! *= 0.3 + 0.7 * env[i]!;
    return finishLoop(out, sr, p.level!, loop, xf);
  },
  targets: [T(1400, 579, -13.8, 1030, 105, null, [0.11, 0.82, 0.055, 0.014, 0.001], 0.025)],
};

// ---------------------------------------------------------------------------------------------- spring release

const RELEASE = [
  { dur: 1.562, hits: [[0, -13.6], [0.18, -16], [0.42, -19], [0.66, -18], [0.95, -19], [1.2, -21], [1.34, -27]] as const, gap: 0.09 },
  { dur: 1.338, hits: [[0, -14.3], [0.05, -18], [0.275, -22], [0.44, -17], [0.715, -20], [0.88, -21], [1.045, -22], [1.17, -28]] as const, gap: 0.085 },
];

const springRelease: CueRecipe = {
  name: 'springRelease', id: 'spring-release', label: 'Spring release', loop: false, variants: 2,
  describe: 'A launcher spring let go: a bright metallic twang that rattles against its stop a few times as it settles.',
  params: common(-13.6, {
    ring: { value: 1, min: 0.3, max: 3, step: 0.01, help: 'Scale of the metallic ring time' },
    rattle: { value: 1, min: 0, max: 3, step: 0.01, help: 'Level of the small rattles between the big bounces' },
  }),
  render(sr, p, v) {
    const d = RELEASE[v % RELEASE.length]!;
    const L = p.length!, P = p.pitch!;
    const n = N(sr, d.dur * L);
    const r = rng(p.seed! * 59 + v);
    const ev: [number, number][] = d.hits.map(([t, db]) => [t * L, db]);
    const last = d.hits[d.hits.length - 1]![0];
    for (let t = d.gap; t < last + 0.1; t += d.gap * (0.85 + r() * 0.3)) {
      const near = d.hits.some(([h]) => Math.abs(h - t) < 0.025);
      if (!near && p.rattle! > 0) ev.push([t * L, -25 - (t / last) * 4 + 20 * Math.log10(p.rattle!)]);
    }
    const ex = clicks(n, sr, r, ev, 0.001);
    const out = modes(ex, sr, scaleModes([
      { f: 741, tau: 0.06, gain: 0.35 }, { f: 1786, tau: 0.036, gain: 0.6 }, { f: 1857, tau: 0.042, gain: 0.8 }, { f: 1937, tau: 0.042, gain: 1 },
      { f: 2003, tau: 0.036, gain: 0.8 }, { f: 2038, tau: 0.048, gain: 1 }, { f: 2705, tau: 0.03, gain: 0.8 }, { f: 4300, tau: 0.014, gain: 0.6 },
    ], P, p.ring!));
    const zing = bandNoise(n, sr, r, [0, 0.15, 0.25, 0.45, 0.15], P);
    shape(zing, sr, sum(ev.map(([t, db]) => grain(t, db, 0.0005, 0.012))));
    blend(out, zing, 0.55);
    return finish(out, sr, p.level! + (v ? -0.7 : 0), 0.0003, 0.08);
  },
  targets: [
    T(1562, 2625, -13.6, 0, 65, 1370, [0.012, 0.064, 0.71, 0.178, 0.036], 0.055),
    T(1338, 2664, -14.3, 0, 135, 1195, [0.012, 0.053, 0.713, 0.184, 0.037], 0.046),
  ],
};

// ---------------------------------------------------------------------------------------------- click (UI)

const click: CueRecipe = {
  name: 'click', id: 'click', label: 'Soft click', loop: false, variants: 1,
  describe: 'A small dry tick for interface feedback (our own cue; there is no measured reference for it).',
  params: common(-20, { decay: { value: 0.007, min: 0.002, max: 0.03, step: 0.001, unit: 's', help: 'Decay of the tick' } }),
  render(sr, p) {
    const L = p.length!, P = p.pitch!;
    const n = N(sr, 0.05 * L);
    const r = rng(p.seed! * 61);
    const ex = clicks(n, sr, r, [[0, 0]], 0.0008);
    const out = modes(ex, sr, scaleModes([{ f: 1900, tau: p.decay!, gain: 1 }, { f: 3100, tau: p.decay! * 0.6, gain: 0.7 }, { f: 5200, tau: p.decay! * 0.3, gain: 0.3 }], P));
    return finish(out, sr, p.level!, 0.0003, 0.01);
  },
  targets: [T(50, 2000, -20, 0, 15, 35, [0, 0, 0.9, 0.1, 0], 0.01)],
};

export const RECIPES: readonly CueRecipe[] = [
  pageTurn, riffle, flap, pen, bookThud, roll, stamp, bounce, bounceBall, kettle, kettleClick, springStretch, springRelease, click,
];

export const recipe = (name: SoundName): CueRecipe => RECIPES.find((r) => r.name === name)!;

/** Default parameter values of a recipe (what `tunable()` starts from). */
export function defaults(rec: CueRecipe): CueParams {
  const out: CueParams = {};
  for (const [k, d] of Object.entries(rec.params)) if (typeof d.value === 'number') out[k] = d.value;
  return out;
}
