/**
 * A small offline DSP kit for the procedural sound cues: seeded noise, RBJ biquads, two-pole resonators, envelope
 * shapes, loop crossfades, level normalisation and the analysis the tests and the sound board use (RMS envelope,
 * spectral centroid, band energy split, flatness, onsets). Everything renders into plain Float32Arrays, so the same
 * code runs in the browser at unlock and in Node tests.
 */

export type Rng = () => number;

/** Deterministic uniform generator in [0, 1). */
export function rng(seed: number): Rng {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const gainToDb = (g: number) => 20 * Math.log10(Math.max(1e-12, g));

export type BiquadType = 'lowpass' | 'highpass' | 'bandpass' | 'peaking';

/** Direct-form I biquad with the RBJ cookbook coefficients. `bandpass` has 0 dB peak gain. */
export class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  constructor(private readonly sr: number) {}

  set(type: BiquadType, freq: number, q = Math.SQRT1_2, gainDb = 0): this {
    const f = Math.min(Math.max(freq, 5), this.sr * 0.49);
    const w = (2 * Math.PI * f) / this.sr;
    const cw = Math.cos(w), sw = Math.sin(w);
    const alpha = sw / (2 * Math.max(1e-3, q));
    const A = Math.pow(10, gainDb / 40);
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    switch (type) {
      case 'lowpass': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'highpass': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'bandpass': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      default: b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }

  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

export type FilterStep = readonly [BiquadType, number, number?, number?];

/** Runs a chain of biquads over a buffer in place. */
export function filter(buf: Float32Array, sr: number, chain: readonly FilterStep[]): Float32Array {
  for (const [type, f, q, g] of chain) {
    const bq = new Biquad(sr).set(type, f, q ?? Math.SQRT1_2, g ?? 0);
    for (let i = 0; i < buf.length; i++) buf[i] = bq.run(buf[i]!);
  }
  return buf;
}

export function white(n: number, r: Rng): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = r() * 2 - 1;
  return out;
}

/** Pink noise (-3 dB per octave), refined Kellet filter. */
export function pink(n: number, r: Rng): Float32Array {
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return out;
}

/** The five analysis bands (Hz) used by the measurements: energy split per band. */
export const BANDS: readonly (readonly [number, number])[] = [[20, 200], [200, 800], [800, 3000], [3000, 8000], [8000, 20000]];

const energy = (b: Float32Array) => {
  let e = 0;
  for (let i = 0; i < b.length; i++) e += b[i]! * b[i]!;
  return e;
};

/**
 * Noise whose energy splits across the five analysis bands by `weights` (pink inside each band). `scale` moves every
 * band edge (a brightness knob: 1.2 = 20 % higher).
 */
export function bandNoise(n: number, sr: number, r: Rng, weights: readonly number[], scale = 1): Float32Array {
  const out = new Float32Array(n);
  BANDS.forEach(([lo, hi], b) => {
    const w = weights[b] ?? 0;
    if (w <= 0) return;
    const s = pink(n, r);
    const top = Math.min(hi * scale, sr * 0.45);
    const bottom = Math.max(18, lo * scale);
    if (bottom >= top) return;
    filter(s, sr, [['highpass', bottom], ['highpass', bottom], ['lowpass', top], ['lowpass', top]]);
    const k = Math.sqrt((w * n) / Math.max(1e-12, energy(s)));
    for (let i = 0; i < n; i++) out[i]! += s[i]! * k;
  });
  return out;
}

/** Two-pole resonator: rings at `freq` with an amplitude time constant `tau` seconds. */
export class Resonator {
  private y1 = 0; private y2 = 0;
  private readonly c1: number; private readonly c2: number; private readonly g: number;
  constructor(sr: number, freq: number, tau: number) {
    const rr = Math.exp(-1 / (Math.max(1e-4, tau) * sr));
    const w = (2 * Math.PI * Math.min(freq, sr * 0.45)) / sr;
    this.c1 = 2 * rr * Math.cos(w);
    this.c2 = -rr * rr;
    this.g = (1 - rr) * 2;
  }
  run(x: number): number {
    const y = this.g * x + this.c1 * this.y1 + this.c2 * this.y2;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

export interface Mode { f: number; tau: number; gain: number }

/** Excites a bank of resonators with a signal and mixes their outputs (each mode normalised to its gain). */
export function modes(excite: Float32Array, sr: number, list: readonly Mode[]): Float32Array {
  const out = new Float32Array(excite.length);
  for (const m of list) {
    const res = new Resonator(sr, m.f, m.tau);
    const tmp = new Float32Array(excite.length);
    for (let i = 0; i < excite.length; i++) tmp[i] = res.run(excite[i]!);
    const k = m.gain / Math.sqrt(Math.max(1e-12, energy(tmp) / excite.length));
    for (let i = 0; i < out.length; i++) out[i]! += tmp[i]! * k;
  }
  return out;
}

/**
 * Adds a decaying sine starting at t0: frequency glides from f0 to f1 with time constant `glide`, amplitude rises
 * over `attack` and decays with time constant `tau`.
 */
export function addTone(out: Float32Array, sr: number, t0: number, f0: number, f1: number, glide: number, tau: number, amp: number, attack = 0.002, vibrato?: { rate: number; cents: number }): void {
  const start = Math.max(0, Math.round(t0 * sr));
  const end = Math.min(out.length, start + Math.round(tau * 9 * sr));
  let phase = 0;
  for (let i = start; i < end; i++) {
    const t = (i - start) / sr;
    let f = f1 + (f0 - f1) * Math.exp(-t / Math.max(1e-4, glide));
    if (vibrato) f *= Math.pow(2, (vibrato.cents / 1200) * Math.sin(2 * Math.PI * vibrato.rate * t));
    phase += (2 * Math.PI * f) / sr;
    const a = t < attack ? t / attack : Math.exp(-(t - attack) / tau);
    out[i]! += Math.sin(phase) * a * amp;
  }
}

/** Shapes a buffer by an amplitude function of time (seconds). */
export function shape(buf: Float32Array, sr: number, fn: (t: number) => number): Float32Array {
  for (let i = 0; i < buf.length; i++) buf[i]! *= fn(i / sr);
  return buf;
}

/** An impact bump: 0 before t0, linear rise over `attack`, then exponential decay with `tau`. */
export const bump = (t: number, t0: number, attack: number, tau: number) =>
  t < t0 ? 0 : t < t0 + attack ? (t - t0) / attack : Math.exp(-(t - t0 - attack) / tau);

/** Piecewise linear in dB between [time, dB] points; -120 dB outside. */
export function dbCurve(points: readonly (readonly [number, number])[]): (t: number) => number {
  return (t) => {
    if (!points.length || t < points[0]![0] || t > points[points.length - 1]![0]) return 0;
    for (let i = 1; i < points.length; i++) {
      const [t1, d1] = points[i]!;
      if (t <= t1) {
        const [t0, d0] = points[i - 1]!;
        const k = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
        return dbToGain(d0 + (d1 - d0) * k);
      }
    }
    return dbToGain(points[points.length - 1]![1]);
  };
}

/** Linear fade at both ends so a clip starts and ends at zero. */
export function fadeEdges(buf: Float32Array, sr: number, inSec: number, outSec: number): Float32Array {
  const a = Math.max(1, Math.round(inSec * sr)), b = Math.max(1, Math.round(outSec * sr));
  for (let i = 0; i < Math.min(a, buf.length); i++) buf[i]! *= i / a;
  for (let i = 0; i < Math.min(b, buf.length); i++) buf[buf.length - 1 - i]! *= i / b;
  return buf;
}

/**
 * Turns a rendering of `loopLen + xfade` seconds into a seamless loop of `loopLen` seconds: the extra tail is
 * crossfaded (equal power) into the head, so the sample after the last one is the continuation of the head.
 */
export function loopWrap(buf: Float32Array, sr: number, loopLen: number, xfade: number): Float32Array {
  const n = Math.round(loopLen * sr);
  const c = Math.min(Math.round(xfade * sr), buf.length - n);
  const out = buf.slice(0, n);
  for (let i = 0; i < c; i++) {
    const k = i / c;
    out[i] = buf[i]! * Math.sin((k * Math.PI) / 2) + buf[n + i]! * Math.cos((k * Math.PI) / 2);
  }
  return out;
}

/** RMS envelope in dB: 10 ms windows, 5 ms hop (the measurement grid). */
export function rmsDb(buf: Float32Array, sr: number): Float32Array {
  const hop = Math.round(0.005 * sr), win = Math.round(0.01 * sr);
  const frames = Math.max(1, Math.floor((buf.length - win) / hop) + (buf.length > win ? 1 : 0));
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    const a = f * hop;
    const b = Math.min(buf.length, a + win);
    for (let i = a; i < b; i++) s += buf[i]! * buf[i]!;
    out[f] = 20 * Math.log10(Math.sqrt(s / Math.max(1, b - a) + 1e-12) + 1e-9);
  }
  return out;
}

/** Scales a buffer so its loudest 10 ms window reads `peakDb` dBFS. */
export function normalizePeak(buf: Float32Array, sr: number, peakDb: number): Float32Array {
  const db = rmsDb(buf, sr);
  let peak = -200;
  for (let i = 0; i < db.length; i++) if (db[i]! > peak) peak = db[i]!;
  const k = dbToGain(peakDb - peak);
  for (let i = 0; i < buf.length; i++) buf[i]! *= k;
  return buf;
}

/** Soft knee limiter: samples above `knee` bend smoothly toward `ceiling`, nothing ever exceeds it. */
export function softLimit(buf: Float32Array, knee = 0.7, ceiling = 0.98): Float32Array {
  const room = ceiling - knee;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]!);
    if (a > knee) buf[i] = Math.sign(buf[i]!) * (knee + room * Math.tanh((a - knee) / room));
  }
  return buf;
}

/** Peak level with a limiter: normalise, limit, and repeat once so the loud window still reads `peakDb`. */
export function normalizeLimited(buf: Float32Array, sr: number, peakDb: number): Float32Array {
  for (let k = 0; k < 3; k++) softLimit(normalizePeak(buf, sr, peakDb));
  return buf;
}

/** In-place radix-2 complex FFT. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci, ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr; im[b] = im[a]! - ti;
        re[a] = re[a]! + tr; im[a] = im[a]! + ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export interface Measure {
  durMs: number;
  peakDb: number;
  attackMs: number;
  t20Ms: number | null;
  t40Ms: number | null;
  centroid: number;
  bandwidth: number;
  rolloff85: number;
  flatness: number;
  bands: number[];
  onsets: number[];
}

/** The same measurements the reference study used: RMS envelope timings, a Hann-window spectrum of the whole clip. */
export function measure(buf: Float32Array, sr: number): Measure {
  const db = rmsDb(buf, sr);
  let pi = 0;
  for (let i = 1; i < db.length; i++) if (db[i]! > db[pi]!) pi = i;
  const peakDb = db[pi]!;
  const below = (d: number) => {
    for (let i = pi; i < db.length; i++) if (db[i]! < peakDb - d) return (i - pi) * 5;
    return null;
  };
  let size = 1;
  while (size < buf.length) size <<= 1;
  const re = new Float64Array(size), im = new Float64Array(size);
  const n = buf.length;
  for (let i = 0; i < n; i++) re[i] = buf[i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, n - 1)));
  fft(re, im);
  const bins = size / 2 + 1;
  let sp = 0, sfp = 0, sMag = 0, sLog = 0;
  const power = new Float64Array(bins);
  for (let k = 0; k < bins; k++) {
    const mag = Math.hypot(re[k]!, im[k]!) + 1e-12;
    const f = (k * sr) / size;
    const p = mag * mag;
    power[k] = p;
    sp += p; sfp += f * p; sMag += mag; sLog += Math.log(mag);
  }
  const centroid = sfp / sp;
  let sbw = 0, cum = 0, roll = 0;
  const bands = BANDS.map(() => 0);
  for (let k = 0; k < bins; k++) {
    const f = (k * sr) / size;
    sbw += (f - centroid) * (f - centroid) * power[k]!;
    if (!roll) {
      cum += power[k]!;
      if (cum / sp >= 0.85) roll = f;
    }
    BANDS.forEach(([lo, hi], b) => {
      if (f >= lo && f < hi) bands[b]! += power[k]! / sp;
    });
  }
  const onsets: number[] = [];
  for (let i = 3; i < db.length; i++) if (db[i]! - db[i - 3]! > 9) onsets.push(i * 5);
  return {
    durMs: Math.round((n / sr) * 1000),
    peakDb,
    attackMs: pi * 5,
    t20Ms: below(20),
    t40Ms: below(40),
    centroid,
    bandwidth: Math.sqrt(sbw / sp),
    rolloff85: roll,
    flatness: Math.exp(sLog / bins) / (sMag / bins),
    bands,
    onsets,
  };
}
