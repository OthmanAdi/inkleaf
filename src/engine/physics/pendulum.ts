/**
 * A simple pendulum (bob on a light rod), on the same integrator and ledger conventions as the other models:
 * gravitational and kinetic energy trade every swing; quadratic air drag and optional pivot damping move kinetic
 * energy to the thermal store of the bob and air. Turning points and bottom passes are located exactly.
 */
import { physicsConfig } from './config';
import { EventStepper, type Derivative, type EventSpec } from './integrator';
import { Simulation, type SimValue } from './simulation';

export interface PendulumState {
  phase: 'held' | 'swinging';
  theta: number;
  omega: number;
  heat: number;
  turns: { t: number; theta: number }[];
  passes: { t: number; speed: number }[];
}

/** Arithmetic-geometric mean (for the exact period). */
export function agm(a: number, b: number): number {
  for (let i = 0; i < 40 && Math.abs(a - b) > 1e-15 * a; i++) [a, b] = [(a + b) / 2, Math.sqrt(a * b)];
  return a;
}

export class Pendulum extends Simulation<PendulumState> {
  readonly accounts: { gravitational: string; kinetic: string; thermal: string };
  private readonly stepper = new EventStepper(4);
  private readonly y = new Float64Array(4);
  private readonly out = new Float64Array(4);
  private dir = 1;
  private readonly f: Derivative;
  private readonly events: EventSpec[] = [
    { g: (y) => y[1]! * this.dir, dir: -1 },
    { g: (y) => y[0]! * -this.dir, dir: -1 },
  ];

  constructor(opts: { params?: Record<string, SimValue>; object?: string } = {}) {
    const d = physicsConfig.pendulum;
    super(
      {
        L: { value: d.L, min: 0.05, max: 10, unit: 'm', label: 'Length' },
        m: { value: d.m, min: 0.01, max: 20, unit: 'kg', label: 'Mass' },
        theta0: { value: d.theta0, min: -3, max: 3, unit: 'rad', label: 'Start angle' },
        drag: { value: d.drag, min: 0, max: 1, unit: 'kg/m', label: 'Drag coefficient' },
        damping: { value: d.damping, min: 0, max: 10, unit: 'kg/s', label: 'Pivot damping' },
      },
      opts.params,
    );
    const object = opts.object ?? 'bob';
    this.accounts = { gravitational: `gravitational:${object}`, kinetic: `kinetic:${object}`, thermal: `thermal:${object} and air` };
    this.f = (y, o) => {
      const g = physicsConfig.constants.g;
      const L = this.num('L');
      const m = this.num('m');
      const c = this.num('drag');
      const b = this.num('damping');
      const th = y[0]!;
      const w = y[1]!;
      const v = L * w;
      const drag = this.dir * (c / m) * v * v + (b / m) * v;
      o[0] = w;
      o[1] = (-g * Math.sin(th) - drag) / L;
      o[2] = -m * g * L * Math.sin(th) * w;
      o[3] = (this.dir * c * v * v + b * v) * v;
    };
    this.reset();
  }

  protected initState(): PendulumState {
    return { phase: 'held', theta: this.num('theta0'), omega: 0, heat: 0, turns: [], passes: [] };
  }

  energies(): Record<string, number> {
    const s = this.state;
    const L = this.num('L');
    const m = this.num('m');
    return {
      [this.accounts.gravitational]: m * physicsConfig.constants.g * L * (1 - Math.cos(s.theta)),
      [this.accounts.kinetic]: 0.5 * m * L * L * s.omega * s.omega,
      [this.accounts.thermal]: s.heat,
    };
  }

  /** Bob position relative to the pivot (metres; y up, pivot at 0). */
  bob(): { x: number; y: number } {
    const L = this.num('L');
    return { x: L * Math.sin(this.state.theta), y: -L * Math.cos(this.state.theta) };
  }

  /** Exact period for an amplitude (no drag): 2 pi sqrt(L/g) / agm(1, cos(amplitude / 2)). */
  period(amplitude = this.num('theta0')): number {
    const L = this.num('L');
    return (2 * Math.PI * Math.sqrt(L / physicsConfig.constants.g)) / agm(1, Math.cos(Math.abs(amplitude) / 2));
  }

  /** The hand holds the bob at angle theta. */
  hold(theta: number): void {
    const s = this.state;
    const L = this.num('L');
    const m = this.num('m');
    const g = physicsConfig.constants.g;
    this.hand(this.accounts.kinetic, -0.5 * m * L * L * s.omega * s.omega);
    this.hand(this.accounts.gravitational, m * g * L * (Math.cos(s.theta) - Math.cos(theta)));
    s.theta = theta;
    s.omega = 0;
    s.phase = 'held';
  }

  release(): void {
    if (this.state.phase === 'held') {
      this.state.phase = 'swinging';
      this.state.turns = [];
      this.state.passes = [];
    }
  }

  protected substep(h: number): void {
    const s = this.state;
    if (s.phase !== 'swinging') return;
    let left = h;
    let t = this.time;
    for (let split = 0; split < physicsConfig.pendulum.splits && left > 0; split++) {
      if (s.omega === 0) {
        if (s.theta === 0) return;
        this.dir = s.theta > 0 ? -1 : 1;
      } else this.dir = s.omega > 0 ? 1 : -1;
      const y = this.y;
      y[0] = s.theta;
      y[1] = s.omega;
      y[2] = 0;
      y[3] = 0;
      const r = this.stepper.step(this.f, y, left, this.events, this.out);
      s.theta = this.out[0]!;
      s.omega = this.out[1]!;
      this.ledger.move(this.accounts.gravitational, this.accounts.kinetic, this.out[2]!, 'mechanical');
      const wd = Math.max(0, this.out[3]!);
      if (wd > 0) {
        this.ledger.transfer(this.accounts.kinetic, this.accounts.thermal, wd, 'heating');
        s.heat += wd;
      }
      left -= r.h;
      t += r.h;
      if (r.event === 0) {
        s.omega = 0;
        s.turns.push({ t, theta: s.theta });
        if (s.turns.length > 40) s.turns.shift();
      } else if (r.event === 1) {
        s.passes.push({ t, speed: Math.abs(s.omega) * this.num('L') });
        if (s.passes.length > 40) s.passes.shift();
      }
    }
  }
}
