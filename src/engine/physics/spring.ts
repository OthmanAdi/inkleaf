/**
 * A spring launcher: a ball sits on a rail inclined at an angle; pulling back compresses the spring (the hand stores
 * elastic energy), releasing lets the spring push the ball up the rail (elastic to kinetic, some kinetic to
 * gravitational), then the ball flies, peaks and lands (kinetic to thermal and sound).
 */
import { physicsConfig } from './config';
import { EventStepper, type Derivative, type EventSpec } from './integrator';
import { Simulation, type SimValue } from './simulation';

export interface SpringState {
  phase: 'rest' | 'loaded' | 'push' | 'flight' | 'landed';
  /** Position along the rail from the launch point (negative = spring compressed). */
  p: number;
  /** Speed along the rail. */
  v: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  heat: number;
  sound: number;
  overLimit: boolean;
  apex: { x: number; y: number; t: number } | null;
  landing: { x: number; t: number; speed: number } | null;
  tLaunch: number;
}

export class SpringLauncher extends Simulation<SpringState> {
  readonly accounts: { elastic: string; kinetic: string; gravitational: string; thermal: string; sound: string };
  private readonly push = new EventStepper(4);
  private readonly fly = new EventStepper(5);
  private readonly y4 = new Float64Array(4);
  private readonly o4 = new Float64Array(4);
  private readonly y5 = new Float64Array(5);
  private readonly o5 = new Float64Array(5);
  private readonly fPush: Derivative;
  private readonly fFly: Derivative;
  private readonly pushEvents: EventSpec[] = [{ g: (y) => -y[0]!, dir: -1 }];
  private readonly flyEvents: EventSpec[] = [
    { g: (y) => y[3]!, dir: -1 },
    { g: (y) => y[1]! - physicsConfig.spring.floor, dir: -1 },
  ];

  constructor(opts: { params?: Record<string, SimValue>; object?: string } = {}) {
    const d = physicsConfig.spring;
    super(
      {
        k: { value: d.k, min: d.k, max: d.k, unit: 'N/m', label: 'Spring constant' },
        m: { value: d.m, min: d.m, max: d.m, unit: 'kg', label: 'Mass' },
        limit: { value: d.limit, min: d.limit, max: d.limit, unit: 'm', label: 'Largest compression' },
        soundShare: { value: physicsConfig.constants.soundShare, min: 0, max: 0.2, label: 'Sound share', illustrative: true },
      },
      opts.params,
    );
    const object = opts.object ?? 'ball';
    this.accounts = {
      elastic: 'elastic:spring',
      kinetic: `kinetic:${object}`,
      gravitational: `gravitational:${object}`,
      thermal: `thermal:${object} and floor`,
      sound: 'thermal:surroundings',
    };
    this.fPush = (y, o) => {
      const { g } = physicsConfig.constants;
      const sin = this.sin;
      const m = this.num('m');
      const F = -this.num('k') * Math.min(0, y[0]!);
      o[0] = y[1]!;
      o[1] = F / m - g * sin;
      o[2] = F * y[1]!;
      o[3] = -m * g * sin * y[1]!;
    };
    this.fFly = (y, o) => {
      const { g } = physicsConfig.constants;
      o[0] = y[2]!;
      o[1] = y[3]!;
      o[2] = 0;
      o[3] = -g;
      o[4] = -this.num('m') * g * y[3]!;
    };
    this.reset();
  }

  get sin(): number {
    return Math.sin((physicsConfig.spring.angle * Math.PI) / 180);
  }
  get cos(): number {
    return Math.cos((physicsConfig.spring.angle * Math.PI) / 180);
  }

  railPoint(t: number): { x: number; y: number } {
    const { launchX, launchY } = physicsConfig.spring;
    return { x: launchX + t * this.cos, y: launchY + t * this.sin };
  }

  protected initState(): SpringState {
    const r = this.railPoint(0);
    return { phase: 'rest', p: 0, v: 0, x: r.x, y: r.y, vx: 0, vy: 0, heat: 0, sound: 0, overLimit: false, apex: null, landing: null, tLaunch: NaN };
  }

  energies(): Record<string, number> {
    const s = this.state;
    const m = this.num('m');
    const g = physicsConfig.constants.g;
    const onRail = s.phase === 'rest' || s.phase === 'loaded' || s.phase === 'push';
    const c = Math.min(0, s.p);
    return {
      [this.accounts.elastic]: onRail ? 0.5 * this.num('k') * c * c : 0,
      [this.accounts.kinetic]: onRail ? 0.5 * m * s.v * s.v : 0.5 * m * (s.vx * s.vx + s.vy * s.vy),
      [this.accounts.gravitational]: m * g * s.y,
      [this.accounts.thermal]: s.heat,
      [this.accounts.sound]: s.sound,
    };
  }

  /** Pulls the spring back by e metres (clamped to the limit); the hand pays for every joule. */
  pull(e: number): void {
    if (this.state.phase === 'push' || this.state.phase === 'flight' || this.state.phase === 'landed') this.reset();
    const s = this.state;
    const limit = this.num('limit');
    const want = Math.max(0, e);
    const ee = Math.min(limit, want);
    const old = -Math.min(0, s.p);
    const m = this.num('m');
    const k = this.num('k');
    const g = physicsConfig.constants.g;
    const r = this.railPoint(-ee);
    this.hand(this.accounts.kinetic, -0.5 * m * s.v * s.v);
    this.hand(this.accounts.gravitational, m * g * (r.y - s.y));
    this.hand(this.accounts.elastic, 0.5 * k * (ee * ee - old * old));
    s.p = -ee;
    s.v = 0;
    s.x = r.x;
    s.y = r.y;
    s.overLimit = want > limit;
    s.phase = ee > 0 ? 'loaded' : 'rest';
  }

  release(): void {
    const s = this.state;
    if (s.phase === 'loaded' && s.p < 0) s.phase = 'push';
  }

  /** Launch energy, speed, apex and landing time for a pull of e metres, or null when the ball would not launch. */
  predict(e: number): { E: number; v: number; apex: { x: number; y: number }; tLand: number } | null {
    const { g } = physicsConfig.constants;
    const { launchX, launchY, floor } = physicsConfig.spring;
    const m = this.num('m');
    const E = 0.5 * this.num('k') * e * e - m * g * e * this.sin;
    if (E <= 0) return null;
    const v = Math.sqrt((2 * E) / m);
    const vx = v * this.cos;
    const vy = v * this.sin;
    return { E, v, apex: { x: launchX + (vx * vy) / g, y: launchY + (vy * vy) / (2 * g) }, tLand: (vy + Math.sqrt(vy * vy + 2 * g * (launchY - floor))) / g };
  }

  /** The pull that puts the apex at height H (default the bell), or null if beyond the limit. */
  pullForApex(H = physicsConfig.spring.bell): number | null {
    const { g } = physicsConfig.constants;
    const m = this.num('m');
    const k = this.num('k');
    const sin = this.sin;
    const a = 0.5 * k;
    const b = -m * g * sin;
    const c = (-m * g * (H - physicsConfig.spring.launchY)) / (sin * sin);
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const e = (-b + Math.sqrt(disc)) / (2 * a);
    return e > 0 && e <= this.num('limit') ? e : null;
  }

  /** Where the target sits: the apex point for a launch reaching height H. */
  bell(H = physicsConfig.spring.bell): { x: number; y: number } {
    const { launchX, launchY } = physicsConfig.spring;
    return { x: launchX + (2 * (H - launchY)) / Math.tan((physicsConfig.spring.angle * Math.PI) / 180), y: H };
  }

  protected substep(h: number): void {
    const s = this.state;
    if (s.phase === 'push') this.pushStep(h);
    else if (s.phase === 'flight') this.flightStep(h);
  }

  private pushStep(h: number): void {
    const s = this.state;
    const div = Math.max(1, physicsConfig.spring.pushDiv);
    const hh = h / div;
    for (let i = 0; i < div && s.phase === 'push'; i++) {
      const y = this.y4;
      y[0] = s.p;
      y[1] = s.v;
      y[2] = 0;
      y[3] = 0;
      const r = this.push.step(this.fPush, y, hh, this.pushEvents, this.o4);
      s.p = this.o4[0]!;
      s.v = this.o4[1]!;
      const pt = this.railPoint(s.p);
      s.x = pt.x;
      s.y = pt.y;
      this.ledger.move(this.accounts.elastic, this.accounts.kinetic, this.o4[2]!, 'mechanical');
      this.ledger.move(this.accounts.gravitational, this.accounts.kinetic, this.o4[3]!, 'mechanical');
      if (r.event === 0 && s.v > 0) {
        s.vx = s.v * this.cos;
        s.vy = s.v * this.sin;
        s.phase = 'flight';
        s.tLaunch = this.time + hh * i + r.h;
        const rest = h - (hh * i + r.h);
        if (rest > 0) this.flightStep(rest, s.tLaunch);
        return;
      }
    }
  }

  private flightStep(h: number, t0 = this.time): void {
    const s = this.state;
    let left = h;
    for (let split = 0; split < physicsConfig.spring.splits && left > 0 && s.phase === 'flight'; split++) {
      const y = this.y5;
      y[0] = s.x;
      y[1] = s.y;
      y[2] = s.vx;
      y[3] = s.vy;
      y[4] = 0;
      const r = this.fly.step(this.fFly, y, left, this.flyEvents, this.o5);
      s.x = this.o5[0]!;
      s.y = this.o5[1]!;
      s.vx = this.o5[2]!;
      s.vy = this.o5[3]!;
      this.ledger.move(this.accounts.gravitational, this.accounts.kinetic, this.o5[4]!, 'mechanical');
      left -= r.h;
      if (r.event === 0) s.apex = { x: s.x, y: s.y, t: t0 + h - left };
      else if (r.event === 1) {
        const m = this.num('m');
        const speed = Math.hypot(s.vx, s.vy);
        const Ek = 0.5 * m * speed * speed;
        const sound = this.num('soundShare') * Ek;
        this.ledger.transfer(this.accounts.kinetic, this.accounts.sound, sound, 'mechanical');
        this.ledger.transfer(this.accounts.kinetic, this.accounts.thermal, Ek - sound, 'heating');
        s.sound += sound;
        s.heat += Ek - sound;
        s.vx = 0;
        s.vy = 0;
        s.phase = 'landed';
        s.landing = { x: s.x, t: t0 + h - left, speed };
      }
    }
  }

  /** The challenge: the apex within the tolerance of the bell height. */
  challenge(): { met: boolean; progress: number } {
    const a = this.state.apex;
    const { bell, bellTol } = physicsConfig.spring;
    return { met: a !== null && Math.abs(a.y - bell) <= bellTol, progress: a ? Math.max(0, 1 - Math.abs(a.y - bell) / bell) : 0 };
  }
}
