/**
 * Classical RK4 on small state vectors, with exact event location: a step that crosses an event function (height
 * reaches the floor, vertical speed reaches zero, a ball turns) is shortened to the crossing, found by Illinois
 * regula falsi on the step length. No allocation per step.
 */
import { physicsConfig } from './config';

/** Writes dy/dt for state `y` into `out`. */
export type Derivative = (y: Float64Array, out: Float64Array) => void;

export interface EventSpec {
  /** Event function of the state; the event happens where it crosses zero. */
  g: (y: Float64Array) => number;
  /** Crossing direction: -1 downward (positive to <= 0, the default), +1 upward, 0 either. */
  dir?: number;
}

/** Does g0 -> g1 count as a crossing in direction d? */
export const crosses = (g0: number, g1: number, d: number): boolean => (d <= 0 && g0 > 0 && g1 <= 0) || (d >= 0 && g0 < 0 && g1 >= 0);

export class Rk4 {
  readonly n: number;
  private readonly k1: Float64Array;
  private readonly k2: Float64Array;
  private readonly k3: Float64Array;
  private readonly k4: Float64Array;
  private readonly tmp: Float64Array;

  constructor(n: number) {
    this.n = n;
    this.k1 = new Float64Array(n);
    this.k2 = new Float64Array(n);
    this.k3 = new Float64Array(n);
    this.k4 = new Float64Array(n);
    this.tmp = new Float64Array(n);
  }

  /** One RK4 step of length h from y into out (out may be y). */
  step(f: Derivative, y: Float64Array, h: number, out: Float64Array): Float64Array {
    const { n, k1, k2, k3, k4, tmp } = this;
    f(y, k1);
    for (let i = 0; i < n; i++) tmp[i] = y[i]! + 0.5 * h * k1[i]!;
    f(tmp, k2);
    for (let i = 0; i < n; i++) tmp[i] = y[i]! + 0.5 * h * k2[i]!;
    f(tmp, k3);
    for (let i = 0; i < n; i++) tmp[i] = y[i]! + h * k3[i]!;
    f(tmp, k4);
    for (let i = 0; i < n; i++) out[i] = y[i]! + (h / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!);
    return out;
  }
}

/**
 * Root of an event on the step length (Illinois regula falsi). Bracket [0, h] with g(0) = g0 and g(h) = g1 crossing
 * in direction d. Returns the upper end of the final bracket, so the event has already happened at the result.
 */
export function findEventRoot(evalAt: (c: number) => number, h: number, g0: number, g1: number, d: number, iterations = physicsConfig.integrator.rootIterations, tolerance = physicsConfig.integrator.rootTolerance): number {
  let lo = 0;
  let hi = h;
  let glo = g0;
  let ghi = g1;
  let side = 0;
  const tol = tolerance * Math.max(1, h);
  for (let it = 0; it < iterations && hi - lo > tol; it++) {
    let c = (lo * ghi - hi * glo) / (ghi - glo);
    if (!(c > lo && c < hi)) c = 0.5 * (lo + hi);
    const gc = evalAt(c);
    if (crosses(glo, gc, d)) {
      hi = c;
      ghi = gc;
      if (side === -1) glo *= 0.5;
      side = -1;
    } else {
      lo = c;
      glo = gc;
      if (side === 1) ghi *= 0.5;
      side = 1;
    }
  }
  return hi;
}

export interface EventStepResult {
  /** Length actually stepped (the full h, or the time to the earliest event). */
  h: number;
  /** Index of the event that stopped the step, or -1. */
  event: number;
}

/** RK4 with events for one state size. Holds its scratch buffers. */
export class EventStepper {
  readonly rk: Rk4;
  private readonly full: Float64Array;
  private readonly probe: Float64Array;
  private readonly result: EventStepResult = { h: 0, event: -1 };

  constructor(n: number) {
    this.rk = new Rk4(n);
    this.full = new Float64Array(n);
    this.probe = new Float64Array(n);
  }

  /**
   * Steps y by h into out, stopping at the earliest crossing event. The returned object is reused between calls.
   */
  step(f: Derivative, y: Float64Array, h: number, events: readonly EventSpec[], out: Float64Array): EventStepResult {
    const { rk, full, probe } = this;
    rk.step(f, y, h, full);
    let best = -1;
    let bestH = h;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i]!;
      const d = ev.dir ?? -1;
      const g0 = ev.g(y);
      const g1 = ev.g(full);
      if (!crosses(g0, g1, d)) continue;
      const hE = findEventRoot((c) => ev.g(rk.step(f, y, c, probe)), h, g0, g1, d);
      if (best < 0 || hE < bestH) {
        best = i;
        bestH = hE;
      }
    }
    if (best >= 0) rk.step(f, y, bestH, out);
    else out.set(full);
    this.result.h = best >= 0 ? bestH : h;
    this.result.event = best;
    return this.result;
  }
}

/** Splits a frame: dt capped at maxFrame, n = max(1, ceil(dt / maxSubstep)) equal sub-steps. */
export function splitFrame(dt: number, maxSubstep = physicsConfig.integrator.maxSubstep, maxFrame = physicsConfig.integrator.maxFrame): { n: number; h: number; dt: number } {
  const d = Math.min(dt, maxFrame);
  const n = Math.max(1, Math.ceil(d / maxSubstep - 1e-9));
  return { n, h: d / n, dt: d };
}
