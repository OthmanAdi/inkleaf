/**
 * A curved track y(x) through knots: a natural cubic spline (zero curvature at both ends) with an exact arc-length
 * table (5-point Gauss-Legendre on many sub-intervals), so a ball's distance along the track and its position on
 * screen agree to the micrometre.
 */

/** 5-point Gauss-Legendre nodes and weights on [-1, 1]. */
export const GL5_NODES = [-0.906179845938664, -0.5384693101056831, 0, 0.5384693101056831, 0.906179845938664] as const;
export const GL5_WEIGHTS = [0.23692688505618908, 0.47862867049936647, 0.5688888888888889, 0.47862867049936647, 0.23692688505618908] as const;

/** Integral of f over [a, b] with 5-point Gauss-Legendre. */
export function gaussLegendre5(f: (x: number) => number, a: number, b: number): number {
  const m = 0.5 * (a + b);
  const r = 0.5 * (b - a);
  let s = 0;
  for (let k = 0; k < 5; k++) s += GL5_WEIGHTS[k]! * f(m + r * GL5_NODES[k]!);
  return r * s;
}

export class Track {
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  /** Per segment: y = A + B d + C d^2 + D d^3 with d = x - x_i. */
  private readonly A: Float64Array;
  private readonly B: Float64Array;
  private readonly C: Float64Array;
  private readonly D: Float64Array;
  readonly sub: number;
  /** Arc-length table at every sub-interval boundary: x, s, ds/dx. */
  readonly tx: Float64Array;
  readonly ts: Float64Array;
  readonly tm: Float64Array;
  readonly length: number;

  constructor(xs: readonly number[], ys: readonly number[], sub = 512) {
    const n = xs.length;
    if (n < 2 || ys.length !== n) throw new Error('inkleaf: a track needs at least two knots with matching x and y');
    for (let i = 1; i < n; i++) if (!(xs[i]! > xs[i - 1]!)) throw new Error('inkleaf: track knots must increase in x');
    this.xs = Float64Array.from(xs);
    this.ys = Float64Array.from(ys);
    const segs = n - 1;
    this.A = new Float64Array(segs);
    this.B = new Float64Array(segs);
    this.C = new Float64Array(segs);
    this.D = new Float64Array(segs);
    this.solve();
    this.sub = Math.max(1, Math.floor(sub));
    const count = segs * this.sub + 1;
    this.tx = new Float64Array(count);
    this.ts = new Float64Array(count);
    this.tm = new Float64Array(count);
    const f = (x: number) => Math.sqrt(1 + this.dy(x) ** 2);
    let s = 0;
    let k = 0;
    for (let i = 0; i < segs; i++) {
      const x0 = this.xs[i]!;
      const hx = (this.xs[i + 1]! - x0) / this.sub;
      for (let j = 0; j < this.sub; j++) {
        const a = x0 + j * hx;
        this.tx[k] = a;
        this.ts[k] = s;
        this.tm[k] = f(a);
        s += gaussLegendre5(f, a, a + hx);
        k++;
      }
    }
    this.tx[k] = this.xs[segs]!;
    this.ts[k] = s;
    this.tm[k] = f(this.xs[segs]!);
    this.length = s;
  }

  /** Natural cubic spline: tridiagonal solve for the second derivatives. */
  private solve(): void {
    const { xs, ys } = this;
    const n = xs.length;
    const M = new Float64Array(n);
    if (n > 2) {
      const h = (i: number) => xs[i + 1]! - xs[i]!;
      const m = n - 2;
      const a = new Float64Array(m);
      const b = new Float64Array(m);
      const c = new Float64Array(m);
      const r = new Float64Array(m);
      for (let i = 1; i <= m; i++) {
        a[i - 1] = h(i - 1);
        b[i - 1] = 2 * (h(i - 1) + h(i));
        c[i - 1] = h(i);
        r[i - 1] = 6 * ((ys[i + 1]! - ys[i]!) / h(i) - (ys[i]! - ys[i - 1]!) / h(i - 1));
      }
      for (let i = 1; i < m; i++) {
        const w = a[i]! / b[i - 1]!;
        b[i] = b[i]! - w * c[i - 1]!;
        r[i] = r[i]! - w * r[i - 1]!;
      }
      M[m] = r[m - 1]! / b[m - 1]!;
      for (let i = m - 2; i >= 0; i--) M[i + 1] = (r[i]! - c[i]! * M[i + 2]!) / b[i]!;
    }
    for (let i = 0; i < n - 1; i++) {
      const hi = xs[i + 1]! - xs[i]!;
      this.A[i] = ys[i]!;
      this.B[i] = (ys[i + 1]! - ys[i]!) / hi - (hi * (2 * M[i]! + M[i + 1]!)) / 6;
      this.C[i] = M[i]! / 2;
      this.D[i] = (M[i + 1]! - M[i]!) / (6 * hi);
    }
  }

  get xStart(): number {
    return this.xs[0]!;
  }
  get xEnd(): number {
    return this.xs[this.xs.length - 1]!;
  }

  /** Segment index for x (clamped; outside the knots the end cubics extrapolate). */
  seg(x: number): number {
    const xs = this.xs;
    let lo = 0;
    let hi = xs.length - 2;
    if (x <= xs[1]!) return 0;
    if (x >= xs[hi]!) return hi;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid]! <= x) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  y(x: number): number {
    const i = this.seg(x);
    const d = x - this.xs[i]!;
    return this.A[i]! + d * (this.B[i]! + d * (this.C[i]! + d * this.D[i]!));
  }

  dy(x: number): number {
    const i = this.seg(x);
    const d = x - this.xs[i]!;
    return this.B[i]! + d * (2 * this.C[i]! + 3 * d * this.D[i]!);
  }

  d2y(x: number): number {
    const i = this.seg(x);
    const d = x - this.xs[i]!;
    return 2 * this.C[i]! + 6 * d * this.D[i]!;
  }

  private tableIndex(x: number): number {
    const i = this.seg(x);
    const x0 = this.xs[i]!;
    const hx = (this.xs[i + 1]! - x0) / this.sub;
    const j = Math.min(this.sub - 1, Math.max(0, Math.floor((x - x0) / hx)));
    return i * this.sub + j;
  }

  /** Arc length from the first knot to x (cubic Hermite on the table). */
  s(x: number): number {
    if (x <= this.xStart) return 0;
    if (x >= this.xEnd) return this.length;
    const k = this.tableIndex(x);
    const x0 = this.tx[k]!;
    const x1 = this.tx[k + 1]!;
    const hx = x1 - x0;
    const t = (x - x0) / hx;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * this.ts[k]! + (t3 - 2 * t2 + t) * hx * this.tm[k]! + (-2 * t3 + 3 * t2) * this.ts[k + 1]! + (t3 - t2) * hx * this.tm[k + 1]!;
  }

  /** ds/dx = sqrt(1 + y'(x)^2). */
  dsdx(x: number): number {
    const e = this.dy(x);
    return Math.sqrt(1 + e * e);
  }

  /** x at arc length s: Newton (8 iterations) inside the table bracket. */
  x(s: number): number {
    if (s <= 0) return this.xStart;
    if (s >= this.length) return this.xEnd;
    const ts = this.ts;
    let lo = 0;
    let hi = ts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ts[mid]! <= s) lo = mid;
      else hi = mid;
    }
    const a = this.tx[lo]!;
    const b = this.tx[hi]!;
    let x = a + ((s - ts[lo]!) / (ts[hi]! - ts[lo]!)) * (b - a);
    for (let it = 0; it < 8; it++) {
      const step = (this.s(x) - s) / this.dsdx(x);
      const nx = Math.min(b, Math.max(a, x - step));
      const moved = Math.abs(nx - x);
      x = nx;
      if (moved < 1e-15) break;
    }
    return x;
  }

  /** Root of y' in [a, b] by bisection (the valley floor between two slopes). */
  valley(a: number, b: number, iterations = 200): number {
    let lo = a;
    let hi = b;
    const flo = this.dy(lo);
    for (let i = 0; i < iterations; i++) {
      const mid = 0.5 * (lo + hi);
      if (Math.sign(this.dy(mid)) === Math.sign(flo)) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  /** x in [a, b] where the track height is h (bisection; y must cross h once in the interval). */
  xAtHeight(h: number, a: number, b: number, iterations = 200): number {
    let lo = a;
    let hi = b;
    const flo = this.y(lo) - h;
    for (let i = 0; i < iterations; i++) {
      const mid = 0.5 * (lo + hi);
      if (Math.sign(this.y(mid) - h) === Math.sign(flo)) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  /** Samples the track as points (x, y) every `step` of x, for drawing. */
  points(step = 0.01): [number, number][] {
    const out: [number, number][] = [];
    const n = Math.max(2, Math.ceil((this.xEnd - this.xStart) / step) + 1);
    for (let i = 0; i < n; i++) {
      const x = this.xStart + ((this.xEnd - this.xStart) * i) / (n - 1);
      out.push([x, this.y(x)]);
    }
    return out;
  }
}
