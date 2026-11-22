/**
 * The page ink layers of a lesson spread, drawn in page millimetres on transparent canvases: the prediction tick, the
 * handwritten margin numbers, the challenge stamp (left page) and the loops around chosen switch options (right page).
 * Geometry helpers are pure so their numbers can be tested.
 */
import type { MarginLine } from './types';
import type { PageRect } from './deps';
import type { RuntimeTunables } from './tunables';

type InkT = RuntimeTunables['ink'];
type RingT = RuntimeTunables['ring'];
type StampT = RuntimeTunables['stamp'];

/** 32-bit LCG: x = x * 1664525 + 1013904223 mod 2^32, returning x / 2^32. */
export function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

/** The tick in a prediction box: start point, then two quadratic segments (control, end), page mm. */
export function tickPath(box: PageRect): [number, number, number, number, number, number, number, number, number, number] {
  const i = box.u0 + 1.5, j = box.v1 - 2;
  return [i + 0.6, j - 2.4, i + 1.6, j - 1, i + 2, j - 0.2, i + 3.4, j - 4.2, i + 6.2, j - 6.6];
}

export interface MarginPlacement {
  text: string;
  /** Baseline v in page mm. */
  v: number;
  size: number;
  rotation: number;
}

/** Baselines and tilts of the margin lines: each advances `size * lead + gap`; odd lines tilt `tiltOdd`, even `tiltOdd * tiltEven`. */
export function marginPlacements(lines: readonly MarginLine[], startV: number, t: Pick<InkT, 'marginSize' | 'marginLead' | 'tiltOdd' | 'tiltEven'>): MarginPlacement[] {
  const out: MarginPlacement[] = [];
  let v = startV;
  lines.forEach((l, i) => {
    const size = l.size ?? t.marginSize;
    out.push({ text: l.text, v, size, rotation: t.tiltOdd * (i % 2 === 1 ? 1 : t.tiltEven) });
    v += size * t.marginLead + (l.gap ?? 0);
  });
  return out;
}

/** Points (u, v pairs) of the hand loop around a switch option box. */
export function switchRingPoints(box: PageRect, t: Pick<RingT, 'padU' | 'padV' | 'raise' | 'points' | 'start' | 'turns' | 'wobble'>, out: number[] = []): number[] {
  out.length = 0;
  const cx = (box.u0 + box.u1) / 2, cy = (box.v0 + box.v1) / 2 - t.raise;
  const rx = (box.u1 - box.u0) / 2 + t.padU, ry = (box.v1 - box.v0) / 2 + t.padV;
  const n = Math.max(2, Math.round(t.points));
  for (let k = 0; k < n; k++) {
    const a = t.start + (k / (n - 1)) * t.turns * Math.PI;
    out.push(cx + rx * (1 + t.wobble * Math.sin(k)) * Math.cos(a), cy + ry * Math.sin(a));
  }
  return out;
}

export const stampRotation = (n: number, t: Pick<StampT, 'rotation' | 'rotationStep'>) => t.rotation + (((n % 3) + 3) % 3) * t.rotationStep;

export const stampSeed = (n: number) => 7 * 9973 + 31 * n;

/** Worn specks of a stamp of radius a: centre offsets and radii, from the lesson's seeded LCG. */
export function stampHoles(n: number, a: number, count: number): { x: number; y: number; r: number }[] {
  const rnd = lcg(stampSeed(n));
  const out: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < count; i++) {
    const ang = 2 * Math.PI * rnd();
    const d = 1.05 * a * Math.sqrt(rnd());
    out.push({ x: Math.cos(ang) * d, y: Math.sin(ang) * d, r: a * (0.015 + 0.04 * rnd()) });
  }
  return out;
}

export interface Fonts {
  serif: string;
  hand: string;
}

export const DEFAULT_FONTS: Fonts = {
  serif: '"Source Serif 4 Variable", "Source Serif 4", Georgia, serif',
  hand: '"Caveat Variable", "Caveat", cursive',
};

/** Draws the rubber stamp centred at (cu, cv) with radius a; `press` 0..1 fades it in. */
export function paintStamp(ctx: CanvasRenderingContext2D, cu: number, cv: number, a: number, n: number, press: number, t: StampT, fonts: Fonts): void {
  if (press <= 0) return;
  ctx.save();
  ctx.translate(cu, cv);
  ctx.rotate(stampRotation(n, t));
  ctx.globalAlpha = t.alpha * Math.min(1, press);
  ctx.strokeStyle = t.color;
  ctx.fillStyle = t.color;
  ctx.lineWidth = t.outerWidth * a;
  ctx.beginPath();
  ctx.arc(0, 0, a, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = t.innerWidth * a;
  ctx.beginPath();
  ctx.arc(0, 0, t.innerRadius * a, 0, Math.PI * 2);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${t.numberSize * a}px ${fonts.serif}`;
  ctx.fillText(String(n), 0, -0.05 * a);
  ctx.font = `700 ${t.wordSize * a}px ${fonts.serif}`;
  ctx.fillText(t.word, 0, 0.5 * a);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.globalAlpha = t.holeAlpha;
  for (const h of stampHoles(n, a, Math.round(t.holes))) {
    ctx.beginPath();
    ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export interface LeftInk {
  /** Box of the ticked prediction option, or null. */
  predict: PageRect | null;
  /** Top of the equation box (page mm), when the page reports one. */
  equationTop: number | null;
  lines: readonly MarginLine[];
  n: number;
  press: number;
}

function begin(ctx: CanvasRenderingContext2D, pxPerMm: number, color: string): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(pxPerMm, 0, 0, pxPerMm, 0, 0);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

export function paintLeftInk(ctx: CanvasRenderingContext2D, pxPerMm: number, s: LeftInk, t: { ink: InkT; stamp: StampT }, fonts: Fonts): void {
  begin(ctx, pxPerMm, t.ink.color);
  if (s.predict) {
    const k = tickPath(s.predict);
    ctx.lineWidth = t.ink.tickWidth;
    ctx.beginPath();
    ctx.moveTo(k[0], k[1]);
    ctx.quadraticCurveTo(k[2], k[3], k[4], k[5]);
    ctx.quadraticCurveTo(k[6], k[7], k[8], k[9]);
    ctx.stroke();
  }
  if (s.lines.length) {
    const start = (s.equationTop ?? t.ink.marginFallbackV) + t.ink.marginStart;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    for (const m of marginPlacements(s.lines, start, t.ink)) {
      ctx.save();
      ctx.translate(t.ink.marginU, m.v);
      ctx.rotate(m.rotation);
      ctx.font = `${Math.round(t.ink.marginWeight)} ${m.size}px ${fonts.hand}`;
      ctx.fillText(m.text, 0, 0);
      ctx.restore();
    }
  }
  if (s.press > 0) paintStamp(ctx, t.stamp.cu, t.stamp.cv, t.stamp.r * t.stamp.radiusScale, s.n, s.press, t.stamp, fonts);
}

const ringPts: number[] = [];

export function paintRightInk(ctx: CanvasRenderingContext2D, pxPerMm: number, chosen: readonly PageRect[], t: { ink: InkT; ring: RingT }): void {
  begin(ctx, pxPerMm, t.ink.color);
  ctx.lineWidth = t.ring.width;
  for (const box of chosen) {
    switchRingPoints(box, t.ring, ringPts);
    ctx.beginPath();
    ctx.moveTo(ringPts[0]!, ringPts[1]!);
    for (let i = 2; i < ringPts.length; i += 2) ctx.lineTo(ringPts[i]!, ringPts[i + 1]!);
    ctx.stroke();
  }
}
