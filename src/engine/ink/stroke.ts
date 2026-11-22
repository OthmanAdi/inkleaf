/**
 * Stroke preparation on the CPU: overshoot, resampling to a maximum segment length, optional wobble and the pen
 * pressure profile (slow plus fine value noise, tapered ends). Pure functions over flat xyz arrays so dynamic
 * sets can rebuild every frame without garbage.
 */
import { noise1, noise3 } from './noise';

export interface StrokeParams {
  /** Resample step in mm: no segment of a stroke is longer than this. */
  maxSeg: number;
  /** Pressure base, slow amplitude and wavelength, fine amplitude and wavelength (mm). */
  base: number;
  slow: number;
  slowWave: number;
  fine: number;
  fineWave: number;
  /** Seed offset of the fine pressure layer. */
  fineSeed: number;
  /** Tapered ends start at this fraction of full weight and reach full weight after `taperLength` mm. */
  taperFloor: number;
  taperLength: number;
  /** Wobble noise wavelength in mm. */
  wobbleWave: number;
}

export const STROKE_DEFAULTS: StrokeParams = {
  maxSeg: 1.6,
  base: 0.8,
  slow: 0.36,
  slowWave: 34,
  fine: 0.1,
  fineWave: 7,
  fineSeed: 17,
  taperFloor: 0.42,
  taperLength: 4.5,
  wobbleWave: 22,
};

/** Pen pressure at arc length `s` (mm) of a stroke of length `L`: 0.8 to 1.26, ends tapered to 42 % when asked. */
export function widthProfile(s: number, L: number, seed: number, taper: boolean, p: StrokeParams = STROKE_DEFAULTS): number {
  let f = p.base + p.slow * noise1(seed, s / p.slowWave) + p.fine * noise1(seed + p.fineSeed, s / p.fineWave);
  if (taper) {
    const k = 1 - p.taperFloor;
    const a = Math.min(1, p.taperFloor + k * Math.min(1, s / p.taperLength));
    const b = Math.min(1, p.taperFloor + k * Math.min(1, (L - s) / p.taperLength));
    f *= a * b;
  }
  return f;
}

/** A growable float buffer reused between frames. */
export class FloatBuf {
  a: Float32Array;
  n = 0;
  constructor(cap = 256) {
    this.a = new Float32Array(cap);
  }
  reset(): this {
    this.n = 0;
    return this;
  }
  push3(x: number, y: number, z: number): void {
    if (this.n + 3 > this.a.length) {
      const b = new Float32Array(Math.ceil((this.n + 3) * 1.5));
      b.set(this.a.subarray(0, this.n));
      this.a = b;
    }
    this.a[this.n++] = x;
    this.a[this.n++] = y;
    this.a[this.n++] = z;
  }
  get points(): number {
    return this.n / 3;
  }
}

export interface XYZ { x: number; y: number; z: number }

/**
 * Resamples a polyline so that no segment exceeds `maxSeg`: each segment is split into `ceil(len / maxSeg)` equal
 * parts. Closed lines get their first point appended. Overshoot extends both ends along their end tangents first.
 * Writes into `out` (reset first) and returns it.
 */
export function resample(points: readonly XYZ[], maxSeg: number, closed: boolean, overshoot: number, out: FloatBuf): FloatBuf {
  out.reset();
  const n = points.length;
  if (n === 0) return out;
  const step = Math.max(1e-3, maxSeg);
  const at = (i: number): XYZ => points[closed ? i % n : i]!;
  const count = closed ? n + 1 : n;
  let px = at(0).x, py = at(0).y, pz = at(0).z;
  if (!closed && overshoot > 0 && n > 1) {
    const q = at(1);
    const dx = px - q.x, dy = py - q.y, dz = pz - q.z;
    const l = Math.hypot(dx, dy, dz);
    if (l > 1e-9) {
      px += (dx / l) * overshoot;
      py += (dy / l) * overshoot;
      pz += (dz / l) * overshoot;
    }
  }
  out.push3(px, py, pz);
  for (let i = 1; i < count; i++) {
    const p = at(i);
    let x = p.x, y = p.y, z = p.z;
    if (!closed && overshoot > 0 && i === count - 1) {
      const q = at(i - 1);
      const dx = x - q.x, dy = y - q.y, dz = z - q.z;
      const l = Math.hypot(dx, dy, dz);
      if (l > 1e-9) {
        x += (dx / l) * overshoot;
        y += (dy / l) * overshoot;
        z += (dz / l) * overshoot;
      }
    }
    const len = Math.hypot(x - px, y - py, z - pz);
    const parts = Math.max(1, Math.ceil(len / step - 1e-9));
    for (let k = 1; k <= parts; k++) {
      const t = k / parts;
      out.push3(px + (x - px) * t, py + (y - py) * t, pz + (z - pz) * t);
    }
    px = x;
    py = y;
    pz = z;
  }
  return out;
}

/** Displaces resampled points by 3D value noise: `p += wobble·(N3(p/22 + offset, seed) - 0.5)` per axis. */
export function wobble(buf: FloatBuf, amount: number, seed: number, p: StrokeParams = STROKE_DEFAULTS): void {
  if (amount <= 0) return;
  const a = buf.a;
  const inv = 1 / p.wobbleWave;
  for (let i = 0; i < buf.n; i += 3) {
    const x = a[i]! * inv, y = a[i + 1]! * inv, z = a[i + 2]! * inv;
    const dx = noise3(x, y, z, seed) - 0.5;
    const dy = noise3(x + 9, y, z, seed) - 0.5;
    const dz = noise3(x, y + 9, z, seed) - 0.5;
    a[i] = a[i]! + amount * dx;
    a[i + 1] = a[i + 1]! + amount * dy;
    a[i + 2] = a[i + 2]! + amount * dz;
  }
}

/** Length of a polyline (mm). */
export function polylineLength(points: readonly XYZ[], closed = false): number {
  let L = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    L += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  if (closed && points.length > 2) {
    const a = points[points.length - 1]!, b = points[0]!;
    L += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return L;
}
