/**
 * Spill light slots: up to three point lights follow the strongest glow sources (energy stores, streams, lamps) so
 * their coloured light falls on the page, the pad and nearby paper. Incumbents get a score bonus (hysteresis),
 * newcomers fade in, losers fade out, vanished sources cut at once.
 */
import type { Color, Vector3 } from 'three';
import type { GlowSource } from '../contracts';

export interface SpillSlotParams {
  /** Intensity per unit strength (candela in mm units, decay 2: E = I / d^2). */
  gain: number;
  /** Sources at or below this strength are ignored. */
  minStrength: number;
  /** Score bonus for a source that already holds a slot. */
  hysteresis: number;
  /** Fade rate (1/s) of a slot's weight k. */
  rate: number;
  /** A fading slot is released when k drops below this. */
  release: number;
}

export const SPILL_SLOT_DEFAULTS: SpillSlotParams = { gain: 2600, minStrength: 0.01, hysteresis: 0.2, rate: 12, release: 0.02 };

export interface SpillTarget {
  position: Vector3;
  color: Color;
  intensity: number;
}

export interface SpillSlot {
  id: string | null;
  k: number;
}

export class SpillSlots {
  readonly slots: SpillSlot[];
  private readonly active: GlowSource[] = [];
  private readonly winners: GlowSource[] = [];
  private readonly newcomers: GlowSource[] = [];
  private scoreOf = (s: GlowSource) => s.strength + (this.holds(s.id) ? this.params.hysteresis : 0);
  private readonly byScore = (a: GlowSource, b: GlowSource) => this.scoreOf(b) - this.scoreOf(a);

  constructor(readonly targets: readonly SpillTarget[], public params: SpillSlotParams = { ...SPILL_SLOT_DEFAULTS }) {
    this.slots = targets.map(() => ({ id: null, k: 0 }));
  }

  holds(id: string): boolean {
    for (const s of this.slots) if (s.id === id) return true;
    return false;
  }

  /** Runs once per frame with the live sources (an empty list when nothing is live). */
  update(sources: readonly GlowSource[], dt: number): void {
    const p = this.params;
    const { active, winners, newcomers, slots } = this;
    active.length = 0;
    for (const s of sources) if (s.strength > p.minStrength) active.push(s);
    active.sort(this.byScore);
    winners.length = 0;
    for (let i = 0; i < active.length && i < slots.length; i++) winners.push(active[i]!);
    newcomers.length = 0;
    for (const w of winners) if (!this.holds(w.id)) newcomers.push(w);
    const h = 1 - Math.exp(-p.rate * Math.max(0, dt));
    let next = 0;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      if (slot.id !== null) {
        if (!find(active, slot.id)) {
          slot.id = null;
          slot.k = 0;
        } else if (!find(winners, slot.id)) {
          slot.k -= slot.k * h;
          if (slot.k < p.release) {
            slot.id = null;
            slot.k = 0;
          }
        }
      }
      if (slot.id === null && next < newcomers.length) {
        slot.id = newcomers[next++]!.id;
        slot.k = 0;
      }
      const src = slot.id !== null ? find(active, slot.id) : undefined;
      if (src && find(winners, slot.id!)) slot.k += (1 - slot.k) * h;
      const t = this.targets[i]!;
      if (src) {
        t.position.copy(src.position);
        t.color.copy(src.color);
        t.intensity = p.gain * src.strength * slot.k;
      } else {
        t.intensity = 0;
      }
    }
  }

  reset(): void {
    for (const s of this.slots) {
      s.id = null;
      s.k = 0;
    }
    for (const t of this.targets) t.intensity = 0;
  }
}

function find(list: readonly GlowSource[], id: string): GlowSource | undefined {
  for (const s of list) if (s.id === id) return s;
  return undefined;
}
