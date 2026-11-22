/**
 * Internals shared by the authoring kit: material caches, pen scheduling in call order, part groups and registry
 * entries. Authors use `kit.ts`; helpers in shapes, marks, cards, rings, cutaway and jar build on this scope.
 */
import { Euler, Group, Vector3, type Color, type Mesh, type Object3D } from 'three';
import type { LineOptions, PenSchedule } from '../contracts';
import type { ParamSpec } from '../core/registry';
import type { InkMaterial, InkMaterialOptions } from './line-material';
import type { InkLineSet } from './line-set';
import type { PaperMaterial, PaperOptions } from './paper-material';
import { setHatchDir } from './paper-material';
import type { Pen } from './pen';
import type { PopFrame, PopModel } from './pop';
import { polylineLength, type XYZ } from './stroke';

/** A point: `[x, y, z]`, a Vector3 or `{ x, y, z }` (model-frame mm unless inside a group). */
export type Vec3 = readonly [number, number, number] | XYZ;

export const v3 = (p: Vec3 | undefined, out = new Vector3()): Vector3 =>
  p === undefined ? out.set(0, 0, 0) : Array.isArray(p) ? out.set(p[0], p[1], p[2]) : out.set((p as XYZ).x, (p as XYZ).y, (p as XYZ).z);

export const pts = (list: readonly Vec3[]): Vector3[] => list.map((p) => v3(p));

/** When a stroke is drawn: by the pen in call order (default), or at explicit times. */
export interface TimeSpec {
  /** Explicit start (s from the peel start). With `dur`, bypasses the pen (and the pen's fit). */
  t0?: number;
  dur?: number;
  /** Pen: wait this long after the pen's current time before starting. */
  delay?: number;
  /** Pen: schedule as if the stroke were this long (mm). */
  length?: number;
}

/** Pen styling shared by every stroke-drawing kit function. */
export interface StrokeStyle {
  /** Pen weight multiplier (1 = the ink's width). */
  width?: number;
  /** Tapered ends (default true; never for closed lines). */
  taper?: boolean;
  seed?: number;
  /** Resample step in mm. */
  maxSeg?: number;
  /** Extend both ends along their tangents (mm). */
  overshoot?: number;
  /** 3D noise displacement in mm. */
  wobble?: number;
  time?: TimeSpec;
  /** false = never shown in the print. */
  print?: boolean;
}

/** An ink: a named ink of the kit, options for a new one, or a material. */
export type InkSpec = string | InkMaterialOptions | InkMaterial;
/** A paper: a named paper of the kit, options, a material, or false for none. */
export type PaperSpec = string | PaperOptions | PaperMaterial | false;

/** Common options of every kit part. */
export interface PartOptions {
  /** Registry id under the kit prefix (dotted kebab-case segment, e.g. `mug`). Auto-generated when omitted. */
  id?: string;
  /** Human label for the inspector and agents. */
  label?: string;
  /** Extra tags (the kit adds `object`, `ink`, `figure`). */
  tags?: readonly string[];
  /** One sentence describing the part. */
  describe?: string;
  /** Position of the part (mm, in the parent group). */
  at?: Vec3;
  /** Rotation of the part (Euler XYZ, radians). */
  rotation?: Vec3;
}

export interface Part {
  /** Full registry id. */
  id: string;
  group: Group;
  sets: InkLineSet[];
  surfaces: Mesh[];
}

const human = (id: string) => id.replace(/[-_.]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
const SAFE = /[^a-z0-9-]+/g;

interface PaperEntry { opts: PaperOptions; mats: PaperMaterial[] }
interface InkEntry { mat: InkMaterial }

export class KitRoot {
  readonly pop: PopModel;
  readonly prefix: string;
  pen: Pen;
  fit: number | null;
  readonly pending: InkLineSet[] = [];
  readonly counters = new Map<string, number>();
  readonly namedPapers = new Map<string, PaperEntry>();
  readonly anonPapers = new Map<string, PaperEntry>();
  readonly namedInks = new Map<string, InkEntry>();
  readonly anonInks = new Map<string, InkEntry>();
  readonly extraPens: Pen[] = [];
  finished = false;
  private paperN = 0;
  private inkN = 0;

  constructor(pop: PopModel, prefix: string, pen: Pen, fit: number | null) {
    this.pop = pop;
    this.prefix = prefix;
    this.pen = pen;
    this.fit = fit;
  }

  nextId(kind: string): string {
    const n = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, n);
    return `${kind}-${n}`;
  }

  /** Fits the pen and builds every static set. Idempotent. */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    if (this.fit && this.fit > 0) this.pen.fit(this.fit);
    for (const s of this.pending) s.build();
    this.pending.length = 0;
  }

  definePaper(name: string, opts: PaperOptions): void {
    const key = name.replace(SAFE, '-');
    this.namedPapers.set(name, { opts: { ...opts }, mats: [] });
    this.registerPaper(`${this.prefix}.paper.${key}`, `Paper "${name}"`, () => this.namedPapers.get(name)!);
  }

  defineInk(name: string, opts: InkMaterialOptions): void {
    const key = name.replace(SAFE, '-');
    const mat = this.pop.ink(opts);
    this.namedInks.set(name, { mat });
    this.registerInk(`${this.prefix}.ink.${key}`, `Ink "${name}"`, mat);
  }

  paper(spec: PaperSpec | undefined, scale: number, fallback: PaperOptions = {}): PaperMaterial | null {
    if (spec === false) return null;
    if (spec && typeof spec === 'object' && (spec as PaperMaterial).isMaterial) return spec as PaperMaterial;
    let entry: PaperEntry;
    if (typeof spec === 'string') {
      const e = this.namedPapers.get(spec);
      if (!e) throw new Error(`inkleaf kit: unknown paper "${spec}". Define it with kit.papers({ ${spec}: {...} })`);
      entry = e;
    } else {
      const opts = { ...fallback, ...((spec as PaperOptions | undefined) ?? {}) };
      const key = JSON.stringify(opts, (_k, v) => (v && typeof v === 'object' && (v as { isTexture?: boolean }).isTexture ? `tex:${(v as { uuid: string }).uuid}` : v));
      let e = this.anonPapers.get(key);
      if (!e) {
        e = { opts, mats: [] };
        this.anonPapers.set(key, e);
        const id = `${this.prefix}.paper.p${++this.paperN}`;
        const ref = e;
        this.registerPaper(id, `Paper ${this.paperN}`, () => ref);
      }
      entry = e;
    }
    const spacing = (entry.opts.spacing ?? this.pop.env.paper.spacing) / (scale || 1);
    let m = entry.mats.find((x) => Math.abs(x.userData.paper.uSpacing.value - spacing) < 1e-6 && x.userData.paperOpts.map === entry.opts.map);
    if (!m) {
      m = this.pop.paper({ ...entry.opts, spacing });
      m.userData.kitScale = scale;
      entry.mats.push(m);
    }
    return m;
  }

  ink(spec: InkSpec | undefined, fallback: InkMaterialOptions = {}): InkMaterial {
    if (spec && typeof spec === 'object' && (spec as InkMaterial).isMaterial) return spec as InkMaterial;
    if (typeof spec === 'string') {
      const e = this.namedInks.get(spec);
      if (!e) throw new Error(`inkleaf kit: unknown ink "${spec}". Define it with kit.inks({ ${spec}: {...} })`);
      return e.mat;
    }
    const opts = { ...fallback, ...((spec as InkMaterialOptions | undefined) ?? {}) };
    const key = JSON.stringify({ ...opts, clock: opts.clock ? 'own' : undefined });
    let e = opts.clock ? undefined : this.anonInks.get(key);
    if (!e) {
      e = { mat: this.pop.ink(opts) };
      if (!opts.clock) this.anonInks.set(key, e);
      this.registerInk(`${this.prefix}.ink.i${++this.inkN}`, `Ink ${this.inkN}`, e.mat);
    }
    return e.mat;
  }

  private registerPaper(id: string, label: string, entry: () => PaperEntry): void {
    const all = () => entry().mats;
    const num = (key: 'spacing' | 'shade' | 'hatch' | 'seed', uniform: 'uSpacing' | 'uShade' | 'uHatch' | 'uSeed', help: string, min: number, max: number, unit?: string): ParamSpec => ({
      key, label: human(key), type: 'number', min, max, unit, help,
      get: () => entry().opts[key] ?? (key === 'spacing' ? this.pop.env.paper.spacing : key === 'shade' ? this.pop.env.paper.shade : key === 'hatch' ? 1 : 1),
      set: (v) => {
        entry().opts[key] = v as number;
        for (const m of all()) m.userData.paper[uniform].value = key === 'spacing' ? (v as number) / ((m.userData.kitScale as number) || 1) : (v as number);
      },
    });
    this.pop.ctx.registry.add({
      id, label, tags: ['material', 'paper', 'ink'], kind: 'paper-material', source: 'src/engine/ink/paper-material.ts',
      describe: 'Paper-white surface material with engraved hatching; shared by every part that names it.',
      params: [
        {
          key: 'color', label: 'Colour', type: 'color',
          get: () => entry().opts.color ?? this.pop.env.paper.color,
          set: (v) => {
            entry().opts.color = v as string;
            for (const m of all()) m.color.set(v as string);
          },
        },
        num('spacing', 'uSpacing', 'Hatch line spacing in mm (compensated for group scale).', 0.2, 10, 'mm'),
        num('shade', 'uShade', 'Darkening of the paper tone on dark sides.', 0, 1),
        num('hatch', 'uHatch', '1 hatched, 0 plain paper.', 0, 1),
        num('seed', 'uSeed', 'Seed of the hatch wobble and gaps.', 0, 9999),
        {
          key: 'hatchA', label: 'Hatch A', type: 'vector3', help: 'Main hatch plane normal (object space).',
          get: () => entry().opts.hatchA ?? this.pop.env.paper.hatchA,
          set: (v) => {
            entry().opts.hatchA = v as number[];
            for (const m of all()) setHatchDir(m.userData.paper, 'A', v as number[]);
          },
        },
        {
          key: 'hatchB', label: 'Hatch B', type: 'vector3', help: 'Cross-hatch plane normal (shadow only).',
          get: () => entry().opts.hatchB ?? this.pop.env.paper.hatchB,
          set: (v) => {
            entry().opts.hatchB = v as number[];
            for (const m of all()) setHatchDir(m.userData.paper, 'B', v as number[]);
          },
        },
      ],
    });
  }

  private registerInk(id: string, label: string, mat: InkMaterial): void {
    const u = mat.uniforms;
    this.pop.ctx.registry.add({
      id, label, tags: ['material', 'ink', 'shader'], kind: 'ink-material', source: 'src/engine/ink/line-material.ts',
      describe: 'Pen line material: standing width in screen pixels (times the line scale), colour, opacity and pull toward the eye.',
      params: [
        { key: 'widthPx', label: 'Width', type: 'number', unit: 'px', min: 0.1, max: 10, get: () => u.uWidthPx!.value as number, set: (v) => void (u.uWidthPx!.value = v) },
        { key: 'color', label: 'Colour', type: 'color', get: () => '#' + (u.uInk!.value as Color).getHexString(), set: (v) => void (u.uInk!.value as Color).set(v as string) },
        { key: 'opacity', label: 'Opacity', type: 'number', min: 0, max: 1, get: () => u.uOpacity!.value as number, set: (v) => void (u.uOpacity!.value = v) },
        { key: 'bias', label: 'Bias', type: 'number', unit: 'mm', min: 0, max: 10, get: () => u.uBias!.value as number, set: (v) => void (u.uBias!.value = v) },
      ],
    });
  }
}

/** One level of the kit: where parts go (parent group), their id path and the accumulated scale. */
export class Scope {
  readonly root: KitRoot;
  readonly parent: Object3D;
  readonly path: string;
  readonly scale: number;
  /** The pen of this scope (a `later` scope has its own). */
  readonly pen: Pen | null;

  constructor(root: KitRoot, parent: Object3D, path: string, scale: number, pen: Pen | null) {
    this.root = root;
    this.parent = parent;
    this.path = path;
    this.scale = scale;
    this.pen = pen;
  }

  get pop(): PopModel {
    return this.root.pop;
  }

  /** The schedule of a stroke of `len` mm. */
  schedule(len: number, time?: TimeSpec): { sched?: PenSchedule; t0?: number; dur?: number } {
    if (time && time.t0 !== undefined) return { t0: time.t0, dur: time.dur ?? 0.3 };
    if (!this.pen) return { t0: 0, dur: time?.dur ?? 0.3 };
    return { sched: this.pen.next(time?.length ?? len, time?.delay ?? 0) };
  }

  /** Line options for a stroke with style; schedules it with the pen unless `extra` carries a schedule. */
  lineOpts(points: readonly XYZ[], style: StrokeStyle = {}, extra: LineOptions = {}): LineOptions {
    const timed = extra.sched !== undefined || extra.t0 !== undefined;
    const out: LineOptions = {
      width: style.width ?? 1,
      seed: style.seed,
      maxSeg: style.maxSeg,
      overshoot: style.overshoot,
      wobble: style.wobble,
      ...(timed ? {} : this.schedule(polylineLength(points, !!extra.closed), style.time)),
      ...extra,
    };
    if (style.taper !== undefined && extra.taper === undefined) out.taper = style.taper;
    if (style.print === false) out.visibleInPrint = false;
    return out;
  }

  /** A new static set on `parent` (built when the kit finishes). */
  staticSet(mat: InkMaterial, parent: Object3D): InkLineSet {
    const s = this.pop.lines(mat);
    this.pop.addLines(s, parent);
    if (this.root.finished) queueMicrotask(() => s.build());
    else this.root.pending.push(s);
    return s;
  }

  /** A new dynamic set on `parent`. */
  dynamicSet(mat: InkMaterial, parent: Object3D, capacity: number): InkLineSet {
    const s = this.pop.lines(mat, { capacity });
    this.pop.addLines(s, parent);
    return s;
  }

  /** Creates the part group under this scope, positioned and rotated. */
  part(kind: string, opts: PartOptions): Part {
    const local = (opts.id ?? this.root.nextId(kind)).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
    const id = `${this.path}.${local}`;
    const group = new Group();
    group.name = id;
    v3(opts.at, group.position);
    if (opts.rotation) {
      const r = v3(opts.rotation);
      group.rotation.copy(new Euler(r.x, r.y, r.z));
    }
    this.parent.add(group);
    return { id, group, sets: [], surfaces: [] };
  }

  /** Registers the part with standard params (visible, position, rotation) plus extras. */
  register(part: Part, kind: string, opts: PartOptions, describe: string, params: ParamSpec[] = []): void {
    const g = part.group;
    this.pop.ctx.registry.add({
      id: part.id,
      label: opts.label ?? human(part.id.slice(part.id.lastIndexOf('.') + 1)),
      tags: ['object', 'ink', 'figure', ...(opts.tags ?? [])],
      kind: `ink-${kind}`,
      object: g,
      describe: opts.describe ?? describe,
      source: 'lesson figure module (ink kit)',
      params: [
        { key: 'visible', label: 'Visible', type: 'boolean', get: () => g.visible, set: (v) => void (g.visible = !!v) },
        { key: 'position', label: 'Position', type: 'vector3', unit: 'mm', help: 'Position in the parent (model mm).', get: () => g.position.toArray(), set: (v) => void g.position.fromArray(v as number[]) },
        {
          key: 'rotation', label: 'Rotation', type: 'vector3', unit: 'rad', help: 'Euler XYZ rotation.',
          get: () => [g.rotation.x, g.rotation.y, g.rotation.z], set: (v) => void g.rotation.set(...((v as number[]).slice(0, 3) as [number, number, number])),
        },
        ...params,
      ],
    });
  }

  /** Adds a paper surface mesh to the pop under `parent`. */
  surface(part: Part, mesh: Mesh, parent: Object3D = part.group, castShadow = true): Mesh {
    mesh.userData.castShadow = castShadow;
    this.pop.addSurface(mesh, parent);
    part.surfaces.push(mesh);
    return mesh;
  }

  /** Registers a per-frame updater with the pop. */
  every(fn: (f: PopFrame) => void): () => void {
    return this.pop.addUpdater(fn);
  }
}
