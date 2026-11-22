/**
 * The ink authoring kit: draw a lesson figure in a few lines. Every call adds a part (paper surfaces plus pen
 * strokes), registers it under the lesson prefix with an id, label and tags, and schedules its strokes with the
 * pen in call order (the order you write is the order the pen draws). The pen body is fitted to `fit` seconds and
 * every set is built automatically before the first draw or print (or call `finish()` yourself).
 *
 *   const k = kit(pop, { prefix: 'lesson-3', pen: 'lesson-3' });
 *   k.papers({ wood: { hatchA: [1, 0.15, 0.2], spacing: 1.5, seed: 41 } });
 *   k.box({ id: 'base', min: [-25, 0, -6], max: [25, 2.5, 6], paper: 'wood' });
 *   k.spring({ id: 'coil', from: [-14, 11, 0], to: [14, 11, 0] });
 *   k.label({ id: 'title', text: 'SPRING', at: [0, 20, 0], size: 4, align: 'center' });
 *
 * Coordinates are model-frame millimetres: X across the page, Y up out of the page, Z toward the reader (content
 * stands at negative Z, toward the page head). Inside `group()` they are the group's local space.
 */
import { Group, type BufferGeometry, type Object3D } from 'three';
import type { LineOptions } from '../contracts';
import { card, tag, type CardOptions, type CardPart, type TagOptions, type TagPart } from './cards';
import { cutaway, type Cutaway, type CutawayOptions } from './cutaway';
import { jarOutline, type JarOptions, type JarPart } from './jar';
import { KitRoot, Scope, pts, v3, type InkSpec, type Part, type PartOptions, type StrokeStyle, type Vec3 } from './kit-core';
import type { InkMaterialOptions } from './line-material';
import type { InkLineSet } from './line-set';
import { arc, arrow, circle, hatchRegion, label, polyline, type ArcOptions, type ArrowOptions, type CircleOptions, type HatchOptions, type LabelOptions, type PolylineOptions } from './marks';
import type { PaperOptions } from './paper-material';
import type { Pen, PenOptions } from './pen';
import type { PopFrame, PopModel } from './pop';
import { hoverRing, type RingOptions, type RingPart } from './rings';
import {
  box, cylinder, lathe, shelf, sphere, spring, surface, table, tube, wheel, type BoxOptions, type CylinderOptions, type LatheOptions,
  type ShelfOptions, type SphereOptions, type SpringOptions, type SurfaceOptions, type TableOptions, type TubeOptions, type WheelOptions,
} from './shapes';
import type { XYZ } from './stroke';

export interface KitOptions {
  /** Registry prefix of every part, e.g. `lesson-1` (default the pop's id). */
  prefix?: string;
  /** Pen: a preset name (`'lesson-1'`, `'ramp'`...) or options. Default the world's `ink.pen`. */
  pen?: string | (PenOptions & { preset?: string });
  /** Fit the pen body to this many seconds (default the preset's fit; none for plain options). */
  fit?: number | null;
  /** Parent of the parts (default the pop group). */
  parent?: Object3D;
}

export interface GroupOptions extends PartOptions {
  /** Uniform scale. Hatch spacing of papers made inside is divided by it, so hatch density stays the same in mm. */
  scale?: number;
}

export interface LaterOptions {
  /** Start time of this scope's own pen, in seconds from the peel start (not fitted). */
  at: number;
  pen?: PenOptions;
}

export interface DynamicOptions extends PartOptions {
  ink?: InkSpec;
  /** Initial point capacity (grows when needed). */
  capacity?: number;
  /**
   * Called every frame while visible: return the standing strokes (camera dependent) and optionally the flat ones
   * used for the print and the flat copy. `f.lift` is the current lift.
   */
  build: (f: PopFrame, part: Part) => { standing: readonly (readonly XYZ[])[]; flat?: readonly (readonly XYZ[])[]; opts?: LineOptions | readonly LineOptions[] };
  /** Pen length of the strokes (for scheduling). */
  length?: number;
  style?: StrokeStyle;
}

export interface StrokesOptions extends PartOptions {
  ink?: InkSpec;
  /** Each stroke: points plus optional style (width, closed, taper...). */
  strokes: readonly (readonly Vec3[] | { points: readonly Vec3[]; closed?: boolean; style?: StrokeStyle })[];
  style?: StrokeStyle;
}

export class Kit {
  /** @internal */
  readonly scope: Scope;

  /** @internal */
  constructor(scope: Scope) {
    this.scope = scope;
  }

  /** The pop model this kit draws into. */
  get pop(): PopModel {
    return this.scope.pop;
  }

  /** The pen of this scope (call order = drawing order). */
  get pen(): Pen | null {
    return this.scope.pen;
  }

  /** The object parts of this scope are added to. */
  get node(): Object3D {
    return this.scope.parent;
  }

  /** Registry path of this scope (`lesson-1` or `lesson-1.lamp`). */
  get path(): string {
    return this.scope.path;
  }

  /**
   * Names paper styles to use by name in any part (`paper: 'wood'`). Registered as `<prefix>.paper.<name>`.
   * @example k.papers({ wood: { hatchA: [1, 0.1, 0.15], spacing: 1.5, seed: 31 }, plain: { hatch: 0 } });
   */
  papers(defs: Record<string, PaperOptions>): this {
    for (const [name, o] of Object.entries(defs)) this.scope.root.definePaper(name, o);
    return this;
  }

  /**
   * Names inks to use by name (`ink: 'thin'`). `widthPx` is the standing width before the 1.32 line scale.
   * @example k.inks({ thin: { widthPx: 1.1 }, bold: { widthPx: 1.6 } });
   */
  inks(defs: Record<string, InkMaterialOptions>): this {
    for (const [name, o] of Object.entries(defs)) this.scope.root.defineInk(name, o);
    return this;
  }

  /**
   * A transformed group; parts built inside use its local space and register under `<path>.<id>`.
   * @example k.group({ id: 'lamp', at: [120, 0, -40], rotation: [0, -0.4, 0] }, (g) => { g.cylinder({ id: 'base', r: 9, h: 2 }); });
   */
  group(o: GroupOptions, build: (k: Kit) => void): Part & { kit: Kit } {
    const s = this.scope;
    const part = s.part('group', o);
    const sc = o.scale ?? 1;
    part.group.scale.setScalar(sc);
    s.register(part, 'group', o, `A group of parts${sc !== 1 ? ` scaled x${sc}` : ''}.`, [
      { key: 'scale', label: 'Scale', type: 'number', min: 0.01, max: 100, get: () => part.group.scale.x, set: (v) => void part.group.scale.setScalar(v as number) },
    ]);
    const child = new Kit(new Scope(s.root, part.group, part.id, s.scale * sc, s.pen));
    build(child);
    return Object.assign(part, { kit: child });
  }

  /**
   * Parts drawn by their own pen starting at an explicit time (labels, cards and jars that should come after
   * the fitted pen body).
   * @example k.later({ at: 1.2 }, (l) => l.label({ text: 'Fig. 1', at: [0, -8, 0] }));
   */
  later(o: LaterOptions, build: (k: Kit) => void): this {
    const s = this.scope;
    const pen = s.pop.pen(o.pen ?? {});
    pen.t = o.at;
    s.root.extraPens.push(pen);
    build(new Kit(new Scope(s.root, s.parent, s.path, s.scale, pen)));
    return this;
  }

  /**
   * Holds the pen still before the next stroke.
   * @example k.pause(0.1);
   */
  pause(seconds: number): this {
    this.scope.pen?.pause(seconds);
    return this;
  }

  /**
   * A box with paper surface and 12 overshooting edges.
   * @example k.box({ id: 'book', min: [-8, 0, -6], max: [8, 4.2, 6], paper: 'cloth', width: 1.15 });
   */
  box(o: BoxOptions): Part {
    return box(this.scope, o);
  }

  /**
   * A table: top slab on two leg slabs.
   * @example k.table({ id: 'bench', x0: 0, x1: 60, z0: -30, z1: -10, y: 14 });
   */
  table(o: TableOptions): Part {
    return table(this.scope, o);
  }

  /**
   * A shelf unit: two sides and shelves at the given heights.
   * @example k.shelf({ id: 'shelf', x0: 12, x1: 160, z0: -132, z1: -96, h: 84, shelves: [3, 44] });
   */
  shelf(o: ShelfOptions): Part {
    return shelf(this.scope, o);
  }

  /**
   * An upright cylinder (base at y 0) with rims and live side outlines.
   * @example k.cylinder({ id: 'can', at: [40, 0, -20], r: 6, h: 18, paper: 'tin' });
   */
  cylinder(o: CylinderOptions): Part {
    return cylinder(this.scope, o);
  }

  /**
   * A sphere with an outline that follows the camera.
   * @example k.sphere({ id: 'ball', at: [60, 9, -30], r: 9 });
   */
  sphere(o: SphereOptions): Part {
    return sphere(this.scope, o);
  }

  /**
   * A turned object from a profile of [radius, height] points, with rim rings and a live outline.
   * @example k.lathe({ id: 'mug', profile: [[0, 0], [6.4, 0], [6.9, 0.8], [7.1, 13], [7.3, 14], [6.5, 14]], rims: [1, 4, 5] });
   */
  lathe(o: LatheOptions): Part {
    return lathe(this.scope, o);
  }

  /**
   * A tube along a path (thin: one centre stroke; thick: live outlines).
   * @example k.tube({ id: 'arm', points: [[0, 0, 0], [10, 30, 0], [30, 40, 0]], radius: 0.9 });
   */
  tube(o: TubeOptions): Part {
    return tube(this.scope, o);
  }

  /**
   * A coil spring between two points.
   * @example k.spring({ id: 'coil', from: [-14, 11, 0], to: [14, 11, 0], turns: 9, radius: 2.6 });
   */
  spring(o: SpringOptions): Part {
    return spring(this.scope, o);
  }

  /**
   * A spoked wheel in the XY plane that spins when live.
   * @example k.wheel({ id: 'front', at: [15.5, 11.3, 0], r: 10.5, spin: -5.5 });
   */
  wheel(o: WheelOptions): Part & { spinner: Group } {
    return wheel(this.scope, o);
  }

  /**
   * A paper surface from your own geometry.
   * @example k.surface({ id: 'drink', geometry: new CircleGeometry(6.4, 32).rotateX(-Math.PI / 2), paper: { color: '#d9cdb7' } });
   */
  surface(o: SurfaceOptions & { geometry: BufferGeometry }): Part {
    return surface(this.scope, o);
  }

  /**
   * One pen stroke through points (optionally closed or with rounded corners).
   * @example k.polyline({ id: 'brace', points: [[2, 28, -7], [10, 40, -7]], width: 0.8 });
   */
  polyline(o: PolylineOptions): Part {
    return polyline(this.scope, o);
  }

  /**
   * Several strokes in one part (one draw call).
   * @example k.strokes({ id: 'speed-lines', strokes: [[[-26, 8, 0], [-34, 8, 0]], [[-26, 15, 0], [-38, 15, 0]]], style: { width: 0.6 } });
   */
  strokes(o: StrokesOptions): Part {
    const s = this.scope;
    const part = s.part('strokes', o);
    const set = s.staticSet(s.root.ink(o.ink), part.group);
    part.sets.push(set);
    for (const st of o.strokes) {
      const isObj = !Array.isArray(st);
      const p = pts(isObj ? (st as { points: readonly Vec3[] }).points : (st as readonly Vec3[]));
      const style = { ...o.style, ...(isObj ? (st as { style?: StrokeStyle }).style : {}) };
      set.add(p, s.lineOpts(p, style, { closed: isObj ? (st as { closed?: boolean }).closed : undefined }));
    }
    s.register(part, 'strokes', o, `${o.strokes.length} pen strokes.`);
    return part;
  }

  /**
   * A circle (or ellipse with `rx`) in a plane ('xy' faces the reader, 'xz' lies on the page).
   * @example k.circle({ id: 'hub', center: [0, 11, 0], r: 3.2, plane: 'xy' });
   */
  circle(o: CircleOptions): Part {
    return circle(this.scope, o);
  }

  /**
   * An open arc from angle `from` to `to` (radians).
   * @example k.arc({ id: 'field', center: [0, 5.5, 0], r: 10, rx: 5.5, from: 0, to: Math.PI });
   */
  arc(o: ArcOptions): Part {
    return arc(this.scope, o);
  }

  /**
   * An ink arrow (optionally double-headed or bent through `via`).
   * @example k.arrow({ id: 'push', from: [-30, 22, 0], to: [-22, 22, 0], double: true });
   */
  arrow(o: ArrowOptions): Part {
    return arrow(this.scope, o);
  }

  /**
   * Single-stroke pen text.
   * @example k.label({ id: 'mass', text: '2 kg', at: [10, 30, 0], size: 3, align: 'center' });
   */
  label(o: LabelOptions): Part {
    return label(this.scope, o);
  }

  /**
   * A paper card with canvas text (title, handwritten value, sub line) and a double pen border.
   * @example k.card({ id: 'note', at: [30, 60, -20], w: 30, h: 16, title: 'Kinetic', value: '12 J' });
   */
  card(o: CardOptions): CardPart {
    return card(this.scope, o);
  }

  /**
   * A hanging tag with handwritten text, optionally on a string from `hangFrom`.
   * @example k.tag({ id: 'price', text: '40 W', at: [20, 30, 0], hangFrom: [12, 38, 0] });
   */
  tag(o: TagOptions): TagPart {
    return tag(this.scope, o);
  }

  /**
   * Parallel pen hatching clipped to a flat polygon (shadows on the page, cut faces).
   * @example k.hatch({ id: 'shadow', outline: [[0, 0.2, 0], [30, 0.2, 0], [36, 0.2, -10], [6, 0.2, -10]], angle: 0.8, spacing: 1.4 });
   */
  hatch(o: HatchOptions): Part {
    return hatchRegion(this.scope, o);
  }

  /**
   * A cut-away: opens the target's front half toward the camera to show `inner`.
   * @example const cut = k.cutaway({ id: 'mug-cut', target: mug, inner: coffee, radius: 8, lockAxis: [0, 1, 0] }); cut.open(true);
   */
  cutaway(o: CutawayOptions): Cutaway {
    return cutaway(this.scope, o);
  }

  /**
   * A dashed rotating ring facing the camera: `hover(true)`, `press()` or `show(true)`.
   * @example const ring = k.ring({ id: 'mug-ring', at: [80, 8, -18], size: [16, 15] }); ring.hover(true);
   */
  ring(o: RingOptions): RingPart {
    return hoverRing(this.scope, o);
  }

  /**
   * A glass store jar in ink with a card or tag label (the energy package adds liquid and glow).
   * @example k.jar({ id: 'kinetic', at: [69, 44, -116], r: 9.4, h: 31, label: 'card', name: 'Kinetic', value: '0 J', t0: 0.665, pace: 0.7 });
   */
  jar(o: JarOptions): JarPart {
    return jarOutline(this.scope, o);
  }

  /**
   * Strokes rebuilt every frame by your function (steam, ropes, custom outlines).
   * @example k.dynamic({ id: 'steam', length: 30, build: (f) => ({ standing: wisps(f.dt) }) });
   */
  dynamic(o: DynamicOptions): Part & { set: InkLineSet } {
    const s = this.scope;
    const part = s.part('dynamic', o);
    const set = s.dynamicSet(s.root.ink(o.ink), part.group, o.capacity ?? 200);
    part.sets.push(set);
    const t = s.schedule(o.length ?? 30, o.style?.time);
    const sched = t.sched ?? { t0: t.t0 ?? 0, dur: t.dur ?? 0.3 };
    s.every((f) => {
      const r = o.build(f, part);
      const base: LineOptions = { width: o.style?.width ?? 1, taper: o.style?.taper, seed: o.style?.seed, maxSeg: o.style?.maxSeg, sched };
      const opts = r.opts ?? base;
      set.setLines(r.standing, r.flat, Array.isArray(opts) ? opts : { ...base, ...(opts as LineOptions) });
    });
    s.register(part, 'dynamic', o, 'Strokes rebuilt every frame.');
    return Object.assign(part, { set });
  }

  /**
   * Runs a function every frame while the figure is visible (spin a part, animate a value).
   * @example k.every((f) => { if (f.live && !f.frozen) fan.group.rotation.z += 3 * f.dt; });
   */
  every(fn: (f: PopFrame) => void): () => void {
    return this.scope.every(fn);
  }

  /**
   * Fits the pen and builds every set now. Runs automatically before the first draw or print.
   * @example k.finish();
   */
  finish(): this {
    this.scope.root.finish();
    return this;
  }

  /** End of the pen body (after fit, once finished). */
  get penEnd(): number {
    return this.scope.root.pen.end;
  }
}

/**
 * Creates the authoring kit for a pop. See the module comment for the coordinate system and call order.
 * @example const k = kit(pop, { prefix: 'lesson-1', pen: 'lesson-1' });
 */
export function kit(pop: PopModel, o: KitOptions = {}): Kit {
  const penOpts = typeof o.pen === 'string' ? { preset: o.pen } : (o.pen ?? {});
  const pen = pop.pen(penOpts);
  const presetFit = penOpts.preset ? pop.env.presets[penOpts.preset]?.fit : undefined;
  const fit = o.fit !== undefined ? o.fit : presetFit && presetFit > 0 ? presetFit : null;
  const root = new KitRoot(pop, o.prefix ?? pop.id, pen, fit);
  pop.beforeUse.push(() => root.finish());
  return new Kit(new Scope(root, o.parent ?? pop.group, root.prefix, 1, pen));
}

export { v3 };
