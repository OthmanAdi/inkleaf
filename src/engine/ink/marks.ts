/**
 * Pen marks of the kit: free polylines, circles, arcs, arrows, single-stroke text and hatched regions. All are
 * static strokes scheduled by the pen in call order.
 */
import { Vector3 } from 'three';
import type { PenSchedule } from '../contracts';
import { glyph, textWidth } from './font';
import { pts, v3, type InkSpec, type Part, type PartOptions, type Scope, type StrokeStyle, type Vec3 } from './kit-core';

interface MarkOptions extends PartOptions {
  ink?: InkSpec;
  /** Pen weight multiplier. */
  width?: number;
  style?: StrokeStyle;
}

interface AddExtra { closed?: boolean; taper?: boolean; width?: number; maxSeg?: number; sched?: PenSchedule }

function markSet(s: Scope, kind: string, o: MarkOptions): { part: Part; add: (p: Vector3[], extra?: AddExtra) => void } {
  const part = s.part(kind, o);
  const set = s.staticSet(s.root.ink(o.ink), part.group);
  part.sets.push(set);
  const add = (p: Vector3[], extra: AddExtra = {}) => {
    if (p.length < 2) return;
    const style: StrokeStyle = { ...o.style, width: extra.width ?? o.width ?? o.style?.width ?? 1 };
    if (extra.taper !== undefined) style.taper = extra.taper;
    if (extra.maxSeg !== undefined) style.maxSeg = extra.maxSeg;
    set.add(p, s.lineOpts(p, style, extra.sched ? { closed: extra.closed, sched: extra.sched } : { closed: extra.closed }));
  };
  return { part, add };
}

/** Rounds interior corners with quadratic Beziers between points `min(r, 0.45 x adjacent length)` from the corner. */
export function roundCorners(points: readonly Vector3[], r = 3, steps = 5): Vector3[] {
  if (points.length < 3) return points.map((p) => p.clone());
  const out: Vector3[] = [points[0]!.clone()];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!, b = points[i]!, c = points[i + 1]!;
    const la = a.distanceTo(b), lc = c.distanceTo(b);
    const d1 = Math.min(r, 0.45 * la), d2 = Math.min(r, 0.45 * lc);
    const p0 = b.clone().addScaledVector(new Vector3().subVectors(a, b).normalize(), d1);
    const p2 = b.clone().addScaledVector(new Vector3().subVectors(c, b).normalize(), d2);
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, u = 1 - t;
      out.push(new Vector3(
        u * u * p0.x + 2 * u * t * b.x + t * t * p2.x,
        u * u * p0.y + 2 * u * t * b.y + t * t * p2.y,
        u * u * p0.z + 2 * u * t * b.z + t * t * p2.z,
      ));
    }
  }
  out.push(points[points.length - 1]!.clone());
  return out;
}

export interface PolylineOptions extends MarkOptions {
  points: readonly Vec3[];
  closed?: boolean;
  /** Round the corners with this radius (mm). */
  round?: number;
}

/** One pen stroke through points. */
export function polyline(s: Scope, o: PolylineOptions): Part {
  const { part, add } = markSet(s, 'line', o);
  let p = pts(o.points);
  if (o.round) p = roundCorners(p, o.round);
  add(p, { closed: o.closed });
  s.register(part, 'line', o, `A pen stroke through ${o.points.length} points.`);
  return part;
}

export type Plane = 'xy' | 'xz' | 'yz' | Vec3;

/** Two unit vectors spanning a plane given by name or normal. */
export function planeBasis(plane: Plane = 'xy'): [Vector3, Vector3] {
  if (plane === 'xy') return [new Vector3(1, 0, 0), new Vector3(0, 1, 0)];
  if (plane === 'xz') return [new Vector3(1, 0, 0), new Vector3(0, 0, -1)];
  if (plane === 'yz') return [new Vector3(0, 0, -1), new Vector3(0, 1, 0)];
  const n = v3(plane).normalize();
  const ref = Math.abs(n.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const e1 = new Vector3().crossVectors(ref, n).normalize();
  const e2 = new Vector3().crossVectors(n, e1).normalize();
  return [e1, e2];
}

/** Points of an arc from angle `from` to `to` (radians) of radius r around a centre in a plane. */
export function arcPoints(center: Vector3, r: number, from: number, to: number, n: number, plane: Plane = 'xy', rx = r): Vector3[] {
  const [e1, e2] = planeBasis(plane);
  const out: Vector3[] = [];
  for (let k = 0; k <= n; k++) {
    const a = from + ((to - from) * k) / n;
    out.push(center.clone().addScaledVector(e1, rx * Math.cos(a)).addScaledVector(e2, r * Math.sin(a)));
  }
  return out;
}

export interface CircleOptions extends MarkOptions {
  center?: Vec3;
  r: number;
  /** Plane of the circle (default 'xy', facing the reader). */
  plane?: Plane;
  points?: number;
  /** Horizontal radius for an ellipse (default r). */
  rx?: number;
}

/** A closed circle (or ellipse) stroke. */
export function circle(s: Scope, o: CircleOptions): Part {
  const { part, add } = markSet(s, 'circle', o);
  const n = o.points ?? Math.max(24, Math.round(o.r * 4));
  const p = arcPoints(v3(o.center), o.r, 0, 2 * Math.PI, n, o.plane, o.rx ?? o.r);
  p.pop();
  add(p, { closed: true });
  s.register(part, 'circle', o, `A pen circle of radius ${o.r} mm.`);
  return part;
}

export interface ArcOptions extends CircleOptions {
  /** Start and end angles in radians. */
  from: number;
  to: number;
}

/** An open arc stroke. */
export function arc(s: Scope, o: ArcOptions): Part {
  const { part, add } = markSet(s, 'arc', o);
  const n = o.points ?? Math.max(8, Math.round(Math.abs(o.to - o.from) * o.r * 0.8));
  add(arcPoints(v3(o.center), o.r, o.from, o.to, n, o.plane, o.rx ?? o.r));
  s.register(part, 'arc', o, `A pen arc of radius ${o.r} mm.`);
  return part;
}

export interface ArrowOptions extends MarkOptions {
  from: Vec3;
  to: Vec3;
  /** Head length in mm (default 0.18 x length, 2..5). */
  head?: number;
  /** Heads at both ends. */
  double?: boolean;
  /** Normal of the plane the head lies in (default the shaft's best facing plane). */
  normal?: Vec3;
  /** Bend the shaft through this point (a smooth curve). */
  via?: Vec3;
}

/** An ink arrow: shaft plus a three-point head (half width 0.55 x head length). */
export function arrow(s: Scope, o: ArrowOptions): Part {
  const { part, add } = markSet(s, 'arrow', o);
  const a = v3(o.from), b = v3(o.to);
  let shaft: Vector3[] = [a, b];
  if (o.via) {
    const c = v3(o.via);
    shaft = [];
    for (let k = 0; k <= 16; k++) {
      const t = k / 16, u = 1 - t;
      shaft.push(new Vector3(u * u * a.x + 2 * u * t * c.x + t * t * b.x, u * u * a.y + 2 * u * t * c.y + t * t * b.y, u * u * a.z + 2 * u * t * c.z + t * t * b.z));
    }
  }
  const len = a.distanceTo(b);
  const h = o.head ?? Math.min(5, Math.max(2, 0.18 * len));
  add(shaft);
  const head = (tip: Vector3, prev: Vector3) => {
    const d = new Vector3().subVectors(tip, prev).normalize();
    const n = o.normal ? v3(o.normal).normalize() : Math.abs(d.z) > 0.9 ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
    const side = new Vector3().crossVectors(n, d).normalize().multiplyScalar(0.55 * h);
    const base = tip.clone().addScaledVector(d, -h);
    add([base.clone().add(side), tip.clone(), base.clone().sub(side)], { taper: true });
  };
  head(shaft[shaft.length - 1]!, shaft[shaft.length - 2]!);
  if (o.double) head(shaft[0]!, shaft[1]!);
  s.register(part, 'arrow', o, `An ink arrow ${len.toFixed(1)} mm long${o.double ? ' with two heads' : ''}.`);
  return part;
}

export interface LabelOptions extends MarkOptions {
  text: string;
  /** Text height (cap height) in mm (default 3). */
  size?: number;
  align?: 'left' | 'center' | 'right';
  /** Baseline direction and up direction (default x right, y up: text facing the reader). */
  right?: Vec3;
  up?: Vec3;
  /** Lean of the letters (x += slant · y). */
  slant?: number;
  /** Lift off the surface along right × up (mm, default 0.1). */
  lift?: number;
}

/** Single-stroke pen text; every glyph stroke is a pen stroke. */
export function label(s: Scope, o: LabelOptions): Part {
  const { part, add } = markSet(s, 'label', o);
  const size = o.size ?? 3;
  const right = v3(o.right ?? [1, 0, 0]).normalize();
  const up = v3(o.up ?? [0, 1, 0]).normalize();
  const normal = new Vector3().crossVectors(right, up).normalize();
  const w = textWidth(o.text) * size;
  let x = o.align === 'center' ? -w / 2 : o.align === 'right' ? -w : 0;
  const lift = o.lift ?? 0.1;
  const slant = o.slant ?? 0;
  for (const ch of o.text) {
    const g = glyph(ch);
    for (const st of g.strokes) {
      const p = st.map(([gx, gy]) => new Vector3()
        .addScaledVector(right, x + (gx + slant * gy) * size)
        .addScaledVector(up, gy * size)
        .addScaledVector(normal, lift));
      add(p, { width: o.width ?? 0.62, taper: p.length > 2, maxSeg: Math.max(0.3, 0.12 * size) });
    }
    x += g.advance * size;
  }
  s.register(part, 'label', o, `Pen text "${o.text}" (${size} mm).`, [
    { key: 'text', label: 'Text', type: 'string', help: 'Read only: rebuild the figure to change the text.', get: () => o.text, set: () => {} },
  ]);
  return part;
}

export interface HatchOptions extends MarkOptions {
  /** Planar polygon outline (part space); lines are clipped to it. */
  outline: readonly Vec3[];
  /** Line angle within the plane (radians, default π/4). */
  angle?: number;
  /** Line spacing in mm (default 1.5). */
  spacing?: number;
  /** Shrink the region by this much (mm) so lines stay inside the drawn border. */
  inset?: number;
  /** Also draw the outline. */
  border?: boolean;
}

/** Parallel pen hatching inside a flat polygon (shadows on the page, cut faces, shaded areas of a diagram). */
export function hatchRegion(s: Scope, o: HatchOptions): Part {
  const { part, add } = markSet(s, 'hatch', o);
  const P = pts(o.outline);
  const n = new Vector3();
  for (let i = 0; i < P.length; i++) {
    const a = P[i]!, b = P[(i + 1) % P.length]!;
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  }
  if (n.lengthSq() < 1e-12) n.set(0, 0, 1);
  const [e1, e2] = planeBasis(n);
  const o0 = P[0]!.clone();
  const ang = o.angle ?? Math.PI / 4;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const to2 = (p: Vector3) => {
    const d = p.clone().sub(o0);
    const x = d.dot(e1), y = d.dot(e2);
    return [x * ca + y * sa, -x * sa + y * ca] as const;
  };
  const from2 = (u: number, v: number) => {
    const x = u * ca - v * sa, y = u * sa + v * ca;
    return o0.clone().addScaledVector(e1, x).addScaledVector(e2, y);
  };
  const poly = P.map(to2);
  const vs = poly.map((p) => p[1]);
  const spacing = o.spacing ?? 1.5;
  const inset = o.inset ?? 0.6;
  const minV = Math.min(...vs) + inset, maxV = Math.max(...vs) - inset;
  let lineCount = 0, total = 0;
  const segs: [number, number, number][] = [];
  for (let v = minV + spacing / 2; v <= maxV; v += spacing) {
    const xs: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
      if ((a[1] <= v && b[1] > v) || (b[1] <= v && a[1] > v)) xs.push(a[0] + ((v - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const u0 = xs[i]! + inset, u1 = xs[i + 1]! - inset;
      if (u1 - u0 > 0.3) {
        segs.push([u0, u1, v]);
        total += u1 - u0;
        lineCount++;
      }
    }
  }
  const t = s.schedule(total / 4, o.style?.time);
  const sched: PenSchedule = t.sched ?? { t0: t.t0 ?? 0, dur: t.dur ?? 0.3 };
  for (const [u0, u1, v] of segs) add([from2(u0, v), from2(u1, v)], { width: o.width ?? 0.5, taper: false, sched });
  if (o.border) add(P, { closed: true, width: o.width ?? 0.8 });
  s.register(part, 'hatch', o, `Pen hatching of ${lineCount} lines inside a region.`);
  return part;
}
