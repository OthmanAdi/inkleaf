/**
 * Pure timing of the pop-up life cycle (print -> peel -> shade -> live -> undraw). The pop model reads these each
 * frame; the tests assert them against the measured traces.
 */
import { S01 } from './noise';

export interface PopTimings {
  /** Peel: the printed page image cross-fades into the flat line copy over this many seconds (1 - S). */
  printFade: number;
  /** Shade: paper surfaces fade in over this many seconds after the last stroke (S). */
  shade: number;
  /** Undraw: surfaces fade out linearly over this many seconds. */
  undrawSurfaces: number;
  /** Undraw: the fold back into the page lasts this long, starting when the surfaces are gone (1 - S). */
  undrawFold: number;
  /** Undraw: fold progress at which the printed image starts returning (it finishes with the fold). */
  printReturnFrom: number;
  /** Pen clock in live (and after jumps): far past every stroke. */
  liveClock: number;
  /** Pen clock while rendering the print. */
  printClock: number;
  /** Surface alpha above which paper writes colour. */
  colorEps: number;
  /** Surface alpha above which surfaces cast shadows. */
  shadowEps: number;
}

export const TIMING_DEFAULTS: PopTimings = {
  printFade: 0.28,
  shade: 0.45,
  undrawSurfaces: 0.15,
  undrawFold: 0.35,
  printReturnFrom: 0.78,
  liveClock: 1e5,
  printClock: 1e6,
  colorEps: 0.001,
  shadowEps: 0.002,
};

const sat = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export interface PeelSample { printAlpha: number; copyAlpha: number }

/** Peel cross-fade at `t` seconds into the peel. */
export function peelAt(t: number, k: PopTimings = TIMING_DEFAULTS): PeelSample {
  const o = Math.min(1, t / k.printFade);
  const printAlpha = 1 - S01(o);
  return { printAlpha, copyAlpha: 1 - printAlpha };
}

/** Surface alpha at `t` seconds into the shade; `done` when the state should become live. */
export function shadeAt(t: number, k: PopTimings = TIMING_DEFAULTS): { surfaces: number; done: boolean } {
  const o = Math.min(1, t / k.shade);
  return { surfaces: S01(o), done: o >= 1 };
}

export interface UndrawSample {
  surfaces: number;
  /** Fold progress r (0..1). */
  r: number;
  /** uLiftAll and uLiftSurf. */
  lift: number;
  printAlpha: number;
  standAlpha: number;
  done: boolean;
}

/** The leave motion at `t` seconds into the undraw. */
export function undrawAt(t: number, k: PopTimings = TIMING_DEFAULTS): UndrawSample {
  const surfaces = 1 - Math.min(1, t / k.undrawSurfaces);
  const r = sat((t - k.undrawSurfaces) / k.undrawFold);
  const lift = 1 - S01(r);
  const i = sat((r - k.printReturnFrom) / (1 - k.printReturnFrom));
  const printAlpha = S01(i);
  return { surfaces, r, lift, printAlpha, standAlpha: 1 - printAlpha, done: r >= 1 };
}

/** Total undraw seconds (0.5 by default). */
export const undrawDuration = (k: PopTimings = TIMING_DEFAULTS) => k.undrawSurfaces + k.undrawFold;
