/**
 * A bouncing ball: free fall, impacts with a coefficient of restitution e = sqrt(rebound / drop), peaks in between.
 * Each impact turns 0.5 m (s^2 - (e s)^2) of kinetic energy into heat (and a small share of sound).
 */
import { physicsConfig } from './config';
import { EventStepper, type Derivative, type EventSpec } from './integrator';
import { Simulation, type SimValue } from './simulation';

export interface Ball { id: string; name: string; drop: number; rebound: number; mass: number; diameter: number | null }

/** Measured drop and rebound heights; e = sqrt(rebound / drop). */
export const BALLS: readonly Ball[] = [
  { id: 'tennis', name: 'tennis ball', drop: 2.54, rebound: 1.41, mass: 0.0577, diameter: 0.067 },
  { id: 'basketball', name: 'basketball', drop: 1.8, rebound: 1.06, mass: 0.6, diameter: null },
  { id: 'tableTennis', name: 'table tennis ball', drop: 0.3, rebound: 0.23, mass: 0.0027, diameter: 0.04 },
];

export const restitution = (b: Ball): number => Math.sqrt(b.rebound / b.drop);

export interface BounceState {
  phase: 'held' | 'flying' | 'rest';
  y: number;
  v: number;
  heat: number;
  sound: number;
  impacts: { t: number; speed: number; after: number; loss: number }[];
  peaks: { t: number; h: number }[];
}

export class Bounce extends Simulation<BounceState> {
  readonly accounts: { gravitational: string; kinetic: string; thermal: string; sound: string };
  readonly balls: readonly Ball[];
  private readonly stepper = new EventStepper(3);
  private readonly y = new Float64Array(3);
  private readonly out = new Float64Array(3);
  private readonly f: Derivative;
  private readonly events: EventSpec[] = [
    { g: (y) => y[0]!, dir: -1 },
    { g: (y) => y[1]!, dir: -1 },
  ];

  constructor(opts: { balls?: readonly Ball[]; params?: Record<string, SimValue>; object?: string } = {}) {
    const balls = opts.balls ?? BALLS;
    const d = physicsConfig.bounce;
    super(
      {
        ball: { value: balls[0]!.id, type: 'choice', choices: balls.map((b) => b.id), label: 'Ball' },
        h0: { value: d.h0, min: 0.2, max: 1.2, unit: 'm', label: 'Drop height' },
        soundShare: { value: physicsConfig.constants.soundShare, min: 0, max: 0.2, label: 'Sound share', illustrative: true },
      },
      opts.params,
    );
    this.balls = balls;
    const object = opts.object ?? 'ball';
    this.accounts = {
      gravitational: `gravitational:${object}`,
      kinetic: `kinetic:${object}`,
      thermal: `thermal:${object} and floor`,
      sound: 'thermal:surroundings',
    };
    this.f = (y, o) => {
      const g = physicsConfig.constants.g;
      o[0] = y[1]!;
      o[1] = -g;
      o[2] = -this.mass * g * y[1]!;
    };
    this.reset();
  }

  get ball(): Ball {
    return this.balls.find((b) => b.id === this.params.ball) ?? this.balls[0]!;
  }
  get e(): number {
    return restitution(this.ball);
  }
  get mass(): number {
    return this.ball.mass;
  }

  protected initState(): BounceState {
    return { phase: 'held', y: this.num('h0'), v: 0, heat: 0, sound: 0, impacts: [], peaks: [] };
  }

  energies(): Record<string, number> {
    const s = this.state;
    return {
      [this.accounts.gravitational]: this.mass * physicsConfig.constants.g * s.y,
      [this.accounts.kinetic]: 0.5 * this.mass * s.v * s.v,
      [this.accounts.thermal]: s.heat,
      [this.accounts.sound]: s.sound,
    };
  }

  release(): void {
    if (this.state.phase === 'held') this.state.phase = 'flying';
  }

  /** The hand lifts or lowers the held ball to height h (energy booked as the hand's work). */
  hold(h: number): void {
    const s = this.state;
    const g = physicsConfig.constants.g;
    this.hand(this.accounts.kinetic, -0.5 * this.mass * s.v * s.v);
    this.hand(this.accounts.gravitational, this.mass * g * (h - s.y));
    s.y = h;
    s.v = 0;
    s.phase = 'held';
  }

  /** Peak heights h0 e^(2k), k = 1..n. */
  predictPeaks(h0: number, n: number): number[] {
    const e2 = this.e * this.e;
    return Array.from({ length: n }, (_, k) => h0 * Math.pow(e2, k + 1));
  }

  protected substep(h: number): void {
    const s = this.state;
    if (s.phase !== 'flying') return;
    const y = this.y;
    const g = physicsConfig.constants.g;
    let left = h;
    let t = this.time;
    for (let split = 0; split < physicsConfig.bounce.splits && left > 0; split++) {
      y[0] = s.y;
      y[1] = s.v;
      y[2] = 0;
      const r = this.stepper.step(this.f, y, left, this.events, this.out);
      s.y = this.out[0]!;
      s.v = this.out[1]!;
      this.ledger.move(this.accounts.gravitational, this.accounts.kinetic, this.out[2]!, 'mechanical');
      left -= r.h;
      t += r.h;
      if (r.event === 0) {
        const speed = Math.abs(s.v);
        let after = this.e * speed;
        if ((after * after) / (2 * g) < physicsConfig.bounce.minBounce) after = 0;
        const loss = 0.5 * this.mass * (speed * speed - after * after);
        const sound = this.num('soundShare') * loss;
        this.ledger.transfer(this.accounts.kinetic, this.accounts.sound, sound, 'mechanical');
        this.ledger.transfer(this.accounts.kinetic, this.accounts.thermal, loss - sound, 'heating');
        s.sound += sound;
        s.heat += loss - sound;
        s.y = 0;
        s.v = after;
        this.keep(s.impacts, { t, speed, after, loss });
        if (after === 0) {
          s.phase = 'rest';
          return;
        }
      } else if (r.event === 1) {
        this.keep(s.peaks, { t, h: s.y });
      }
    }
  }

  private keep<T>(list: T[], item: T): void {
    list.push(item);
    while (list.length > physicsConfig.bounce.history) list.shift();
  }

  /** The challenge: second peak within the tolerance of the target height. */
  challenge(): { met: boolean; progress: number } {
    const p = this.state.peaks[1];
    const { target, targetTol } = physicsConfig.bounce;
    return { met: p !== undefined && Math.abs(p.h - target) <= targetTol, progress: Math.min(1, this.state.peaks.length / 2) };
  }
}
