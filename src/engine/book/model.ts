/**
 * The book's shape as pure math (no three.js). From the turn fraction of every leaf unit it solves the spine frame
 * (where the right pile meets the left pile, the apex of the open book, the two page families) and integrates any
 * page curve across its width with Simpson's rule on arc-length samples. Mapping between page millimetres and the
 * book's local space (x right, y up, z toward the reader) is built on the same curves, so pop-ups, flaps and hit
 * tests agree with what is drawn.
 */
import { NS, type Dims } from './dims';

const PI = Math.PI;
const TAU = PI * 2;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Wraps an angle to (-pi, pi]. */
export function wrapAngle(a: number): number {
  a %= TAU;
  if (a > PI) a -= TAU;
  else if (a <= -PI) a += TAU;
  return a;
}

const tables = new Map<number, Float64Array>();

/** I(psi) = integral over [0, 1] of sin(psi * x^n) dx for 513 samples psi in [0, pi] (Simpson, 128 intervals). */
export function integralTable(n: number): Float64Array {
  const hit = tables.get(n);
  if (hit) return hit;
  const t = new Float64Array(513);
  const M = 128;
  for (let k = 0; k <= 512; k++) {
    const psi = (PI * k) / 512;
    let sum = Math.sin(0) + Math.sin(psi);
    for (let i = 1; i < M; i++) sum += (i % 2 ? 4 : 2) * Math.sin(psi * Math.pow(i / M, n));
    t[k] = sum / (3 * M);
  }
  tables.set(n, t);
  return t;
}

export function integralLookup(table: Float64Array, psi: number): number {
  const a = (Math.min(PI, Math.abs(psi)) / PI) * 512;
  const s = Math.min(511, Math.floor(a));
  const f = a - s;
  return table[s]! + (table[s + 1]! - table[s]!) * f;
}

/** A page-curve family: origin and direction of its spine line, the flat angle pages settle at, and the root angle. */
export interface Family { ox: number; oy: number; ex: number; ey: number; flat: number; root: number; psi: number; I: number }

const newFamily = (): Family => ({ ox: 0, oy: 0, ex: 1, ey: 0, flat: 0, root: 0, psi: 0, I: 0 });

function setFamily(f: Family, ox: number, oy: number, ex: number, ey: number, flat: number, table: Float64Array): void {
  f.ox = ox; f.oy = oy; f.ex = ex; f.ey = ey; f.flat = flat;
  const r = Math.atan2(ey, ex);
  const c1 = wrapAngle(r + PI / 2);
  const c2 = wrapAngle(r - PI / 2);
  f.root = Math.abs(wrapAngle(c1 - flat)) <= Math.abs(wrapAngle(c2 - flat)) ? c1 : c2;
  f.psi = wrapAngle(f.root - flat);
  f.I = integralLookup(table, f.psi);
}

/** Bend length of a page at stack offset t from the family origin: it ends flat exactly t above the hinge. */
export function bendLength(f: Family, t: number): number {
  return f.I <= 1e-7 ? 0 : (t * (1 - Math.cos(f.psi))) / f.I;
}

export interface Frame {
  split: number; t0: number; omega: number;
  apexX: number; apexY: number; b: number; M: number;
  betaR: number; betaL: number;
  Ax: number; Ay: number; RTx: number; RTy: number;
  CRx: number; CRy: number;
  famR: Family; famL: Family;
}

export const newFrame = (): Frame => ({
  split: 0, t0: 0, omega: 0, apexX: 0, apexY: 0, b: 0, M: 0, betaR: 0, betaL: 0, Ax: 0, Ay: 0, RTx: 0, RTy: 0, CRx: 0, CRy: 0,
  famR: newFamily(), famL: newFamily(),
});

/** Frame solve: from the turn fractions c[0..N-1] find the split, apex, spine lines and both page families. */
export function solveFrame(d: Dims, c: ArrayLike<number>, table: Float64Array, out: Frame = newFrame()): Frame {
  const { T, F, L, CX, Yb, N } = d;
  let h = 0;
  for (let i = 1; i < N; i++) h += c[i]!;
  const split = T - F - L * h;
  const t0 = clamp(c[0]!, 0, 1);
  const m = split, g = T - split, y = 2 * CX;
  const cc = (g * g - m * m + y * y) / (2 * y);
  const u = Math.sqrt(Math.max(0, g * g - cc * cc));
  const Px = -CX + cc, Py = Yb + u;
  const b = Math.atan2(Py - Yb, Px - CX);
  let M = Math.atan2(Yb - Py, -CX - Px);
  if (M < 0) M += TAU;
  const omega = smoothstep(0.35, 1, t0);
  const flat0 = PI * t0;
  const betaR = PI / 2 + omega * (b - PI / 2);
  const Ax = CX + split * Math.cos(betaR), Ay = Yb + split * Math.sin(betaR);
  const betaL = flat0 - omega * (1.5 * PI - M) + PI / 2;
  const RTx = Ax + (T - split) * Math.cos(betaL), RTy = Ay + (T - split) * Math.sin(betaL);
  Object.assign(out, { split, t0, omega, apexX: Px, apexY: Py, b, M, betaR, betaL, Ax, Ay, RTx, RTy, CRx: CX, CRy: Yb });
  setFamily(out.famR, CX, Yb, Math.cos(betaR), Math.sin(betaR), 0, table);
  setFamily(out.famL, RTx, RTy, -Math.cos(betaL), -Math.sin(betaL), flat0, table);
  return out;
}

/** One integrated page curve: NS + 1 samples of position and angle at the arc-length samples S. */
export interface Curve {
  x: Float64Array; y: Float64Array; a: Float64Array;
  /** Cache keys (rounded). */
  kSig: number; kTurn: number; kS: number; noCurl: boolean;
}

const newCurve = (): Curve => ({ x: new Float64Array(NS + 1), y: new Float64Array(NS + 1), a: new Float64Array(NS + 1), kSig: NaN, kTurn: NaN, kS: NaN, noCurl: false });

// Scratch for the angle function (module level so integration allocates nothing).
const A = { u: 0, v: 0, W: 1, n: 2.5, mR: 0, mL: 0, pR: 0, pL: 0, famR: newFamily(), famL: newFamily() };

function profile(f: Family, m: number, p: number, s: number, W: number, n: number): number {
  let o = 0;
  if (p !== 0 && s > m) o = (p * (s - m)) / Math.max(1, W - m);
  if (s >= m || m <= 0) return f.flat + o;
  return f.flat + f.psi * Math.pow(1 - s / m, n);
}

function angleAt(s: number): number {
  let a: number;
  if (A.u <= 0) a = profile(A.famR, A.mR, A.pR, s, A.W, A.n);
  else if (A.u >= 1) a = profile(A.famL, A.mL, A.pL, s, A.W, A.n);
  else a = (1 - A.u) * profile(A.famR, A.mR, A.pR, s, A.W, A.n) + A.u * profile(A.famL, A.mL, A.pL, s, A.W, A.n);
  if (A.v !== 0) a += A.v * Math.pow(s / A.W, 1.6);
  return a;
}

/** Point on the broken spine line at stack coordinate sigma. */
export function spineLinePoint(d: Dims, f: Frame, sigma: number, out: { x: number; y: number }): { x: number; y: number } {
  if (sigma <= f.split) {
    out.x = f.CRx + sigma * Math.cos(f.betaR);
    out.y = f.CRy + sigma * Math.sin(f.betaR);
  } else {
    out.x = f.Ax + (sigma - f.split) * Math.cos(f.betaL);
    out.y = f.Ay + (sigma - f.split) * Math.sin(f.betaL);
  }
  return out;
}

const tmpP = { x: 0, y: 0 };

/**
 * Integrates one page curve at stack coordinate sigma, turn fraction a (0 lying right, 1 lying left), z-parameter s
 * in [-1, 1] (z / (D/2)) and the no-curl flag.
 */
export function integrateCurve(d: Dims, f: Frame, sigma: number, a: number, s: number, noCurl: boolean, out: Curve): Curve {
  const { T, W, S } = d;
  const mR = bendLength(f.famR, sigma);
  const mL = bendLength(f.famL, T - sigma);
  let x0: number, y0: number;
  if (a <= 0) {
    x0 = f.CRx + sigma * Math.cos(f.betaR);
    y0 = f.CRy + sigma * Math.sin(f.betaR);
    const k = f.split > 0 ? Math.min(1, sigma / f.split) : 0;
    const w = (1 - f.omega) * (1 - f.omega);
    const bulge = d.BULGE * 4 * k * (1 - k) * w;
    x0 -= bulge * Math.cos(f.famR.root);
    y0 -= bulge * Math.sin(f.famR.root);
  } else if (a >= 1) {
    x0 = f.RTx + (T - sigma) * f.famL.ex;
    y0 = f.RTy + (T - sigma) * f.famL.ey;
  } else {
    spineLinePoint(d, f, sigma, tmpP);
    x0 = tmpP.x;
    y0 = tmpP.y;
  }
  const u = clamp(a, 0, 1);
  const v = noCurl || u === 0 || u === 1 ? 0 : d.CURL * Math.sin(TAU * u) * (1 + d.CURL_Z * s);
  const sgn = -f.famL.psi < 0 ? -1 : 1;
  A.u = u; A.v = v; A.W = W; A.n = d.DIP_N; A.mR = mR; A.mL = mL;
  A.pR = -d.DROOP * sigma * f.omega;
  A.pL = d.DROOP * (T - sigma) * f.omega * sgn;
  A.famR = f.famR; A.famL = f.famL;
  let x = x0, y = y0;
  let aPrev = angleAt(S[0]!);
  out.x[0] = x; out.y[0] = y; out.a[0] = aPrev;
  for (let k = 1; k <= NS; k++) {
    const s0 = S[k - 1]!, s1 = S[k]!;
    const am = angleAt((s0 + s1) / 2), a1 = angleAt(s1);
    const h = (s1 - s0) / 6;
    x += h * (Math.cos(aPrev) + 4 * Math.cos(am) + Math.cos(a1));
    y += h * (Math.sin(aPrev) + 4 * Math.sin(am) + Math.sin(a1));
    out.x[k] = x; out.y[k] = y; out.a[k] = a1;
    aPrev = a1;
  }
  return out;
}

export type Face = 'a' | 'b';
export type PageSide = 'left' | 'right';

export interface Sample { x: number; y: number; a: number }
export interface LocalPoint { x: number; y: number; z: number; a: number; face: Face }
export interface PageCoord { k: number; side: PageSide; u: number; v: number; distance: number }

/** Stateful model: turn fractions, frame and a per-version curve cache. */
export class BookModel {
  d: Dims;
  /** Turn fraction per leaf unit, 0 = lying right, 1 = lying left. */
  c: Float64Array;
  readonly frame: Frame = newFrame();
  version = 0;
  private table: Float64Array;
  private dirty = true;
  private pool: Curve[] = [];
  private used = 0;

  constructor(d: Dims) {
    this.d = d;
    this.c = new Float64Array(d.N);
    this.table = integralTable(d.DIP_N);
  }

  setDims(d: Dims): void {
    const old = this.c;
    this.d = d;
    if (old.length !== d.N) {
      this.c = new Float64Array(d.N);
      this.c.set(old.subarray(0, Math.min(old.length, d.N)));
    }
    this.table = integralTable(d.DIP_N);
    this.dirty = true;
  }

  markDirty(): void {
    this.dirty = true;
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  get position(): number {
    let p = 0;
    for (let i = 0; i < this.c.length; i++) p += this.c[i]!;
    return p;
  }

  setPosition(P: number): void {
    for (let i = 0; i < this.c.length; i++) this.c[i] = clamp(P - i, 0, 1);
    this.dirty = true;
  }

  /** Rebuilds the frame and clears the curve cache when dirty. Returns true if it rebuilt. */
  ensure(): boolean {
    if (!this.dirty) return false;
    solveFrame(this.d, this.c, this.table, this.frame);
    this.used = 0;
    this.version++;
    this.dirty = false;
    return true;
  }

  /** Top sigma of leaf unit t. */
  top(t: number): number {
    return this.d.B + (this.d.N - t) * this.d.L;
  }

  /** Sigma range [lo, hi] of leaf unit t (0 front block, N back block). */
  range(t: number, out: [number, number] = [0, 0]): [number, number] {
    const { N, T, B } = this.d;
    if (t <= 0) { out[0] = this.top(1); out[1] = T; }
    else if (t >= N) { out[0] = 0; out[1] = B; }
    else { out[0] = this.top(t + 1); out[1] = this.top(t); }
    return out;
  }

  /** Cached page curve. Curves stay valid until the model changes (next rebuild). */
  curve(sigma: number, a: number, s: number, noCurl: boolean): Curve {
    this.ensure();
    const kSig = Math.round(sigma * 1e4), kTurn = Math.round(a * 1e5), kS = Math.round(s * 1e3);
    for (let i = 0; i < this.used; i++) {
      const c = this.pool[i]!;
      if (c.kSig === kSig && c.kTurn === kTurn && c.kS === kS && c.noCurl === noCurl) return c;
    }
    let c = this.pool[this.used];
    if (!c) this.pool.push((c = newCurve()));
    this.used++;
    c.kSig = kSig; c.kTurn = kTurn; c.kS = kS; c.noCurl = noCurl;
    return integrateCurve(this.d, this.frame, sigma, a, s, noCurl, c);
  }

  private rng: [number, number] = [0, 0];

  /** The curve of a page face: face b is the top of a unit (a right page), face a its bottom (a left page). */
  faceCurve(unit: number, face: Face, q: number): Curve {
    const R = unit >= this.d.N ? 0 : this.c[unit]!;
    const r = this.range(unit, this.rng);
    const sigma = face === 'b' ? r[1] : r[0];
    const turning = R > 0 && R < 1;
    if (unit === 0 && turning) return this.curve(sigma, 1, 0, true);
    return this.curve(sigma, R, turning ? q : 0, unit === 0);
  }

  /** Samples a curve at arc length s (binary search in S, linear interpolation). */
  sample(c: Curve, s: number, out: Sample): Sample {
    const S = this.d.S;
    if (s <= 0) { out.x = c.x[0]!; out.y = c.y[0]!; out.a = c.a[0]!; return out; }
    if (s >= S[NS]!) {
      // Past the fore-edge: extend along the last tangent.
      const e = s - S[NS]!, a = c.a[NS]!;
      out.x = c.x[NS]! + e * Math.cos(a); out.y = c.y[NS]! + e * Math.sin(a); out.a = a;
      return out;
    }
    let lo = 0, hi = NS;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (S[mid]! <= s) lo = mid;
      else hi = mid;
    }
    const f = (s - S[lo]!) / (S[hi]! - S[lo]!);
    out.x = c.x[lo]! + (c.x[hi]! - c.x[lo]!) * f;
    out.y = c.y[lo]! + (c.y[hi]! - c.y[lo]!) * f;
    out.a = c.a[lo]! + (c.a[hi]! - c.a[lo]!) * f;
    return out;
  }

  private smp: Sample = { x: 0, y: 0, a: 0 };

  /** Page (spread k, side, u, v) in page mm to book-local coordinates and the surface angle. */
  pageLocal(k: number, side: PageSide, u: number, v: number, out: LocalPoint): LocalPoint {
    const { N, W, D } = this.d;
    const unit = side === 'right' ? Math.min(k, N) : k - 1;
    const face: Face = side === 'right' ? 'b' : 'a';
    const s = side === 'right' ? u : W - u;
    const z = v - D / 2;
    const c = this.faceCurve(unit, face, clamp(z / (D / 2), -1, 1));
    this.sample(c, s, this.smp);
    out.x = this.smp.x; out.y = this.smp.y; out.z = z; out.a = this.smp.a; out.face = face;
    return out;
  }

  /** Index of the first unit of the resting right pile (iR) and the last fully turned unit (iL). */
  piles(out: { iR: number; iL: number } = { iR: 0, iL: -1 }): { iR: number; iL: number } {
    const N = this.d.N, c = this.c;
    let iR = N;
    for (let i = N - 1; i >= 0; i--) {
      if (c[i] === 0) iR = i;
      else break;
    }
    let iL = -1;
    for (let i = 0; i < N; i++) {
      if (c[i] === 1) iL = i;
      else break;
    }
    out.iR = iR; out.iL = iL;
    return out;
  }

  /** The open spread, or 0 when the book is closed or a leaf is in motion. */
  openSpread(): number {
    const p = this.piles(this.pl);
    return p.iR === p.iL + 1 && p.iR >= 1 ? p.iR : 0;
  }

  private pl = { iR: 0, iL: -1 };

  /** Nearest point on a curve polyline (in x, y) to a point: arc length and distance. */
  nearest(c: Curve, x: number, y: number, out: { s: number; dist: number }): { s: number; dist: number } {
    const S = this.d.S;
    let best = Infinity, bestS = 0;
    for (let k = 0; k < NS; k++) {
      const ax = c.x[k]!, ay = c.y[k]!, bx = c.x[k + 1]!, by = c.y[k + 1]!;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? clamp(((x - ax) * dx + (y - ay) * dy) / len2, 0, 1) : 0;
      const px = ax + dx * t - x, py = ay + dy * t - y;
      const d2 = px * px + py * py;
      if (d2 < best) {
        best = d2;
        bestS = S[k]! + (S[k + 1]! - S[k]!) * t;
      }
    }
    out.s = bestS;
    out.dist = Math.sqrt(best);
    return out;
  }

  private nl = { s: 0, dist: 0 };
  private nr = { s: 0, dist: 0 };

  /** Book-local point to the nearest page of the open (or nearest) spread. Null while the book is closed. */
  localToPage(x: number, y: number, z: number): PageCoord | null {
    const { N, W, D } = this.d;
    const pos = this.position;
    if (pos < 0.5) return null;
    const k = this.openSpread() || clamp(Math.round(pos), 1, N);
    const q = clamp(z / (D / 2), -1, 1);
    const left = this.nearest(this.faceCurve(k - 1, 'a', q), x, y, this.nl);
    const right = this.nearest(this.faceCurve(Math.min(k, N), 'b', q), x, y, this.nr);
    if (left.dist < right.dist) return { k, side: 'left', u: W - left.s, v: z + D / 2, distance: left.dist };
    return { k, side: 'right', u: right.s, v: z + D / 2, distance: right.dist };
  }
}
