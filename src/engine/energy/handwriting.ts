/**
 * Handwritten numerals and a few letters as ink strokes (for values written into a figure, like "0.24 J"), and the
 * ink arrow. Glyphs are in em units, x right, y up; arcs are ellipse samples with angles in degrees.
 */
import { Vector3 } from 'three';
import type { LineOptions, LineSet } from '../contracts';

type P = [number, number];
interface Glyph { w: number; strokes: P[][] }

const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n: number): P[] => {
  const out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
};

export const GLYPHS: Readonly<Record<string, Glyph>> = {
  '0': { w: 0.5, strokes: [arc(0.25, 0.5, 0.25, 0.5, 100, 470, 26)] },
  '1': { w: 0.3, strokes: [[[0.02, 0.78], [0.24, 1], [0.2, 0]]] },
  '2': { w: 0.52, strokes: [[...arc(0.26, 0.72, 0.24, 0.27, 165, -20, 12), [0.03, 0.02], [0.54, 0.03]]] },
  '3': { w: 0.5, strokes: [[...arc(0.24, 0.76, 0.22, 0.24, 150, -90, 12), ...arc(0.24, 0.27, 0.26, 0.27, 90, -150, 14)]] },
  '4': { w: 0.54, strokes: [[[0.4, 0], [0.42, 1], [0, 0.3], [0.56, 0.3]]] },
  '5': { w: 0.5, strokes: [[[0.5, 1], [0.1, 0.99], [0.05, 0.56], ...arc(0.25, 0.32, 0.26, 0.32, 125, -145, 14)]] },
  '6': { w: 0.5, strokes: [[[0.46, 0.96], [0.26, 0.86], [0.09, 0.6], [0.02, 0.3], ...arc(0.26, 0.27, 0.24, 0.27, 190, 540, 20)]] },
  '7': { w: 0.5, strokes: [[[0, 0.98], [0.52, 1], [0.16, 0]]] },
  '8': { w: 0.5, strokes: [[...arc(0.25, 0.76, 0.2, 0.24, -90, 270, 18), ...arc(0.25, 0.26, 0.25, 0.26, 90, 450, 18)]] },
  '9': { w: 0.5, strokes: [[...arc(0.25, 0.7, 0.24, 0.28, 0, 375, 20), [0.47, 0.6], [0.36, 0]]] },
  '.': { w: 0.16, strokes: [[[0.04, 0.02], [0.08, 0.07]]] },
  '-': { w: 0.36, strokes: [[[0.03, 0.45], [0.32, 0.46]]] },
  ' ': { w: 0.28, strokes: [] },
  m: {
    w: 0.62,
    strokes: [
      [[0, 0.55], [0, 0]],
      [[0, 0.36], ...arc(0.14, 0.38, 0.14, 0.17, 170, 0, 6), [0.28, 0]],
      [[0.28, 0.36], ...arc(0.43, 0.38, 0.15, 0.17, 170, 0, 6), [0.58, 0]],
    ],
  },
  c: { w: 0.42, strokes: [arc(0.22, 0.27, 0.21, 0.27, 50, 300, 14)] },
  l: { w: 0.18, strokes: [[[0.06, 1], [0.04, 0.12], [0.12, 0]]] },
  i: { w: 0.18, strokes: [[[0.06, 0.55], [0.05, 0]], [[0.06, 0.8], [0.08, 0.84]]] },
  t: { w: 0.36, strokes: [[[0.12, 0.9], [0.1, 0.1], [0.2, 0], [0.3, 0.04]], [[0, 0.56], [0.3, 0.57]]] },
  J: { w: 0.42, strokes: [[[0.4, 1], [0.38, 0.22], ...arc(0.2, 0.22, 0.18, 0.22, 0, -170, 8)]] },
};

export const GLYPH_SPACING = 0.13;
export const GLYPH_SLANT = 0.16;

/** Width of a text in em times size (unknown glyphs count as spaces). */
export function handTextWidth(text: string, size = 1): number {
  let w = 0;
  for (const ch of text) w += ((GLYPHS[ch] ?? GLYPHS[' ']!).w + GLYPH_SPACING) * size;
  return text.length ? w - GLYPH_SPACING * size : 0;
}

export interface HandTextOptions {
  origin?: Vector3;
  right?: Vector3;
  up?: Vector3;
  /** Glyph height in mm. */
  size?: number;
  /** 0 left, 0.5 centred, 1 right aligned. */
  align?: number;
  slant?: number;
}

/** A text as ink polylines in 3D. */
export function handText(text: string, opts: HandTextOptions = {}): Vector3[][] {
  const size = opts.size ?? 5;
  const origin = opts.origin ?? new Vector3();
  const right = opts.right ?? new Vector3(1, 0, 0);
  const up = opts.up ?? new Vector3(0, 1, 0);
  const slant = opts.slant ?? GLYPH_SLANT;
  let x = -(opts.align ?? 0) * handTextWidth(text, size) / size;
  const out: Vector3[][] = [];
  for (const ch of text) {
    const g = GLYPHS[ch] ?? GLYPHS[' ']!;
    for (const s of g.strokes)
      out.push(s.map(([gx, gy]) => origin.clone().addScaledVector(right, (x + gx + slant * gy) * size).addScaledVector(up, gy * size)));
    x += g.w + GLYPH_SPACING;
  }
  return out;
}

/** Adds a handwritten text to a line set (stroke k gets seed 900 + k). */
export function addHandText(set: LineSet, text: string, opts: HandTextOptions = {}, line: LineOptions = {}): void {
  handText(text, opts).forEach((pts, k) => set.add(pts, { width: 0.75, seed: 900 + k, taper: true, t0: 0, dur: 0.01, ...line }));
}

/** An ink arrow: the shaft and a two-sided head of length `head` (half-width 0.55 head), in the plane with `normal`. */
export function inkArrow(from: Vector3, to: Vector3, head: number, normal = new Vector3(0, 0, 1)): Vector3[][] {
  const dir = to.clone().sub(from).normalize();
  const perp = normal.clone().cross(dir).normalize();
  const back = to.clone().addScaledVector(dir, -head);
  return [
    [from.clone(), to.clone()],
    [back.clone().addScaledVector(perp, 0.55 * head), to.clone(), back.clone().addScaledVector(perp, -0.55 * head)],
  ];
}
