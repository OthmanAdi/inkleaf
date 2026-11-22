/**
 * Glow routing. Every glowing part (liquid, bubbles, stream tube and beads, ribbons, special cores) goes on the glow
 * layer (the top-down spill camera renders it onto the pages) and into the selective bloom. The strongest glow
 * sources also drive a few real coloured point lights through `SpillSlots`, so the paper around a lit jar takes its
 * colour.
 */
import type { Color, Object3D, Vector3 } from 'three';
import { LAYERS, type GlowSource } from '../contracts';
import { energyConfig } from './config';

export type BloomSelect = (obj: Object3D, on: boolean) => void;

export class GlowRouter {
  private readonly objects = new Set<Object3D>();
  private readonly select?: BloomSelect;

  constructor(opts: { bloomSelect?: BloomSelect } = {}) {
    this.select = opts.bloomSelect;
  }

  /** Puts objects on the glow layer and selects them for bloom. */
  add(objs: Object3D | Iterable<Object3D>): void {
    for (const o of isIterable(objs) ? objs : [objs]) {
      if (this.objects.has(o)) continue;
      this.objects.add(o);
      o.layers.enable(LAYERS.glow);
      o.layers.disable(LAYERS.pop);
      this.select?.(o, true);
    }
  }

  remove(objs: Object3D | Iterable<Object3D>): void {
    for (const o of isIterable(objs) ? objs : [objs]) {
      if (!this.objects.delete(o)) continue;
      o.layers.disable(LAYERS.glow);
      this.select?.(o, false);
    }
  }

  clear(): void {
    this.remove([...this.objects]);
  }

  get size(): number {
    return this.objects.size;
  }

  has(o: Object3D): boolean {
    return this.objects.has(o);
  }
}

const isIterable = (x: unknown): x is Iterable<Object3D> => typeof x === 'object' && x !== null && Symbol.iterator in x;

/** Routes a lesson's glow objects and returns the undo (call it when the lesson unmounts). */
export function routeGlow(objs: Iterable<Object3D>, bloomSelect?: BloomSelect): () => void {
  const r = new GlowRouter({ bloomSelect });
  r.add(objs);
  return () => r.clear();
}

export interface SpillTarget {
  position: Vector3;
  color: Color;
  intensity: number;
}

export interface SpillSlot {
  id: string | null;
  /** Fade weight 0..1. */
  k: number;
  /** The source this slot showed this frame (null when empty). */
  source: GlowSource | null;
  intensity: number;
}

/**
 * Assigns glow sources to a fixed number of light slots each frame: the top sources by score (strength, plus a bonus
 * for incumbents) win; newcomers fill empty slots and fade in, losers fade out, vanished sources are cut at once.
 * Point light intensity = gain * strength * k (`energy.spill-lights`).
 */
export class SpillSlots {
  readonly slots: SpillSlot[];
  readonly targets: readonly SpillTarget[];
  private readonly live: GlowSource[] = [];
  private readonly chosen: GlowSource[] = [];
  private readonly newcomers: GlowSource[] = [];
  private readonly score = (s: GlowSource) => s.strength + (this.holds(s.id) ? energyConfig.spill.hysteresis : 0);
  private readonly order = (a: GlowSource, b: GlowSource) => this.score(b) - this.score(a);

  /** `targets` are usually the stage's point lights; a number makes that many target-less slots. */
  constructor(targets: readonly SpillTarget[] | number = 3) {
    this.targets = typeof targets === 'number' ? [] : targets;
    const n = typeof targets === 'number' ? targets : targets.length;
    this.slots = Array.from({ length: n }, () => ({ id: null, k: 0, source: null, intensity: 0 }));
  }

  holds(id: string): boolean {
    for (const s of this.slots) if (s.id === id) return true;
    return false;
  }

  /** Call once per frame with the live sources (an empty list when nothing is live). */
  update(sources: readonly GlowSource[], dt: number): this {
    const c = energyConfig.spill;
    const { live, chosen, newcomers, slots } = this;
    live.length = 0;
    for (const s of sources) if (s.strength > c.minStrength) live.push(s);
    live.sort(this.order);
    chosen.length = 0;
    for (let i = 0; i < live.length && i < slots.length; i++) chosen.push(live[i]!);
    newcomers.length = 0;
    for (const s of chosen) if (!this.holds(s.id)) newcomers.push(s);
    const h = 1 - Math.exp(-c.rate * Math.max(0, dt));
    let next = 0;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      if (slot.id !== null) {
        if (!find(live, slot.id)) clear(slot);
        else if (!find(chosen, slot.id)) {
          slot.k -= slot.k * h;
          if (slot.k < c.drop) clear(slot);
        }
      }
      if (slot.id === null && next < newcomers.length) {
        slot.id = newcomers[next++]!.id;
        slot.k = 0;
      }
      const src = slot.id !== null ? find(live, slot.id) : undefined;
      if (src && find(chosen, src.id)) slot.k += (1 - slot.k) * h;
      slot.source = src ?? null;
      slot.intensity = src ? c.gain * src.strength * slot.k : 0;
      const t = this.targets[i];
      if (t) {
        t.intensity = slot.intensity;
        if (src) {
          t.position.copy(src.position);
          t.color.copy(src.color);
        }
      }
    }
    return this;
  }

  reset(): void {
    for (const s of this.slots) clear(s);
    for (const t of this.targets) t.intensity = 0;
  }
}

function clear(s: SpillSlot): void {
  s.id = null;
  s.k = 0;
  s.source = null;
  s.intensity = 0;
}

function find(list: readonly GlowSource[], id: string): GlowSource | undefined {
  for (const s of list) if (s.id === id) return s;
  return undefined;
}
