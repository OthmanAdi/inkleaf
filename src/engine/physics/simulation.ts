/**
 * Simulation base: parameters with ranges, an energy ledger, and a frame stepper that cuts long frames at 0.25 s and
 * runs equal sub-steps of at most 1 ms. Models integrate augmented states whose last components are work integrals
 * and book that work in the ledger every piece, which is how smoothed power flows arise.
 */
import type { ParamSpec, Registry } from '../core/registry';
import { Ledger, type LedgerOptions } from '../energy/ledger';
import { physicsConfig } from './config';
import { splitFrame } from './integrator';

export type SimValue = number | boolean | string | null;

export interface SimParam {
  value: SimValue;
  min?: number;
  max?: number;
  unit?: string;
  label?: string;
  note?: string;
  /** The value is an example, not a measurement. */
  illustrative?: boolean;
  type?: 'number' | 'choice' | 'boolean';
  choices?: readonly string[];
  nullable?: boolean;
  positive?: boolean;
}

/** The party a reader's hand is booked as when they move things. */
export const HAND = 'hand';

export abstract class Simulation<S> {
  readonly ledger: Ledger;
  readonly paramDefs: Readonly<Record<string, SimParam>>;
  readonly params: Record<string, SimValue>;
  state!: S;
  /** Simulation seconds since the last reset. */
  time = 0;

  constructor(paramDefs: Record<string, SimParam>, overrides: Record<string, SimValue> = {}, ledger: LedgerOptions = {}) {
    this.paramDefs = paramDefs;
    this.params = {};
    for (const [k, d] of Object.entries(paramDefs)) this.params[k] = d.value;
    for (const [k, v] of Object.entries(overrides)) this.set(k, v, false);
    this.ledger = new Ledger(ledger);
  }

  /** Initial state for the current parameters. */
  protected abstract initState(): S;
  /** Energy per ledger account ("store:object" -> J), read from the state. */
  abstract energies(): Record<string, number>;
  /** Advances the state by one sub-step and books its transfers. */
  protected abstract substep(h: number): void;
  /** Called after a parameter changes (default: reset). */
  protected onParam(_key: string): void {
    this.reset();
  }

  num(key: string): number {
    return Number(this.params[key] ?? 0);
  }

  /** Coerces and stores a parameter (numbers clamped to their range), then lets the model react. */
  set(key: string, value: SimValue, notify = true): void {
    const d = this.paramDefs[key];
    if (!d) throw new Error(`inkleaf: simulation has no parameter "${key}" (has: ${Object.keys(this.paramDefs).join(', ')})`);
    let v: SimValue = value;
    if (v === null && !d.nullable) return;
    if (d.type === 'boolean') v = Boolean(v);
    else if (d.type === 'choice') {
      if (!d.choices?.includes(String(v))) return;
      v = String(v);
    } else if (v !== null) {
      let n = Number(v);
      if (!Number.isFinite(n)) return;
      if (d.min !== undefined) n = Math.max(d.min, n);
      if (d.max !== undefined) n = Math.min(d.max, n);
      if (d.positive && n <= 0) return;
      v = n;
    }
    this.params[key] = v;
    if (notify) this.onParam(key);
  }

  reset(): void {
    this.state = this.initState();
    this.time = 0;
    this.reopen();
  }

  /** Clears the ledger and opens one account per energy with its current value as the opening balance. */
  reopen(): void {
    this.ledger.reset();
    for (const [k, v] of Object.entries(this.energies())) this.ledger.open(k, v);
  }

  step(dt: number): void {
    if (!(dt > 0)) return;
    const { n, h, dt: d } = splitFrame(dt, physicsConfig.integrator.maxSubstep, physicsConfig.integrator.maxFrame);
    this.ledger.beginStep(d);
    try {
      for (let i = 0; i < n; i++) {
        this.substep(h);
        this.time += h;
      }
    } finally {
      this.ledger.endStep();
    }
  }

  /** The reader's hand moves energy in (J > 0) or out (J < 0) of an account. */
  hand(account: string, J: number): void {
    if (J !== 0) this.ledger.exchange(account, J, 'mechanical', HAND);
  }

  /** Sum of all energies the model reports. */
  totalEnergy(): number {
    let s = 0;
    for (const v of Object.values(this.energies())) s += v;
    return s;
  }

  /**
   * Registers this instance's parameters under `id` (for example `lesson-2.ramp-sim`) so they can be changed by name.
   */
  register(registry: Registry, id: string, label: string, describe?: string): void {
    registry.add({
      id, label, kind: 'simulation', tags: ['physics', 'energy'], describe, source: 'src/engine/physics/simulation.ts',
      params: Object.entries(this.paramDefs).map(([key, d]): ParamSpec => ({
        key,
        label: d.label ?? key,
        type: d.type === 'boolean' ? 'boolean' : d.type === 'choice' ? 'enum' : 'number',
        options: d.choices,
        min: d.min,
        max: d.max,
        unit: d.unit,
        help: d.note,
        get: () => (this.params[key] ?? (d.type === 'boolean' ? false : d.type === 'choice' ? '' : 0)) as number | string | boolean,
        set: (v: number | string | boolean | readonly number[]) => this.set(key, v as SimValue),
      })),
    });
  }
}

/** Shared constant access (live: reads `physics.constants`). */
export const G = (): number => physicsConfig.constants.g;
