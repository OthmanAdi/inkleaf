/**
 * A ball on a curved track. Gravity along the track trades gravitational and kinetic energy; with friction on,
 * rolling resistance (proportional to the normal force, which includes the centripetal part) and air drag move
 * kinetic energy to the thermal store of the track and air. The ball turns exactly where its speed reaches zero.
 */
import { physicsConfig } from './config';
import { EventStepper, type Derivative, type EventSpec } from './integrator';
import { Simulation, type SimValue } from './simulation';
import { Track } from './track';

/** The default valley track (metres). */
export const DEFAULT_TRACK = { xs: [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.75], ys: [1.2, 0.6, 0.2, 0.05, 0.2, 0.6, 1.0] } as const;

export interface RampState {
  phase: 'held' | 'rolling' | 'rest';
  x: number;
  /** Signed speed along the track (positive toward larger x). */
  v: number;
  heat: number;
  turns: { t: number; x: number; h: number; side: 'left' | 'right' }[];
}

export class Ramp extends Simulation<RampState> {
  readonly track: Track;
  readonly valleyX: number;
  readonly flagX: number;
  readonly startX: number;
  readonly accounts: { gravitational: string; kinetic: string; thermal: string };
  private readonly stepper = new EventStepper(4);
  private readonly y = new Float64Array(4);
  private readonly out = new Float64Array(4);
  private dir = 1;
  private readonly f: Derivative;
  private readonly events: EventSpec[];

  constructor(opts: { track?: { xs: readonly number[]; ys: readonly number[] }; params?: Record<string, SimValue>; object?: string; surface?: string } = {}) {
    const d = physicsConfig.ramp;
    super(
      {
        m: { value: d.m, min: 0.1, max: 2, unit: 'kg', label: 'Mass' },
        friction: { value: d.friction, type: 'boolean', label: 'Friction' },
        mu: { value: d.mu, min: 0, max: 0.3, label: 'Rolling friction coefficient' },
        c: { value: d.drag, min: 0, max: 0.01, unit: 'kg/m', label: 'Drag coefficient' },
      },
      opts.params,
    );
    const t = opts.track ?? DEFAULT_TRACK;
    this.track = new Track(t.xs, t.ys, physicsConfig.ramp.glSub);
    const tr = this.track;
    let low = 0;
    for (let i = 1; i < tr.ys.length; i++) if (tr.ys[i]! < tr.ys[low]!) low = i;
    const a = tr.xs[Math.max(0, low - 1)]!;
    const b = tr.xs[Math.min(tr.xs.length - 1, low + 1)]!;
    this.valleyX = tr.valley(a, b);
    this.flagX = tr.xAtHeight(physicsConfig.ramp.flag, this.valleyX, tr.xEnd);
    this.startX = tr.xAtHeight(physicsConfig.ramp.startHeight, tr.xStart, this.valleyX);
    const object = opts.object ?? 'ball';
    this.accounts = { gravitational: `gravitational:${object}`, kinetic: `kinetic:${object}`, thermal: `thermal:${opts.surface ?? 'track and air'}` };
    this.f = (y, o) => {
      const g = physicsConfig.constants.g;
      const x = y[0]!;
      const v = y[1]!;
      const e = tr.dy(x);
      const q = Math.sqrt(1 + e * e);
      const ag = (-g * e) / q;
      let af = 0;
      if (this.params.friction) {
        const k2 = tr.d2y(x);
        const n = g / q + (k2 * v * v) / (q * q * q);
        af = this.num('mu') * Math.abs(n) + (this.num('c') / this.num('m')) * v * v;
      }
      const m = this.num('m');
      o[0] = v / q;
      o[1] = ag - this.dir * af;
      o[2] = m * ag * v;
      o[3] = m * af * v * this.dir;
    };
    this.events = [
      { g: (y) => y[1]! * this.dir, dir: -1 },
      { g: (y) => tr.xEnd - y[0]!, dir: -1 },
      { g: (y) => y[0]! - tr.xStart, dir: -1 },
    ];
    this.reset();
  }

  protected initState(): RampState {
    return { phase: 'held', x: this.startX, v: 0, heat: 0, turns: [] };
  }

  /** Changing friction keeps the ball where it is. */
  protected override onParam(key: string): void {
    if (key !== 'friction' && key !== 'mu' && key !== 'c') this.reset();
  }

  energies(): Record<string, number> {
    const s = this.state;
    const m = this.num('m');
    return {
      [this.accounts.gravitational]: m * physicsConfig.constants.g * this.track.y(s.x),
      [this.accounts.kinetic]: 0.5 * m * s.v * s.v,
      [this.accounts.thermal]: s.heat,
    };
  }

  height(): number {
    return this.track.y(this.state.x);
  }

  /** The hand holds the ball at track x (energy booked as the hand's work). */
  hold(x: number): void {
    const s = this.state;
    const tr = this.track;
    const nx = Math.min(tr.xEnd, Math.max(tr.xStart, x));
    const m = this.num('m');
    this.hand(this.accounts.kinetic, -0.5 * m * s.v * s.v);
    this.hand(this.accounts.gravitational, m * physicsConfig.constants.g * (tr.y(nx) - tr.y(s.x)));
    s.x = nx;
    s.v = 0;
    s.phase = 'held';
  }

  /** Holds the ball at arc length s along the track. */
  grab(s: number): void {
    this.hold(this.track.x(s));
  }

  release(): void {
    const s = this.state;
    if (s.phase === 'held' || s.phase === 'rest') {
      s.phase = 'rolling';
      s.turns = [];
    }
  }

  private stuck(x: number): boolean {
    const e = this.track.dy(x);
    return e === 0 || (Boolean(this.params.friction) && Math.abs(e) <= this.num('mu'));
  }

  protected substep(h: number): void {
    const s = this.state;
    if (s.phase !== 'rolling') return;
    const tr = this.track;
    let left = h;
    let t = this.time;
    for (let split = 0; split < physicsConfig.ramp.splits && left > 0; split++) {
      if (s.v === 0) {
        if (this.stuck(s.x)) {
          s.phase = 'rest';
          return;
        }
        this.dir = tr.dy(s.x) > 0 ? -1 : 1;
      } else this.dir = s.v > 0 ? 1 : -1;
      const y = this.y;
      y[0] = s.x;
      y[1] = s.v;
      y[2] = 0;
      y[3] = 0;
      const r = this.stepper.step(this.f, y, left, this.events, this.out);
      s.x = this.out[0]!;
      s.v = this.out[1]!;
      this.ledger.move(this.accounts.gravitational, this.accounts.kinetic, this.out[2]!, 'mechanical');
      const wf = Math.max(0, this.out[3]!);
      if (wf > 0) {
        this.ledger.transfer(this.accounts.kinetic, this.accounts.thermal, wf, 'heating');
        s.heat += wf;
      }
      left -= r.h;
      t += r.h;
      if (r.event === 0) {
        s.v = 0;
        s.turns.push({ t, x: s.x, h: tr.y(s.x), side: s.x > this.valleyX ? 'right' : 'left' });
        if (s.turns.length > 40) s.turns.shift();
      } else if (r.event === 1) {
        s.x = tr.xEnd;
        s.v = -s.v;
      } else if (r.event === 2) {
        s.x = tr.xStart;
        s.v = -s.v;
      }
    }
  }

  /** The challenge: friction on and the first right-side turn within the tolerance of the flag height. */
  challenge(): { met: boolean; progress: number } {
    const turn = this.state.turns.find((q) => q.side === 'right');
    const { flag, flagTol } = physicsConfig.ramp;
    return { met: Boolean(this.params.friction) && turn !== undefined && Math.abs(turn.h - flag) <= flagTol, progress: turn ? Math.max(0, 1 - Math.abs(turn.h - flag) / flag) : 0 };
  }
}
