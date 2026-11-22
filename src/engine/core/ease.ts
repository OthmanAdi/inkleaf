/**
 * Easing and damping. Every animation in inkleaf names its easing from this table, so a world can swap
 * `inOutCubic` for `outBack` by name. All functions map t in [0, 1] to [0, 1] (overshooting ones may leave it).
 */
export type Ease = (t: number) => number;

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

export const EASES = {
  linear: (t: number) => t,
  smoothstep: (t: number) => t * t * (3 - 2 * t),
  smootherstep: (t: number) => t * t * t * (t * (t * 6 - 15) + 10),
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inQuart: (t: number) => t * t * t * t,
  outQuart: (t: number) => 1 - Math.pow(1 - t, 4),
  inOutQuart: (t: number) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
  outQuint: (t: number) => 1 - Math.pow(1 - t, 5),
  inOutQuint: (t: number) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
  inSine: (t: number) => 1 - Math.cos((t * Math.PI) / 2),
  outSine: (t: number) => Math.sin((t * Math.PI) / 2),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  inExpo: (t: number) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outExpo: (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutExpo: (t: number) => (t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
  outCirc: (t: number) => Math.sqrt(1 - Math.pow(t - 1, 2)),
  outBack: (t: number) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
  inOutBack: (t: number) => {
    const c2 = 1.70158 * 1.525;
    return t < 0.5 ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2 : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
  },
  outElastic: (t: number) => (t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
} satisfies Record<string, Ease>;

export type EaseName = keyof typeof EASES;
export const EASE_NAMES = Object.keys(EASES) as EaseName[];

export function ease(name: string, t: number): number {
  const f = (EASES as Record<string, Ease>)[name] ?? EASES.linear;
  return f(clamp01(t));
}

/** A cubic Bezier easing like CSS `cubic-bezier(x1, y1, x2, y2)`, solved by Newton steps then bisection. */
export function bezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    x = clamp01(x);
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-6) return sy(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

/** Frame-rate independent exponential approach: the factor to move toward a target this frame. */
export const dampFactor = (dt: number, tau: number) => (tau <= 0 ? 1 : 1 - Math.exp(-dt / tau));

/** Moves `current` toward `target` with time constant `tau` seconds. */
export const damp = (current: number, target: number, dt: number, tau: number) => current + (target - current) * dampFactor(dt, tau);

/** The `1 - base^dt` form: after one second the remaining gap is `base` of what it was. */
export const dampPow = (current: number, target: number, dt: number, base: number) => current + (target - current) * (1 - Math.pow(base, dt));

export interface Spring { x: number; v: number }

/**
 * A damped spring toward `target`. `omega` is the natural angular frequency (rad/s), `zeta` the damping ratio
 * (1 = critically damped). Integrated in small fixed steps so it stays stable for large dt.
 */
export function stepSpring(s: Spring, target: number, dt: number, omega: number, zeta = 1): Spring {
  const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const a = -2 * zeta * omega * s.v - omega * omega * (s.x - target);
    s.v += a * h;
    s.x += s.v * h;
  }
  return s;
}

/** Maps t from [a, b] to [0, 1] and clamps: the usual "progress within a window" for staggered timelines. */
export const window01 = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export { clamp01 };
