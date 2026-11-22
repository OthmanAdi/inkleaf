/**
 * Shapes that follow the page block: the spine cloth profile (spine line offset outward, Chaikin-smoothed and
 * resampled), the head-band path and the ribbon drape (rows riding the page curve, then a Catmull-Rom tail down to
 * the desk). Pure math on the BookModel; buffers are preallocated so rebuilding allocates nothing.
 */
import { CatmullRomCurve3, Vector3 } from 'three';
import { smoothstep, spineLinePoint, type BookModel } from './model';

export interface DrapeParams {
  hollowMin: number;
  bulgeOffset: number;
  spineSamples: number;
  spineSections: number;
  bandOffset: number;
  bandPoints: number;
}

const MAX = 600;

/** Chaikin corner cutting keeping both end points. n points in, 2(n - 1) + 2 - 2 = 2n - 2 points out. */
function chaikin(src: Float64Array, n: number, dst: Float64Array): number {
  let k = 0;
  dst[k++] = src[0]!; dst[k++] = src[1]!;
  for (let i = 0; i < n - 1; i++) {
    const ax = src[i * 2]!, ay = src[i * 2 + 1]!, bx = src[i * 2 + 2]!, by = src[i * 2 + 3]!;
    if (i > 0) { dst[k++] = 0.75 * ax + 0.25 * bx; dst[k++] = 0.75 * ay + 0.25 * by; }
    if (i < n - 2) { dst[k++] = 0.25 * ax + 0.75 * bx; dst[k++] = 0.25 * ay + 0.75 * by; }
  }
  dst[k++] = src[(n - 1) * 2]!; dst[k++] = src[(n - 1) * 2 + 1]!;
  return k / 2;
}

/** Resamples a polyline to m points evenly spaced by arc length. Returns the total length. */
function resample(src: Float64Array, n: number, m: number, dst: Float64Array, cum: Float64Array): number {
  cum[0] = 0;
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1]! + Math.hypot(src[i * 2]! - src[i * 2 - 2]!, src[i * 2 + 1]! - src[i * 2 - 1]!);
  const total = cum[n - 1]!;
  let seg = 0;
  for (let j = 0; j < m; j++) {
    const s = (total * j) / (m - 1);
    while (seg < n - 2 && cum[seg + 1]! < s) seg++;
    const l = cum[seg + 1]! - cum[seg]!;
    const f = l > 0 ? Math.min(1, Math.max(0, (s - cum[seg]!) / l)) : 0;
    dst[j * 2] = src[seg * 2]! + (src[seg * 2 + 2]! - src[seg * 2]!) * f;
    dst[j * 2 + 1] = src[seg * 2 + 1]! + (src[seg * 2 + 3]! - src[seg * 2 + 1]!) * f;
  }
  return total;
}

export class Drape {
  /** Spine outer and inner points (sections x xy). */
  readonly outer: Float64Array;
  readonly inner: Float64Array;
  labelCenter = 0;
  /** Head-band path (bandPoints x xy). */
  readonly band: Float64Array;
  private a = new Float64Array(MAX * 2);
  private b = new Float64Array(MAX * 2);
  private cum = new Float64Array(MAX);
  private p = { x: 0, y: 0 };
  private nrm = { x: 0, y: 0 };
  private cr = new CatmullRomCurve3([0, 1, 2, 3, 4, 5, 6, 7].map(() => new Vector3()), false, 'centripetal');
  private v = new Vector3();

  constructor(readonly params: DrapeParams) {
    this.outer = new Float64Array(params.spineSections * 2);
    this.inner = new Float64Array(params.spineSections * 2);
    this.band = new Float64Array(params.bandPoints * 2);
  }

  /** Spine-line point plus outward normal at stack coordinate L (extended beyond 0..T along the end lines). */
  spineAt(m: BookModel, L: number, out: { x: number; y: number }, nrm: { x: number; y: number }): void {
    const d = m.d, f = m.frame;
    if (L < 0) {
      out.x = f.CRx + L * Math.cos(f.betaR);
      out.y = f.CRy + L * Math.sin(f.betaR);
    } else if (L > d.T) {
      out.x = f.RTx + (L - d.T) * Math.cos(f.betaL);
      out.y = f.RTy + (L - d.T) * Math.sin(f.betaL);
    } else spineLinePoint(d, f, L, out);
    const w = smoothstep(f.split - 2.5, f.split + 2.5, L);
    let nx = -(1 - w) * Math.cos(f.famR.root) - w * Math.cos(f.famL.root);
    let ny = -(1 - w) * Math.sin(f.famR.root) - w * Math.sin(f.famL.root);
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    nrm.x = nx; nrm.y = ny;
    if (L > 0 && L < f.split) {
      const K = L / f.split;
      const bulge = d.BULGE * 4 * K * (1 - K) * (1 - f.omega) * (1 - f.omega);
      out.x -= bulge * Math.cos(f.famR.root);
      out.y -= bulge * Math.sin(f.famR.root);
    }
  }

  /** Spine cloth profile from the back board's bottom edge round the spine to the front board's outer surface. */
  spine(m: BookModel, frontOrigin: { x: number; y: number }, frontNormal: { x: number; y: number }): void {
    const d = m.d, f = m.frame, P = this.params;
    const A = this.a;
    let n = 0;
    A[n * 2] = d.CX + d.JOINT; A[n * 2 + 1] = d.Yb - d.BOARD; n++;
    const samples = P.spineSamples;
    const span = d.T + 6;
    let mid = 0, best = Infinity;
    for (let i = 0; i < samples; i++) {
      const B = -3 + (span * i) / (samples - 1);
      this.spineAt(m, B, this.p, this.nrm);
      const Q = (B + 3) / span;
      const off = d.HOLLOW * (P.hollowMin + (1 - P.hollowMin) * f.omega) + d.SPINE + P.bulgeOffset * 4 * Q * (1 - Q) * (1 - f.omega);
      A[n * 2] = this.p.x + this.nrm.x * off;
      A[n * 2 + 1] = Math.max(d.Yb - d.BOARD + 0.02, this.p.y + this.nrm.y * off);
      if (Math.abs(B - d.T / 2) < best) { best = Math.abs(B - d.T / 2); mid = n; }
      n++;
    }
    A[n * 2] = frontOrigin.x + d.BOARD * frontNormal.x;
    A[n * 2 + 1] = frontOrigin.y + d.BOARD * frontNormal.y;
    n++;
    let raw = 0, upto = 0;
    for (let i = 1; i < n; i++) {
      raw += Math.hypot(A[i * 2]! - A[i * 2 - 2]!, A[i * 2 + 1]! - A[i * 2 - 1]!);
      if (i === mid) upto = raw;
    }
    const arcFrac = raw > 0 ? upto / raw : 0.5;
    n = chaikin(this.a, n, this.b);
    n = chaikin(this.b, n, this.a);
    n = chaikin(this.a, n, this.b);
    const S = P.spineSections;
    const total = resample(this.b, n, S, this.outer, this.cum);
    this.labelCenter = arcFrac * total;
    const o = this.outer;
    for (let i = 0; i < S; i++) {
      const ip = Math.max(0, i - 1), inx = Math.min(S - 1, i + 1);
      const tx = o[inx * 2]! - o[ip * 2]!, ty = o[inx * 2 + 1]! - o[ip * 2 + 1]!;
      const l = Math.hypot(tx, ty) || 1;
      this.inner[i * 2] = o[i * 2]! + (d.SPINE * ty) / l;
      this.inner[i * 2 + 1] = o[i * 2 + 1]! - (d.SPINE * tx) / l;
    }
  }

  /** Head-band path: 17 spine samples lifted off the spine line, smoothed twice and resampled. */
  bandPath(m: BookModel): void {
    const d = m.d, A = this.a;
    let n = 0;
    for (let i = 0; i <= 16; i++) {
      this.spineAt(m, (d.T * i) / 16, this.p, this.nrm);
      A[n * 2] = this.p.x + this.nrm.x * this.params.bandOffset;
      A[n * 2 + 1] = this.p.y + this.nrm.y * this.params.bandOffset;
      n++;
    }
    n = chaikin(this.a, n, this.b);
    n = chaikin(this.b, n, this.a);
    resample(this.a, n, this.params.bandPoints, this.band, this.cum);
  }

  /**
   * Ribbon rows: `pageRows` rows on the page of spread `spread` (right page, face b of its leaf), then `tailRows`
   * rows down a Catmull-Rom tail onto the desk. Writes rows x cols x xyz into `out`.
   */
  ribbon(
    m: BookModel, spread: number, out: Float64Array, cols: number, pageRows: number, tailRows: number,
    opts: { width: number; offset: number; lift: number; tail: number },
  ): void {
    const d = m.d, f = m.frame;
    const Lr = Math.min(d.N, Math.max(1, Math.round(spread)));
    const tr = Lr >= d.N ? 0 : m.c[Lr]!;
    const sig = m.range(Lr)[1];
    const turning = tr > 0 && tr < 1;
    const smp = { x: 0, y: 0, a: 0 };
    for (let j = 0; j < pageRows; j++) {
      const z = -d.D / 2 + 1 + ((d.D - 2) * j) / (pageRows - 1);
      const c = m.curve(sig, tr, turning ? z / (d.D / 2) : 0, false);
      for (let col = 0; col < cols; col++) {
        const s = opts.offset + (-1 + (2 * col) / (cols - 1)) * (opts.width / 2);
        m.sample(c, s, smp);
        const k = (j * cols + col) * 3;
        out[k] = smp.x - opts.lift * Math.sin(smp.a);
        out[k + 1] = smp.y + opts.lift * Math.cos(smp.a);
        out[k + 2] = z;
      }
    }
    const midCol = (cols - 1) >> 1;
    const last = ((pageRows - 1) * cols + midCol) * 3;
    const xe = out[last]!, ye = out[last + 1]!, ze = out[last + 2]!;
    const Oe = d.Yb - d.BOARD;
    let F = Oe;
    if (xe > d.CX + d.JOINT - 0.5) F = d.Yb;
    else if (f.t0 >= 1 && xe < -(d.CX + d.JOINT) + 0.5) F = d.Yb;
    else {
      const o = this.outer;
      for (let i = 0; i < this.params.spineSections; i++) if (Math.abs(o[i * 2]! - xe) <= 4.5) F = Math.max(F, o[i * 2 + 1]!);
    }
    F = Math.max(F, Oe);
    const Bz = d.D / 2, OV = d.OVER, T = opts.tail;
    const pts = this.cr.points;
    const set = (i: number, x: number, y: number, z: number) => pts[i]!.set(x, y, z);
    set(0, xe, ye, ze);
    set(1, xe, ye + 0.25, Bz + 1);
    set(2, xe + 0.3, (ye + F) / 2 + 0.6, Bz + 2.2);
    set(3, xe + 0.6, F + 0.45, Bz + OV - 0.3);
    set(4, xe + 1, F + 0.15, Bz + OV + 1.3);
    set(5, xe + 2.2, Oe + 0.2, Bz + OV + 7.5 * (T / 56));
    set(6, xe + 5, Oe + 0.2, Bz + OV + 30 * (T / 56));
    set(7, xe + 8.5, Oe + 0.2, Bz + OV + T);
    const rowBase = (pageRows - 1) * cols * 3;
    for (let i = 1; i <= tailRows; i++) {
      const q = i / tailRows;
      this.cr.getPoint(q, this.v);
      let y = this.v.y;
      if (this.v.z > Bz + 0.5) y = Math.max(y, this.v.z < Bz + OV + 0.6 ? F + 0.15 : Oe + 0.18);
      const w = smoothstep(0, 0.12, q);
      const r = pageRows - 1 + i;
      for (let col = 0; col < cols; col++) {
        const k0 = rowBase + col * 3;
        const sx = out[k0]! - xe, sy = out[k0 + 1]! - ye;
        const fx = (-1 + (2 * col) / (cols - 1)) * (opts.width / 2);
        const k = (r * cols + col) * 3;
        out[k] = this.v.x + sx * (1 - w) + fx * w;
        out[k + 1] = y + sy * (1 - w);
        out[k + 2] = this.v.z;
      }
    }
  }
}
