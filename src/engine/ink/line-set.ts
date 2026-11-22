/**
 * A set of pen strokes drawn with one ink material: one triangle-strip ribbon per polyline (two vertices per point)
 * in a single mesh, plus a flat twin (a child mesh) that shows the not-yet-drawn part lying on the page during the
 * peel. Static sets are built once with exact allocation; dynamic sets (`capacity > 0`, live outlines, steam,
 * rings) rewrite their geometry every frame and grow by 1.5x when they run out of room.
 */
import {
  BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh, Sphere, StaticDrawUsage, Vector3, type Material, type ShaderMaterial,
} from 'three';
import type { LineOptions, LineSet, PenSchedule } from '../contracts';
import { createFlatMaterial, type InkMaterial } from './line-material';
import { FloatBuf, resample, STROKE_DEFAULTS, widthProfile, wobble, type StrokeParams, type XYZ } from './stroke';

interface LineRec {
  pts: Float32Array;
  n: number;
  arc: Float32Array;
  L: number;
  t0: number;
  dur: number;
  sched?: PenSchedule;
  width: number;
  seed: number;
  taper: boolean;
  closed: boolean;
  vis: number;
}

interface Arrays {
  position: Float32Array;
  aPrev: Float32Array;
  aNext: Float32Array;
  aS: Float32Array;
  aLine: Float32Array;
  aSide: Float32Array;
  aVis: Float32Array;
  index: Uint16Array | Uint32Array;
}

function allocArrays(points: number, segments: number): Arrays {
  const v = Math.max(2, points) * 2;
  return {
    position: new Float32Array(v * 3),
    aPrev: new Float32Array(v * 3),
    aNext: new Float32Array(v * 3),
    aS: new Float32Array(v),
    aLine: new Float32Array(v * 4),
    aSide: new Float32Array(v * 2),
    aVis: new Float32Array(v).fill(1),
    index: v > 65535 ? new Uint32Array(Math.max(1, segments) * 6) : new Uint16Array(Math.max(1, segments) * 6),
  };
}

function makeGeometry(a: Arrays, dynamic: boolean): BufferGeometry {
  const g = new BufferGeometry();
  const usage = dynamic ? DynamicDrawUsage : StaticDrawUsage;
  const add = (name: string, arr: Float32Array, size: number) => g.setAttribute(name, new BufferAttribute(arr, size).setUsage(usage));
  add('position', a.position, 3);
  add('aPrev', a.aPrev, 3);
  add('aNext', a.aNext, 3);
  add('aS', a.aS, 1);
  add('aLine', a.aLine, 4);
  add('aSide', a.aSide, 2);
  add('aVis', a.aVis, 1);
  g.setIndex(new BufferAttribute(a.index, 1).setUsage(usage));
  return g;
}

function arraysOf(g: BufferGeometry): Arrays {
  const f = (n: string) => (g.getAttribute(n) as BufferAttribute).array as Float32Array;
  return {
    position: f('position'), aPrev: f('aPrev'), aNext: f('aNext'), aS: f('aS'), aLine: f('aLine'), aSide: f('aSide'), aVis: f('aVis'),
    index: g.getIndex()!.array as Uint16Array | Uint32Array,
  };
}

function markDirty(g: BufferGeometry): void {
  for (const name of ['position', 'aPrev', 'aNext', 'aS', 'aLine', 'aSide', 'aVis']) (g.getAttribute(name) as BufferAttribute).needsUpdate = true;
  g.getIndex()!.needsUpdate = true;
}

/** Writes one prepared line at pair index `p` and segment index `seg`; returns the next pair and segment index. */
function writeLine(a: Arrays, r: LineRec, p: number, seg: number, sp: StrokeParams): [number, number] {
  const { pts, n, arc, L } = r;
  const t0 = r.sched ? r.sched.t0 : r.t0;
  const dur = r.sched ? r.sched.dur : r.dur;
  const taper = r.taper && !r.closed;
  for (let i = 0; i < n; i++) {
    const ip = i > 0 ? i - 1 : r.closed && n > 2 ? n - 2 : i;
    const inx = i < n - 1 ? i + 1 : r.closed && n > 2 ? 1 : i;
    const f = r.width * widthProfile(arc[i]!, L, r.seed, taper, sp);
    for (let side = 0; side < 2; side++) {
      const v = (p + i) * 2 + side;
      const v3 = v * 3;
      a.position[v3] = pts[i * 3]!;
      a.position[v3 + 1] = pts[i * 3 + 1]!;
      a.position[v3 + 2] = pts[i * 3 + 2]!;
      a.aPrev[v3] = pts[ip * 3]!;
      a.aPrev[v3 + 1] = pts[ip * 3 + 1]!;
      a.aPrev[v3 + 2] = pts[ip * 3 + 2]!;
      a.aNext[v3] = pts[inx * 3]!;
      a.aNext[v3 + 1] = pts[inx * 3 + 1]!;
      a.aNext[v3 + 2] = pts[inx * 3 + 2]!;
      a.aS[v] = arc[i]!;
      const v4 = v * 4;
      a.aLine[v4] = L;
      a.aLine[v4 + 1] = t0;
      a.aLine[v4 + 2] = dur;
      a.aLine[v4 + 3] = r.width;
      a.aSide[v * 2] = side === 0 ? -1 : 1;
      a.aSide[v * 2 + 1] = f;
      a.aVis[v] = r.vis;
    }
  }
  for (let s = 0; s < n - 1; s++) {
    const b = (p + s) * 2;
    const k = (seg + s) * 6;
    a.index[k] = b;
    a.index[k + 1] = b + 2;
    a.index[k + 2] = b + 1;
    a.index[k + 3] = b + 1;
    a.index[k + 4] = b + 2;
    a.index[k + 5] = b + 3;
  }
  return [p + n, seg + Math.max(0, n - 1)];
}

function rewriteSchedule(a: Arrays, r: LineRec, p: number): void {
  const t0 = r.sched ? r.sched.t0 : r.t0;
  const dur = r.sched ? r.sched.dur : r.dur;
  for (let i = 0; i < r.n * 2; i++) {
    const v4 = (p * 2 + i) * 4;
    a.aLine[v4 + 1] = t0;
    a.aLine[v4 + 2] = dur;
  }
}

export interface InkLineSetOptions {
  /** > 0 makes a dynamic set with room for this many points (grows when exceeded). */
  capacity?: number;
  /** Stroke parameters (pressure, taper, resampling); default the world's `ink.stroke`. */
  stroke?: () => StrokeParams;
  /** Default stroke duration without pen or explicit time. */
  defaultDur?: number;
  renderOrder?: number;
  flatRenderOrder?: number;
}

/** The engine's LineSet: see `LineSet` in contracts. */
export class InkLineSet implements LineSet {
  readonly mesh: Mesh;
  /** The flat twin (child of `mesh`), visible only during the peel. */
  readonly flat: Mesh;
  readonly dynamic: boolean;
  /** Dynamic sets: geometry holding the print-direction lines (the flat twin and the print use it). */
  flatGeometry: BufferGeometry | null = null;
  private recs: LineRec[] = [];
  private written: { rec: LineRec; p: number }[] = [];
  private capacity: number;
  private pool: FloatBuf[] = [];
  private flatPool: FloatBuf[] = [];
  private dynRecs: LineRec[] = [];
  private flatRecs: LineRec[] = [];
  private stroke: () => StrokeParams;
  private defaultDur: number;
  private built = false;

  constructor(material: InkMaterial | ShaderMaterial, opts: InkLineSetOptions = {}) {
    this.capacity = opts.capacity ?? 0;
    this.dynamic = this.capacity > 0;
    this.stroke = opts.stroke ?? (() => STROKE_DEFAULTS);
    this.defaultDur = opts.defaultDur ?? 0.5;
    const geometry = this.dynamic ? makeGeometry(allocArrays(this.capacity, this.capacity), true) : new BufferGeometry();
    if (this.dynamic) {
      geometry.setDrawRange(0, 0);
      this.flatGeometry = makeGeometry(allocArrays(this.capacity, this.capacity), true);
      this.flatGeometry.setDrawRange(0, 0);
    }
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opts.renderOrder ?? 10;
    this.mesh.raycast = () => {};
    this.flat = new Mesh(this.flatGeometry ?? geometry, createFlatMaterial(material));
    this.flat.frustumCulled = false;
    this.flat.renderOrder = opts.flatRenderOrder ?? 11;
    this.flat.visible = false;
    this.flat.raycast = () => {};
    this.flat.name = 'flat-copy';
    this.mesh.add(this.flat);
  }

  get material(): ShaderMaterial {
    return this.mesh.material as ShaderMaterial;
  }

  /** Swaps the ink material (the flat twin gets a matching twin material). */
  setMaterial(material: ShaderMaterial): void {
    (this.flat.material as Material).dispose();
    this.mesh.material = material;
    this.flat.material = createFlatMaterial(material);
  }

  /** Number of lines added (static) or currently set (dynamic). */
  get count(): number {
    return this.dynamic ? this.dynRecs.length : this.recs.length;
  }

  private prepare(points: readonly XYZ[], opts: LineOptions, index: number, buf: FloatBuf, rec?: LineRec): LineRec {
    const sp = this.stroke();
    const closed = !!opts.closed && points.length > 2;
    resample(points, opts.maxSeg ?? sp.maxSeg, closed, opts.overshoot ?? 0, buf);
    const seed = opts.seed ?? index * 31 + 7;
    if (opts.wobble) wobble(buf, opts.wobble, seed, sp);
    const n = buf.points;
    const r: LineRec = rec ?? { pts: buf.a, n, arc: new Float32Array(0), L: 0, t0: 0, dur: 0, width: 1, seed, taper: true, closed, vis: 1 };
    r.pts = buf.a;
    r.n = n;
    if (r.arc.length < n) r.arc = new Float32Array(Math.ceil(n * 1.5));
    let L = 0;
    r.arc[0] = 0;
    const a = buf.a;
    for (let i = 1; i < n; i++) {
      L += Math.hypot(a[i * 3]! - a[i * 3 - 3]!, a[i * 3 + 1]! - a[i * 3 - 2]!, a[i * 3 + 2]! - a[i * 3 - 1]!);
      r.arc[i] = L;
    }
    r.L = L;
    r.sched = opts.sched;
    r.t0 = opts.t0 ?? 0;
    r.dur = opts.dur ?? this.defaultDur;
    r.width = opts.width ?? 1;
    r.seed = seed;
    r.taper = opts.taper ?? true;
    r.closed = closed;
    r.vis = opts.visibleInPrint === false ? -1 : 1;
    return r;
  }

  /** Adds a stroke to a static set (call `build()` once after the last `add`). */
  add(points: readonly XYZ[], opts: LineOptions = {}): void {
    if (this.dynamic) throw new Error('inkleaf: add() is for static line sets; use setLines() on a dynamic set');
    if (points.length < 2) return;
    const buf = new FloatBuf(points.length * 6 + 12);
    const r = this.prepare(points, opts, this.recs.length, buf);
    r.pts = buf.a.slice(0, buf.n);
    r.arc = r.arc.slice(0, r.n);
    this.recs.push(r);
    this.built = false;
  }

  /** Allocates and writes the static geometry (reads the pen schedules as they are now). */
  build(): void {
    if (this.dynamic) return;
    let points = 0, segments = 0;
    for (const r of this.recs) {
      points += r.n;
      segments += Math.max(0, r.n - 1);
    }
    const a = allocArrays(points, segments);
    let p = 0, seg = 0;
    const sp = this.stroke();
    this.written = [];
    for (const r of this.recs) {
      this.written.push({ rec: r, p });
      [p, seg] = writeLine(a, r, p, seg, sp);
    }
    const old = this.mesh.geometry;
    const g = makeGeometry(a, false);
    g.setDrawRange(0, segments * 6);
    g.boundingSphere = this.bounds(a.position, points * 2);
    this.mesh.geometry = g;
    this.flat.geometry = g;
    old.dispose();
    this.built = true;
  }

  get isBuilt(): boolean {
    return this.built || this.dynamic;
  }

  /** Rewrites start times and durations after the pen's `fit()` rescaled the shared schedules. */
  reschedule(): void {
    if (this.dynamic || !this.built) return;
    const a = arraysOf(this.mesh.geometry);
    for (const w of this.written) rewriteSchedule(a, w.rec, w.p);
    (this.mesh.geometry.getAttribute('aLine') as BufferAttribute).needsUpdate = true;
  }

  /**
   * Dynamic sets: replaces all lines. `flat` are the print-direction lines for the flat twin and the print (default
   * the same lines). `opts` is one option object for every line or one per line (index-matched).
   */
  setLines(lines: readonly (readonly XYZ[])[], flat?: readonly (readonly XYZ[])[], opts?: LineOptions | readonly LineOptions[]): void {
    if (!this.dynamic) throw new Error('inkleaf: setLines() needs a dynamic line set (capacity > 0)');
    this.writeDynamic(lines, opts, this.pool, this.dynRecs, false);
    this.writeDynamic(flat ?? lines, opts, this.flatPool, this.flatRecs, true);
  }

  private writeDynamic(lines: readonly (readonly XYZ[])[], opts: LineOptions | readonly LineOptions[] | undefined, pool: FloatBuf[], recs: LineRec[], isFlat: boolean): void {
    let points = 0, segments = 0, count = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      if (l.length < 2) continue;
      const o = (Array.isArray(opts) ? (opts as readonly LineOptions[])[i] : (opts as LineOptions | undefined)) ?? {};
      if (!pool[count]) pool[count] = new FloatBuf(256);
      const r = this.prepare(l, o, i, pool[count]!, recs[count]);
      recs[count] = r;
      points += r.n;
      segments += Math.max(0, r.n - 1);
      count++;
    }
    recs.length = count;
    let g = isFlat ? this.flatGeometry! : this.mesh.geometry;
    if (points > this.capacityOf(g)) {
      const cap = Math.ceil(points * 1.5);
      const ng = makeGeometry(allocArrays(cap, cap), true);
      g.dispose();
      g = ng;
      if (isFlat) {
        this.flatGeometry = ng;
        this.flat.geometry = ng;
      } else {
        this.mesh.geometry = ng;
      }
      this.capacity = Math.max(this.capacity, cap);
    }
    const a = arraysOf(g);
    const sp = this.stroke();
    let p = 0, seg = 0;
    for (const r of recs) [p, seg] = writeLine(a, r, p, seg, sp);
    g.setDrawRange(0, segments * 6);
    markDirty(g);
  }

  private capacityOf(g: BufferGeometry): number {
    return (g.getAttribute('aS') as BufferAttribute | undefined)?.count !== undefined ? (g.getAttribute('aS') as BufferAttribute).count / 2 : 0;
  }

  /** Latest stroke end (`t0 + dur`) over the set. */
  get end(): number {
    let e = 0;
    for (const r of this.dynamic ? this.dynRecs : this.recs) e = Math.max(e, (r.sched ? r.sched.t0 + r.sched.dur : r.t0 + r.dur));
    return e;
  }

  /** Print-pass hook: dynamic sets show their print-direction geometry. Returns a restore function. */
  usePrintGeometry(): () => void {
    if (!this.dynamic || !this.flatGeometry) return () => {};
    const g = this.mesh.geometry;
    this.mesh.geometry = this.flatGeometry;
    return () => {
      this.mesh.geometry = g;
    };
  }

  /** Sets per-vertex print visibility (static sets): one 0/1 per vertex, max-combined per side pair. */
  setVisibility(vis: ArrayLike<number>): void {
    if (this.dynamic) return;
    const attr = this.mesh.geometry.getAttribute('aVis') as BufferAttribute | undefined;
    if (!attr) return;
    const a = attr.array as Float32Array;
    for (let i = 0; i + 1 < a.length && i + 1 < vis.length; i += 2) {
      if (a[i]! < -0.5) continue;
      const v = Math.max(vis[i]!, vis[i + 1]!) > 0 ? 1 : 0;
      a[i] = v;
      a[i + 1] = v;
    }
    attr.needsUpdate = true;
  }

  private bounds(pos: Float32Array, count: number): Sphere {
    const s = new Sphere();
    if (count === 0) return s;
    const c = new Vector3();
    for (let i = 0; i < count; i++) c.x += pos[i * 3]!, c.y += pos[i * 3 + 1]!, c.z += pos[i * 3 + 2]!;
    c.divideScalar(count);
    let r = 0;
    for (let i = 0; i < count; i++) r = Math.max(r, Math.hypot(pos[i * 3]! - c.x, pos[i * 3 + 1]! - c.y, pos[i * 3 + 2]! - c.z));
    s.center.copy(c);
    s.radius = r;
    return s;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.flatGeometry?.dispose();
    (this.flat.material as Material).dispose();
    this.mesh.removeFromParent();
  }
}
