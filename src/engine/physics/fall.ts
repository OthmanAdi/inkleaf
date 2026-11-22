/**
 * A falling object: it rests on a shelf, is nudged off the edge, falls freely and lands. Gravitational energy flows
 * to kinetic while it falls; at the impact the kinetic energy goes to the thermal store of the object and floor,
 * with a small share leaving as sound. `DropSequence` adds the reader-facing staging: a slide toward the edge,
 * slow motion and an end time.
 */
import { physicsConfig } from './config';
import { EventStepper, type Derivative, type EventSpec } from './integrator';
import { Simulation, type SimValue } from './simulation';

export interface FallState {
  phase: 'shelf' | 'falling' | 'landed';
  x: number;
  y: number;
  vx: number;
  vy: number;
  heat: number;
  sound: number;
  /** Kinetic energy the hand gave at the edge (0.5 m u^2). */
  nudge: number;
  /** Simulation time of the drop (NaN before). */
  tDrop: number;
  landing: { t: number; speed: number; Ek: number } | null;
}

export interface FallOptions {
  /** Object name in the account names (default "book"). */
  object?: string;
  /** What warms at the impact (default "book and floor"). */
  floor?: string;
  params?: Record<string, SimValue>;
}

export class Fall extends Simulation<FallState> {
  readonly accounts: { gravitational: string; kinetic: string; thermal: string; sound: string };
  private readonly stepper = new EventStepper(5);
  private readonly y = new Float64Array(5);
  private readonly out = new Float64Array(5);
  private readonly f: Derivative;
  private readonly events: EventSpec[] = [{ g: (y) => y[1]!, dir: -1 }];

  constructor(opts: FallOptions = {}) {
    const d = physicsConfig.fall;
    super(
      {
        m: { value: d.m, min: 0.2, max: 3, unit: 'kg', label: 'Mass' },
        h: { value: d.h, min: 0.3, max: 2, unit: 'm', label: 'Height' },
        u: { value: d.u, min: 0, max: 1, unit: 'm/s', label: 'Speed off the edge' },
        soundShare: { value: physicsConfig.constants.soundShare, min: 0, max: 0.2, label: 'Sound share', illustrative: true },
      },
      opts.params,
    );
    const object = opts.object ?? 'book';
    this.accounts = {
      gravitational: `gravitational:${object}`,
      kinetic: `kinetic:${object}`,
      thermal: `thermal:${opts.floor ?? `${object} and floor`}`,
      sound: 'thermal:surroundings',
    };
    this.f = (y, o) => {
      const g = physicsConfig.constants.g;
      o[0] = y[2]!;
      o[1] = y[3]!;
      o[2] = 0;
      o[3] = -g;
      o[4] = -this.num('m') * g * y[3]!;
    };
    this.reset();
  }

  protected initState(): FallState {
    return { phase: 'shelf', x: 0, y: this.num('h'), vx: 0, vy: 0, heat: 0, sound: 0, nudge: 0, tDrop: NaN, landing: null };
  }

  energies(): Record<string, number> {
    const s = this.state;
    const m = this.num('m');
    return {
      [this.accounts.gravitational]: m * physicsConfig.constants.g * s.y,
      [this.accounts.kinetic]: 0.5 * m * (s.vx * s.vx + s.vy * s.vy),
      [this.accounts.thermal]: s.heat,
      [this.accounts.sound]: s.sound,
    };
  }

  /** Pushes the object off the edge (only from the shelf). */
  drop(): void {
    const s = this.state;
    if (s.phase !== 'shelf') return;
    s.phase = 'falling';
    s.vx = this.num('u');
    s.tDrop = this.time;
    s.nudge = 0.5 * this.num('m') * s.vx * s.vx;
    this.hand(this.accounts.kinetic, s.nudge);
  }

  /** Predicted fall time sqrt(2h/g), impact speed and impact kinetic energy. */
  predict(): { t: number; speed: number; Ek: number } {
    const g = physicsConfig.constants.g;
    const h = this.num('h');
    const u = this.num('u');
    const m = this.num('m');
    return { t: Math.sqrt((2 * h) / g), speed: Math.sqrt(2 * g * h + u * u), Ek: m * g * h + 0.5 * m * u * u };
  }

  protected substep(h: number): void {
    const s = this.state;
    if (s.phase !== 'falling') return;
    const y = this.y;
    let left = h;
    let t = this.time;
    for (let split = 0; split < physicsConfig.fall.splits && left > 0; split++) {
      y[0] = s.x;
      y[1] = s.y;
      y[2] = s.vx;
      y[3] = s.vy;
      y[4] = 0;
      const r = this.stepper.step(this.f, y, left, this.events, this.out);
      s.x = this.out[0]!;
      s.y = this.out[1]!;
      s.vx = this.out[2]!;
      s.vy = this.out[3]!;
      this.ledger.move(this.accounts.gravitational, this.accounts.kinetic, this.out[4]!, 'mechanical');
      left -= r.h;
      t += r.h;
      if (r.event === 0) {
        this.land(t);
        return;
      }
    }
  }

  private land(t: number): void {
    const s = this.state;
    const m = this.num('m');
    const speed = Math.hypot(s.vx, s.vy);
    const Ek = 0.5 * m * speed * speed;
    const sound = this.num('soundShare') * Ek;
    this.ledger.transfer(this.accounts.kinetic, this.accounts.sound, sound, 'mechanical');
    this.ledger.transfer(this.accounts.kinetic, this.accounts.thermal, Ek - sound, 'heating');
    s.sound += sound;
    s.heat += Ek - sound;
    s.y = 0;
    s.vx = 0;
    s.vy = 0;
    s.phase = 'landed';
    s.landing = { t: t - s.tDrop, speed, Ek };
  }

  /** The challenge: landed and all the starting energy found in the thermal store (within 0.1 %). */
  challenge(): { met: boolean; progress: number } {
    const target = this.num('m') * physicsConfig.constants.g * this.num('h') + this.state.nudge;
    const got = this.state.heat;
    return { met: this.state.phase === 'landed' && Math.abs(got - target) <= 0.001 * target, progress: target > 0 ? Math.min(1, got / target) : 0 };
  }
}

export interface Vec3Like { x: number; y: number; z: number }

/**
 * Staging of a drop for readers: slide toward the edge, then the fall in slow motion, then an end. Positions are in
 * the figure's millimetres: `rest` is the object on its shelf, `floorY` the floor height, and the fall is mapped
 * with Z = (rest.y - floorY) / h millimetres per metre.
 */
export class DropSequence {
  readonly fall: Fall;
  mode: 'idle' | 'event' | 'after' = 'idle';
  eventT = 0;
  rest: Vec3Like;
  floorY: number;
  /** Unit direction of the slide and the horizontal fall motion (default toward the reader, +z). */
  dir: Vec3Like;
  onDrop?: () => void;
  onLand?: () => void;
  private landedFired = false;

  constructor(fall: Fall, opts: { rest: Vec3Like; floorY?: number; dir?: Vec3Like }) {
    this.fall = fall;
    this.rest = { ...opts.rest };
    this.floorY = opts.floorY ?? 0;
    this.dir = { ...(opts.dir ?? { x: 0, y: 0, z: 1 }) };
  }

  start(): void {
    this.fall.reset();
    this.mode = 'event';
    this.eventT = 0;
    this.landedFired = false;
  }

  stop(): void {
    this.fall.reset();
    this.mode = 'idle';
    this.eventT = 0;
    this.landedFired = false;
  }

  get busy(): boolean {
    return this.mode === 'event';
  }

  update(dt: number): void {
    if (this.mode === 'idle') return;
    const c = physicsConfig.fall;
    this.eventT += dt;
    if (this.eventT > c.slideTime) {
      if (this.fall.state.phase === 'shelf') {
        this.fall.drop();
        this.onDrop?.();
      }
      this.fall.step(dt / c.slow);
      if (this.fall.state.phase === 'landed' && !this.landedFired) {
        this.landedFired = true;
        this.onLand?.();
      }
    }
    if (this.mode === 'event' && this.fall.state.phase === 'landed' && this.eventT > c.afterTime) this.mode = 'after';
  }

  /** Where the object is now, in figure millimetres. */
  position<T extends Vec3Like>(out: T): T {
    const c = physicsConfig.fall;
    const s = this.fall.state;
    if (this.mode === 'idle' || s.phase === 'shelf') {
      const k = this.mode === 'idle' ? 0 : c.slide * Math.min(1, this.eventT / Math.max(1e-9, c.slideTime));
      out.x = this.rest.x + this.dir.x * k;
      out.y = this.rest.y;
      out.z = this.rest.z + this.dir.z * k;
      return out;
    }
    const Z = (this.rest.y - this.floorY) / this.fall.num('h');
    const along = c.slide + s.x * Z;
    out.x = this.rest.x + this.dir.x * along;
    out.y = this.floorY + Math.max(0, s.y * Z);
    out.z = this.rest.z + this.dir.z * along;
    return out;
  }
}
