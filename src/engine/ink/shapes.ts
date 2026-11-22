/**
 * Solid shapes of the kit: paper surfaces with their pen strokes and live outlines. Boxes draw 12 overshooting
 * edges; round things (cylinders, spheres, lathes, thick tubes) get outlines recomputed every frame from the camera
 * and, for the print and the flat copy, from the print direction.
 */
import {
  BoxGeometry, BufferGeometry, CatmullRomCurve3, CylinderGeometry, Group, LatheGeometry, Matrix4, Mesh, SphereGeometry,
  TorusGeometry, TubeGeometry, Vector2, Vector3, type Object3D,
} from 'three';
import type { LineOptions, PenSchedule } from '../contracts';
import { pts, v3, type InkSpec, type Part, type PartOptions, type PaperSpec, type Scope, type StrokeStyle, type Vec3 } from './kit-core';
import type { InkLineSet } from './line-set';
import type { PaperMaterial } from './paper-material';
import type { PopFrame } from './pop';
import {
  blendLines, cylinderSilhouette, eyeInLocal, latheSilhouette, printDirInLocal, profileSlopes, slot, sphereSilhouette, type Lines,
} from './silhouette';
import { polylineLength } from './stroke';

const _m = new Matrix4();

/** Keeps camera and print outlines of one local frame and writes the blended standing lines to a dynamic set. */
export class LiveOutline {
  readonly cam: Lines = [];
  readonly print: Lines = [];
  readonly stand: Lines = [];
  readonly eye = new Vector3();
  readonly dir = new Vector3();
  constructor(readonly set: InkLineSet, readonly host: Object3D, readonly scope: Scope, readonly opts: (i: number) => LineOptions) {}

  /** Computes both viewers for the host and calls `fill(viewer, out)`; writes the set. */
  update(f: PopFrame, fill: (viewer: { eye?: Vector3; dir?: Vector3 }, out: Lines) => void): void {
    const pop = this.scope.pop;
    eyeInLocal(this.host, f.camera.position, this.eye);
    printDirInLocal(this.host, pop.frame, pop.u.uCab.value.x, pop.u.uCab.value.y, this.dir, _m);
    fill({ eye: this.eye }, this.cam);
    fill({ dir: this.dir }, this.print);
    blendLines(this.print, this.cam, f.lift, this.stand);
    const o: LineOptions[] = [];
    for (let i = 0; i < Math.max(this.stand.length, this.print.length); i++) o.push(this.opts(i));
    this.set.setLines(this.stand, this.print, o);
  }
}

interface SolidOptions extends PartOptions {
  paper?: PaperSpec;
  ink?: InkSpec;
  /** Pen weight of the part's strokes. */
  width?: number;
  style?: StrokeStyle;
  /** Cast shadows once shaded (default true). */
  castShadow?: boolean;
}

// ------------------------------------------------------------------ box, table, shelf

export interface BoxOptions extends SolidOptions {
  /** Corner with the smallest coordinates (mm, part space). */
  min: Vec3;
  /** Corner with the largest coordinates. */
  max: Vec3;
  /** Skip edges shorter than this (mm). */
  skipShort?: number;
}

/** Adds a box surface and its 12 edges (X edges, then Y, then Z), each a pen stroke that overshoots the corners. */
export function boxInto(s: Scope, part: Part, set: InkLineSet, paper: PaperMaterial | null, min: Vector3, max: Vector3, width: number, skipShort: number, style: StrokeStyle = {}, castShadow = true): void {
  const size = new Vector3().subVectors(max, min);
  if (paper && size.x > 0 && size.y > 0 && size.z > 0) {
    const g = new BoxGeometry(size.x, size.y, size.z);
    g.translate((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
    s.surface(part, new Mesh(g, paper), set.mesh.parent ?? part.group, castShadow);
  }
  const c = (bits: number) => new Vector3(bits & 1 ? max.x : min.x, bits & 2 ? max.y : min.y, bits & 4 ? max.z : min.z);
  const pairs: [number, number][] = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const bx = s.pop.env.box;
  for (const [a, b] of pairs) {
    const p = c(a), q = c(b);
    const len = p.distanceTo(q);
    if (len < 1e-6 || len < skipShort) continue;
    set.add([p, q], s.lineOpts([p, q], { ...style, width }, { overshoot: style.overshoot ?? Math.min(bx.overshootMax, bx.overshootFrac * len) }));
  }
}

/** A box: paper surface plus 12 overshooting pen edges. */
export function box(s: Scope, o: BoxOptions): Part {
  const part = s.part('box', o);
  const paper = s.root.paper(o.paper, s.scale);
  const set = s.staticSet(s.root.ink(o.ink), part.group);
  part.sets.push(set);
  const min = v3(o.min), max = v3(o.max);
  boxInto(s, part, set, paper, min, max, o.width ?? 1, o.skipShort ?? 0, o.style, o.castShadow ?? true);
  const sz = new Vector3().subVectors(max, min);
  s.register(part, 'box', o, `A box ${sz.x.toFixed(1)} x ${sz.y.toFixed(1)} x ${sz.z.toFixed(1)} mm drawn with overshooting pen edges.`);
  return part;
}

export interface TableOptions extends SolidOptions {
  x0: number; x1: number; z0: number; z1: number;
  /** Top height (default 14) and thickness (default 3.2). */
  y?: number;
  thick?: number;
}

/** A table: top box (width 1.05) and two leg slabs (width 0.9). */
export function table(s: Scope, o: TableOptions): Part {
  const part = s.part('table', o);
  const paper = s.root.paper(o.paper, s.scale);
  const set = s.staticSet(s.root.ink(o.ink), part.group);
  part.sets.push(set);
  const y = o.y ?? 14, th = o.thick ?? 3.2;
  const w = o.width ?? 1;
  boxInto(s, part, set, paper, new Vector3(o.x0, y, o.z0), new Vector3(o.x1, y + th, o.z1), 1.05 * w, 0, o.style);
  boxInto(s, part, set, paper, new Vector3(o.x0 + 3, 0, o.z0 + 2), new Vector3(o.x0 + 7, y, o.z1 - 2), 0.9 * w, 0, o.style);
  boxInto(s, part, set, paper, new Vector3(o.x1 - 7, 0, o.z0 + 2), new Vector3(o.x1 - 3, y, o.z1 - 2), 0.9 * w, 0, o.style);
  s.register(part, 'table', o, 'A small table: a top on two leg slabs.');
  return part;
}

export interface ShelfOptions extends SolidOptions {
  x0: number; x1: number; z0: number; z1: number;
  /** Height of the sides. */
  h: number;
  /** Heights of the shelf tops. */
  shelves: readonly number[];
  thick?: number;
  side?: number;
}

/** A shelf unit: two full-height sides (width 1.1) and shelves at the given heights (width 1.05). */
export function shelf(s: Scope, o: ShelfOptions): Part {
  const part = s.part('shelf', o);
  const paper = s.root.paper(o.paper, s.scale);
  const set = s.staticSet(s.root.ink(o.ink), part.group);
  part.sets.push(set);
  const th = o.thick ?? 3, sd = o.side ?? 3.2, w = o.width ?? 1;
  boxInto(s, part, set, paper, new Vector3(o.x0, 0, o.z0), new Vector3(o.x0 + sd, o.h, o.z1), 1.1 * w, 0, o.style);
  boxInto(s, part, set, paper, new Vector3(o.x1 - sd, 0, o.z0), new Vector3(o.x1, o.h, o.z1), 1.1 * w, 0, o.style);
  for (const m of o.shelves) boxInto(s, part, set, paper, new Vector3(o.x0 + sd, m - th, o.z0), new Vector3(o.x1 - sd, m, o.z1), 1.05 * w, 0, o.style);
  s.register(part, 'shelf', o, `A shelf unit ${o.x1 - o.x0} mm wide with ${o.shelves.length} shelves.`);
  return part;
}

// ------------------------------------------------------------------ round things

/** A closed circle of `n` points in the XZ plane at height y. */
export function ring(r: number, y: number, n: number): Vector3[] {
  const out: Vector3[] = [];
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    out.push(new Vector3(r * Math.cos(a), y, r * Math.sin(a)));
  }
  return out;
}

export interface CylinderOptions extends SolidOptions {
  r: number;
  /** Height (base at y 0 of the part). */
  h: number;
  /** Draw the top and bottom rims (default true). */
  rims?: boolean;
  /** Outline pen weight (default 1.05). */
  outlineWidth?: number;
  /** Open ends (no caps). */
  open?: boolean;
}

/** A cylinder standing on its base: surface, rim rings and two live tangent outlines. */
export function cylinder(s: Scope, o: CylinderOptions): Part {
  const part = s.part('cylinder', o);
  const paper = s.root.paper(o.paper, s.scale);
  const ink = s.root.ink(o.ink);
  const w = o.width ?? 1;
  if (paper) {
    const g = new CylinderGeometry(o.r, o.r, o.h, 48, 1, !!o.open);
    g.translate(0, o.h / 2, 0);
    s.surface(part, new Mesh(g, paper), part.group, o.castShadow ?? true);
  }
  const rimN = s.pop.env.sil.rimPoints;
  if (o.rims !== false) {
    const set = s.staticSet(ink, part.group);
    part.sets.push(set);
    for (const y of [0, o.h]) {
      const pl = ring(o.r, y, rimN);
      set.add(pl, s.lineOpts(pl, { ...o.style, width: w }, { closed: true, ...s.schedule(Math.PI * o.r, o.style?.time) }));
    }
  }
  const out = s.dynamicSet(s.root.ink(o.ink, { widthPx: s.pop.env.sil.widthPx }), part.group, 16);
  part.sets.push(out);
  const sched: PenSchedule[] = [0, 1].map(() => {
    const x = s.schedule(o.h, o.style?.time);
    return x.sched ?? { t0: x.t0 ?? 0, dur: x.dur ?? 0.3 };
  });
  const live = new LiveOutline(out, part.group, s, (i) => ({ width: o.outlineWidth ?? 1.05, seed: 300 + i, sched: sched[i % 2] }));
  s.every((f) => live.update(f, (viewer, lines) => cylinderSilhouette(o.r, 0, o.h, viewer, lines)));
  s.register(part, 'cylinder', o, `A cylinder r ${o.r} mm, ${o.h} mm tall, whose side outlines follow the camera.`);
  return part;
}

export interface SphereOptions extends SolidOptions {
  r: number;
  /** Outline points (default `ink.silhouette.spherePoints` = 72). */
  points?: number;
  outlineWidth?: number;
}

/** A sphere with a live outline (a circle that follows the camera). */
export function sphere(s: Scope, o: SphereOptions): Part {
  const part = s.part('sphere', o);
  const paper = s.root.paper(o.paper, s.scale);
  if (paper) s.surface(part, new Mesh(new SphereGeometry(o.r, 40, 28), paper), part.group, o.castShadow ?? true);
  const n = o.points ?? s.pop.env.sil.spherePoints;
  const out = s.dynamicSet(s.root.ink(o.ink, { widthPx: s.pop.env.sil.widthPx }), part.group, 160);
  part.sets.push(out);
  const x = s.schedule(2 * Math.PI * o.r, o.style?.time);
  const sched = x.sched ?? { t0: x.t0 ?? 0, dur: x.dur ?? 0.3 };
  const live = new LiveOutline(out, part.group, s, () => ({ width: o.outlineWidth ?? o.width ?? 1, closed: true, sched, seed: 91 }));
  s.every((f) => live.update(f, (viewer, lines) => sphereSilhouette(o.r, viewer, n, lines)));
  s.register(part, 'sphere', o, `A sphere r ${o.r} mm whose outline follows the camera.`);
  return part;
}

export interface LatheOptions extends SolidOptions {
  /** Profile points `[r, y]` from bottom to top (radius, height in mm). */
  profile: readonly (readonly [number, number])[];
  /** Profile indices to draw as rim rings (radius > 0.3). */
  rims?: readonly number[];
  /** Linear steps per profile segment for the surface and outline (default 3). */
  dense?: number;
  segments?: number;
  outlineWidth?: number;
  /** Extra detail strokes (part space) drawn with the rim ink. */
  details?: readonly (readonly Vec3[])[];
}

/** Densifies a profile by splitting each segment into `dense` steps. */
export function densify(profile: readonly (readonly [number, number])[], dense: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < profile.length; i++) {
    const p = profile[i]!;
    if (i > 0) {
      const q = profile[i - 1]!;
      for (let k = 1; k < dense; k++) {
        const t = k / dense;
        out.push([q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t]);
      }
    }
    out.push([p[0], p[1]]);
  }
  return out;
}

/** A turned object (surface of revolution about Y): surface, rim rings and a live outline. */
export function lathe(s: Scope, o: LatheOptions): Part & { profile: [number, number][] } {
  const part = s.part('lathe', o);
  const env = s.pop.env;
  const paper = s.root.paper(o.paper, s.scale);
  const prof = densify(o.profile, o.dense ?? env.sil.latheDense);
  if (paper) {
    const g = new LatheGeometry(prof.map(([r, y]) => new Vector2(Math.max(0, r), y)), o.segments ?? env.sil.latheSegments);
    s.surface(part, new Mesh(g, paper), part.group, o.castShadow ?? true);
  }
  const rimSet = s.staticSet(s.root.ink(o.ink, { widthPx: 1.4 }), part.group);
  part.sets.push(rimSet);
  for (const i of o.rims ?? []) {
    const p = o.profile[i];
    if (!p || p[0] <= 0.3) continue;
    const pl = ring(p[0], p[1], env.sil.rimPoints);
    rimSet.add(pl, s.lineOpts(pl, { ...o.style, width: o.width ?? 1 }, { closed: true, ...s.schedule(Math.PI * p[0], o.style?.time) }));
  }
  for (const d of o.details ?? []) {
    const pl = pts(d);
    rimSet.add(pl, s.lineOpts(pl, { ...o.style, width: o.width ?? 1 }));
  }
  let plen = 0;
  for (let i = 1; i < o.profile.length; i++) plen += Math.hypot(o.profile[i]![0] - o.profile[i - 1]![0], o.profile[i]![1] - o.profile[i - 1]![1]);
  const out = s.dynamicSet(s.root.ink(o.ink, { widthPx: env.sil.widthPx }), part.group, 400);
  part.sets.push(out);
  const x = s.schedule(env.sil.outlineLen * plen, o.style?.time);
  const sched = x.sched ?? { t0: x.t0 ?? 0, dur: x.dur ?? 0.3 };
  const slopes = profileSlopes(prof);
  const live = new LiveOutline(out, part.group, s, (i) => ({ width: o.outlineWidth ?? 1.15, seed: 500 + i, sched }));
  s.every((f) => live.update(f, (viewer, lines) => latheSilhouette(prof, slopes, viewer, lines)));
  s.register(part, 'lathe', o, `A turned object (profile of ${o.profile.length} points, ${prof[prof.length - 1]?.[1].toFixed(1)} mm tall) with a live outline.`);
  return Object.assign(part, { profile: prof });
}

// ------------------------------------------------------------------ tubes, springs, wheels

export interface TubeOptions extends SolidOptions {
  /** Path points (a Catmull-Rom curve runs through them). */
  points: readonly Vec3[];
  radius: number;
  /** Radial segments (default 7). */
  radial?: number;
  closed?: boolean;
}

const _t = new Vector3();
const _vv = new Vector3();
const _sd = new Vector3();

/** Offsets of a path by ±radius perpendicular to the view: the outline of a thick tube. */
function tubeSides(path: readonly Vector3[], tangents: readonly Vector3[], radius: number, viewer: { eye?: Vector3; dir?: Vector3 }, lines: Lines): number {
  const a = slot(lines, 0, path.length), b = slot(lines, 1, path.length);
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    if (viewer.eye) _vv.subVectors(viewer.eye, p);
    else _vv.copy(viewer.dir!).negate();
    _t.copy(tangents[i]!);
    _sd.crossVectors(_t, _vv);
    const l = _sd.length();
    if (l < 1e-9) _sd.set(0, radius, 0);
    else _sd.multiplyScalar(radius / l);
    a[i]!.copy(p).add(_sd);
    b[i]!.copy(p).sub(_sd);
  }
  lines.length = 2;
  return 2;
}

/**
 * A tube along a path. Thin tubes (radius <= 1.5 mm) get one pen stroke along the centre (the pen line covers
 * them); thick tubes get two live outline strokes that follow the camera.
 */
export function tube(s: Scope, o: TubeOptions): Part {
  const part = s.part('tube', o);
  const paper = s.root.paper(o.paper, s.scale);
  const path = pts(o.points);
  const curve = new CatmullRomCurve3(path, !!o.closed, 'centripetal');
  const len = curve.getLength();
  if (paper) {
    const g = new TubeGeometry(curve, Math.max(8, Math.round(len / 1.2), path.length * 2), o.radius, o.radial ?? 7, !!o.closed);
    s.surface(part, new Mesh(g, paper), part.group, o.castShadow ?? true);
  }
  const n = Math.max(2, Math.round(len / 1.2));
  const centre = curve.getSpacedPoints(n);
  if (o.radius <= 1.5) {
    const set = s.staticSet(s.root.ink(o.ink), part.group);
    part.sets.push(set);
    set.add(centre, s.lineOpts(centre, { ...o.style, width: o.width ?? 1.25 }, { closed: !!o.closed }));
  } else {
    const tangents = centre.map((_, i) => curve.getTangentAt(Math.min(1, i / n)));
    const out = s.dynamicSet(s.root.ink(o.ink, { widthPx: s.pop.env.sil.widthPx }), part.group, centre.length * 2 + 8);
    part.sets.push(out);
    const sched = [0, 1].map(() => {
      const x = s.schedule(len, o.style?.time);
      return x.sched ?? { t0: x.t0 ?? 0, dur: x.dur ?? 0.3 };
    });
    const live = new LiveOutline(out, part.group, s, (i) => ({ width: o.width ?? 1, seed: 700 + i, sched: sched[i % 2] }));
    s.every((f) => live.update(f, (viewer, lines) => tubeSides(centre, tangents, o.radius, viewer, lines)));
  }
  s.register(part, 'tube', o, `A tube of radius ${o.radius} mm along a ${len.toFixed(0)} mm path.`);
  return part;
}

export interface SpringOptions extends SolidOptions {
  /** Coil axis start and end (part space). */
  from: Vec3;
  to: Vec3;
  turns?: number;
  /** Coil radius (default 2.6). */
  radius?: number;
  /** Wire radius (default 0.45). */
  wire?: number;
  /** Points per turn (default 24). */
  perTurn?: number;
  /** Optional straight lead-outs from the coil ends to these points. */
  leads?: readonly [Vec3, Vec3];
}

/** A coil spring: wire tube plus one pen stroke along it (scheduled at a quarter of its length). */
export function spring(s: Scope, o: SpringOptions): Part {
  const part = s.part('spring', o);
  const paper = s.root.paper(o.paper, s.scale);
  const a = v3(o.from), b = v3(o.to);
  const axis = new Vector3().subVectors(b, a);
  const L = axis.length();
  axis.normalize();
  const ref = Math.abs(axis.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const u = new Vector3().crossVectors(axis, ref).normalize();
  const w = new Vector3().crossVectors(axis, u).normalize();
  const turns = o.turns ?? 9, R = o.radius ?? 2.6, per = o.perTurn ?? 24;
  const N = Math.max(2, Math.round(turns * per));
  const coil: Vector3[] = [];
  if (o.leads) coil.push(v3(o.leads[0]));
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const ang = 2 * Math.PI * turns * t;
    coil.push(a.clone().addScaledVector(axis, L * t).addScaledVector(u, Math.cos(ang) * R).addScaledVector(w, Math.sin(ang) * R));
  }
  if (o.leads) coil.push(v3(o.leads[1]));
  if (paper) {
    const curve = new CatmullRomCurve3(coil, false, 'centripetal');
    const g = new TubeGeometry(curve, Math.max(coil.length * 2, 16), o.wire ?? 0.45, 6, false);
    s.surface(part, new Mesh(g, paper), part.group, o.castShadow ?? true);
  }
  const set = s.staticSet(s.root.ink(o.ink), part.group);
  part.sets.push(set);
  const len = polylineLength(coil);
  set.add(coil, s.lineOpts(coil, { ...o.style, width: o.width ?? 1.2, maxSeg: o.style?.maxSeg ?? 0.8, time: o.style?.time ?? { length: 0.25 * len } }));
  s.register(part, 'spring', o, `A coil spring of ${turns} turns, ${L.toFixed(1)} mm long.`);
  return part;
}

export interface WheelOptions extends SolidOptions {
  /** Rim centre radius. */
  r: number;
  /** Tyre (tube) radius (default 0.95). */
  tyre?: number;
  spokes?: number;
  /** Spin while live in rad/s (negative = clockwise seen from +Z). */
  spin?: number;
}

/** A spoked wheel in the part's XY plane (axle along Z): tyre surface, rim circles, hub and spokes; spins when live. */
export function wheel(s: Scope, o: WheelOptions): Part & { spinner: Group } {
  const part = s.part('wheel', o);
  const paper = s.root.paper(o.paper, s.scale);
  const spinner = new Group();
  spinner.name = `${part.id}.spinner`;
  part.group.add(spinner);
  const t = o.tyre ?? 0.95;
  if (paper) s.surface(part, new Mesh(new TorusGeometry(o.r, t, 8, 48), paper), spinner, o.castShadow ?? true);
  const set = s.staticSet(s.root.ink(o.ink), spinner);
  part.sets.push(set);
  const circle = (r: number, n: number) => Array.from({ length: n }, (_, k) => new Vector3(r * Math.cos((2 * Math.PI * k) / n), r * Math.sin((2 * Math.PI * k) / n), 0));
  const w = o.width ?? 1;
  const outer = circle(o.r + t, 48), inner = circle(o.r - t, 48);
  set.add(outer, s.lineOpts(outer, { ...o.style, width: 1.2 * w }, { closed: true, ...s.schedule(2 * Math.PI * (o.r + t), o.style?.time) }));
  set.add(inner, s.lineOpts(inner, { ...o.style, width: 0.75 * w }, { closed: true, ...s.schedule(2 * Math.PI * (o.r - t), o.style?.time) }));
  const spokeSet = s.staticSet(s.root.ink(o.ink, { widthPx: 1.1 }), spinner);
  part.sets.push(spokeSet);
  const n = o.spokes ?? 10;
  for (let i = 0; i < n; i++) {
    const th = (2 * Math.PI * i) / n;
    const p = [new Vector3(1.4 * Math.cos(th), 1.4 * Math.sin(th), 0), new Vector3((o.r - t) * Math.cos(th + 0.35), (o.r - t) * Math.sin(th + 0.35), 0)];
    spokeSet.add(p, s.lineOpts(p, { ...o.style, width: 0.45 * w, taper: false }));
  }
  const hub = circle(1.4, 16);
  spokeSet.add(hub, s.lineOpts(hub, { ...o.style, width: 0.8 * w }, { closed: true }));
  const spinParam = { spin: o.spin ?? 0 };
  s.every((f) => {
    if (f.live && !f.frozen && spinParam.spin) spinner.rotation.z += spinParam.spin * f.dt;
  });
  s.register(part, 'wheel', o, `A spoked wheel r ${o.r} mm that spins at ${spinParam.spin} rad/s when live.`, [
    { key: 'spin', label: 'Spin', type: 'number', unit: 'rad/s', min: -60, max: 60, get: () => spinParam.spin, set: (v) => void (spinParam.spin = v as number) },
  ]);
  return Object.assign(part, { spinner });
}

export interface SurfaceOptions extends PartOptions {
  geometry: BufferGeometry;
  paper?: PaperSpec;
  castShadow?: boolean;
}

/** A paper surface from any geometry (outline it yourself with strokes). */
export function surface(s: Scope, o: SurfaceOptions): Part {
  const part = s.part('surface', o);
  const paper = s.root.paper(o.paper, s.scale);
  if (paper) s.surface(part, new Mesh(o.geometry, paper), part.group, o.castShadow ?? true);
  s.register(part, 'surface', o, 'A paper surface.');
  return part;
}
