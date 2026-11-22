/**
 * Book dimensions and stack constants (millimetres, radians). The text block is a continuous stack with coordinate
 * sigma in [0, T]: 0 at the back board, T under the front cover. Unit 0 is the front block (F thick, it turns with
 * the cover), units 1..N-1 are turnable leaves of `leaf` mm, unit N is the back block (B thick).
 */
import type { Table } from './params';

export const DIMS_TABLE = {
  W: [190, 60, 400, 'mm', 'Page width from the spine edge to the fore-edge'],
  D: [250, 80, 500, 'mm', 'Page height from head to tail (along z)'],
  leaf: [0.55, 0.05, 4, 'mm', 'Thickness of one turnable leaf'],
  back: [6, 0, 40, 'mm', 'Back block thickness (everything under the last turnable leaf)'],
  front: [6, 0, 40, 'mm', 'Front block thickness (front matter that turns with the cover)'],
  board: [3, 0.5, 10, 'mm', 'Cover board thickness'],
  over: [4, 0, 20, 'mm', 'Board overhang past the pages at head, tail and fore-edge'],
  joint: [4, 0, 20, 'mm', 'Gap from the page root line to the board edge (the hinge joint)'],
  cx: [9.45, 1, 40, 'mm', 'Half spine width: the hinges sit at x = +-cx on the back board top'],
} as const satisfies Table;

export const STACK_TABLE = {
  bulge: [1.6, 0, 10, 'mm', 'Closed-book spine rounding: mid-stack leaves stick out this far toward -x'],
  hollow: [1.2, 0, 10, 'mm', 'Hollow-back gap between page roots and spine cloth (scaled 0.35..1 by openness)'],
  spine: [1.3, 0.1, 6, 'mm', 'Spine cloth thickness and base offset from the page roots'],
  curl: [0.3, 0, 1.5, 'rad', 'Curl of a turning leaf at its free edge'],
  curlZ: [0.5, 0, 1, '', 'Curl variation along the page height (1 +- this): the near corner leads'],
  dipN: [2.5, 1, 8, '', 'Exponent of the root-to-flat bend profile as a page climbs out of the gutter'],
  droop: [0.002, 0, 0.02, 'rad/mm', 'Fore-edge droop slope per mm of stack height'],
} as const satisfies Table;

/** Number of arc-length intervals across a page (61 samples). */
export const NS = 60;

export interface Dims {
  W: number; D: number; N: number; L: number; B: number; F: number; T: number;
  BOARD: number; OVER: number; JOINT: number; CX: number;
  BULGE: number; HOLLOW: number; SPINE: number; CURL: number; CURL_Z: number; DIP_N: number; DROOP: number;
  /** y of the bottom of the text block (top of the back board). */
  Yb: number;
  /** Board width and height. */
  BW: number; BD: number;
  /** Arc-length samples across the page, denser at the spine. */
  S: Float64Array;
}

export interface DimsInput {
  N: number;
  W?: number; D?: number; leaf?: number; back?: number; front?: number; board?: number; over?: number; joint?: number; cx?: number;
  bulge?: number; hollow?: number; spine?: number; curl?: number; curlZ?: number; dipN?: number; droop?: number;
}

export function arcSamples(W: number, out = new Float64Array(NS + 1)): Float64Array {
  for (let l = 0; l <= NS; l++) {
    const d = l / NS;
    out[l] = W * (0.3 * d + 0.7 * d * d);
  }
  return out;
}

export function makeDims(p: DimsInput): Dims {
  const v = (k: keyof typeof DIMS_TABLE) => (p[k] ?? DIMS_TABLE[k][0]) as number;
  const s = (k: keyof typeof STACK_TABLE) => (p[k] ?? STACK_TABLE[k][0]) as number;
  const N = Math.max(2, Math.round(p.N));
  const W = v('W'), D = v('D'), L = v('leaf'), B = v('back'), F = v('front');
  const T = B + (N - 1) * L + F;
  const OVER = v('over'), JOINT = v('joint');
  return {
    W, D, N, L, B, F, T,
    BOARD: v('board'), OVER, JOINT, CX: v('cx'),
    BULGE: s('bulge'), HOLLOW: s('hollow'), SPINE: s('spine'), CURL: s('curl'), CURL_Z: s('curlZ'), DIP_N: s('dipN'), DROOP: s('droop'),
    Yb: -T / 2,
    BW: W + OVER - JOINT,
    BD: D + 2 * OVER,
    S: arcSamples(W),
  };
}
