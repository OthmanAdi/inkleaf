/**
 * A stacked total bar: a thin inked box filled bottom-up with one coloured paper segment per store. While stores
 * trade energy the segments change size but the stack keeps its height: the total is conserved.
 */
import { BoxGeometry, Color, Group, Mesh, Vector3, type Material, type Object3D } from 'three';
import type { LineSet, Pop } from '../contracts';
import type { Registry } from '../core/registry';
import { energyConfig, registerEnergy } from './config';
import { defaultPalette, type Palette } from './palette';

export interface BarSegment { y: number; scale: number; visible: boolean }

/** Segment layout: each store's share of `h` stacked from `base`, clipped below the top. */
export function stackBar(values: readonly number[], capacity: number, h: number, base = energyConfig.bar.base, out: BarSegment[] = []): BarSegment[] {
  let y0 = base;
  out.length = values.length;
  for (let i = 0; i < values.length; i++) {
    const e = Math.min(h - 0.6, (Math.max(0, values[i]!) / capacity) * h);
    out[i] = { y: y0, scale: Math.max(0.01, Math.min(e, h - 0.3 - y0)), visible: e > energyConfig.bar.minVisible };
    y0 += e;
  }
  return out;
}

export interface TotalBarOptions {
  id?: string;
  label?: string;
  registry?: Registry;
  palette?: Palette;
  /** Quantity ids, bottom first. */
  keys: readonly string[];
  position?: Vector3 | readonly [number, number, number];
  w?: number;
  h?: number;
  depth?: number;
  capacity?: number;
  t0?: number;
  parent?: Object3D;
}

export class TotalBar {
  readonly group = new Group();
  readonly keys: readonly string[];
  readonly lines: LineSet;
  readonly segments: Mesh[] = [];
  readonly palette: Palette;
  readonly w: number;
  readonly h: number;
  capacity: number;
  private readonly layout: BarSegment[] = [];
  private values: number[];

  constructor(pop: Pop, opts: TotalBarOptions) {
    if (opts.registry) registerEnergy(opts.registry);
    const B = energyConfig.bar;
    this.palette = opts.palette ?? defaultPalette();
    this.keys = opts.keys;
    this.w = opts.w ?? 6;
    this.h = opts.h ?? 46;
    const d = opts.depth ?? 4;
    this.capacity = opts.capacity ?? 10;
    this.values = this.keys.map(() => 0);
    const t0 = opts.t0 ?? 0;
    const p = opts.position;
    if (p) Array.isArray(p) ? this.group.position.set(p[0]!, p[1]!, p[2]!) : this.group.position.copy(p as Vector3);
    this.group.name = opts.id ?? 'total-bar';
    (opts.parent ?? pop.group).add(this.group);
    const { w, h } = this;
    const x0 = -w / 2;
    const x1 = w / 2;
    const zf = d / 2;
    this.lines = pop.lines(pop.ink({ widthPx: B.widthPx }));
    this.lines.add([new Vector3(x0, 0, zf), new Vector3(x1, 0, zf), new Vector3(x1, h, zf), new Vector3(x0, h, zf)], { closed: true, width: B.frontWidth, t0, dur: B.frontDur });
    this.lines.add([new Vector3(x1, 0, zf), new Vector3(x1, 0, -zf), new Vector3(x1, h, -zf), new Vector3(x0, h, -zf), new Vector3(x0, h, zf)], { width: B.sideWidth, t0: t0 + B.sideDelay, dur: B.sideDur });
    for (let a = 1; a <= 3; a++) {
      const y = (h * a) / 4;
      this.lines.add([new Vector3(x1 - B.tickLen, y, zf), new Vector3(x1, y, zf)], { width: B.tickWidth, t0: t0 + B.tickDelay + B.tickStagger * a, dur: B.tickDur });
    }
    this.lines.build();
    pop.addLines(this.lines, this.group);
    const geo = new BoxGeometry(w - 0.6, 1, d - 0.6);
    geo.translate(0, 0.5, 0);
    for (const key of this.keys) {
      const mat = pop.paper({ color: this.palette.get(key)?.hex ?? '#888888', hatch: 0, shade: B.shade });
      const m = new Mesh(geo, mat);
      m.name = `${this.group.name}.${key}`;
      m.visible = false;
      m.castShadow = false;
      m.userData.castShadow = false;
      pop.addSurface(m, this.group);
      m.castShadow = false;
      this.segments.push(m);
    }
    if (opts.registry && opts.id) this.register(opts.registry, opts.id, opts.label);
  }

  /** Sets the stored amounts (same order as `keys`); immediate, no smoothing. */
  set(values: readonly number[]): void {
    this.values = [...values];
    stackBar(values, this.capacity, this.h, energyConfig.bar.base, this.layout);
    for (let i = 0; i < this.segments.length; i++) {
      const s = this.segments[i]!;
      const l = this.layout[i];
      if (!l) {
        s.visible = false;
        continue;
      }
      s.visible = l.visible;
      s.position.y = l.y;
      s.scale.y = l.scale;
      const c = (s.material as Material & { color?: Color }).color;
      const key = this.keys[i];
      if (c && key && this.palette.has(key)) c.copy(this.palette.color(key));
    }
  }

  register(registry: Registry, id: string, label?: string): void {
    const self = this;
    registry.add({
      id, label: label ?? 'Total energy bar', kind: 'energy-bar', tags: ['object', 'energy', 'ink'], object: this.group,
      describe: `A stacked bar of ${this.keys.join(', ')}: one coloured segment per store, full height = capacity.`,
      source: 'src/engine/energy/total-bar.ts',
      params: [
        { key: 'capacity', label: 'Capacity', type: 'number', min: 1e-9, unit: 'J', help: 'Amount that fills the bar', get: () => self.capacity, set: (v) => ((self.capacity = Number(v)), self.set(self.values)) },
        { key: 'position', label: 'Position', type: 'vector3', unit: 'mm', help: 'Bar foot in the figure', get: () => self.group.position.toArray(), set: (v) => void self.group.position.fromArray(v as number[]) },
      ],
    });
  }

  dispose(): void {
    this.group.removeFromParent();
    this.segments[0]?.geometry.dispose();
  }
}
