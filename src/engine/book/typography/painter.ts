/**
 * Paints page layouts onto a 2D canvas whose transform is already scaled to millimetres, plus the pieces drawn by
 * hand: lift-the-flap faces, rubber stamps with worn ink, store swatch patterns, ticks, rings and margin notes.
 */
import { rng } from '../noise';
import { CAPS_TRACKING, fontCss, type FontFamilies } from './measure';
import type { LayoutParams, Palette } from './params';
import type { DrawOp, FontSpec, PageLayout } from './types';

type G = CanvasRenderingContext2D;

export interface PaintEnv {
  families: FontFamilies;
  palette: Palette;
  /** Cover plate canvas (drawn as the title-page miniature). */
  plate?: CanvasImageSource | null;
  /** Canvas pixels per millimetre (for offscreen stamp rendering). */
  px: number;
  /** Letter used as the monogram on flap backs and the maker's mark. */
  monogram?: string;
}

export function applyFont(g: G, f: FontSpec, fam: FontFamilies): void {
  g.font = fontCss(f, fam);
  g.fontKerning = 'normal';
  g.fontVariantCaps = f.caps ? 'all-small-caps' : 'normal';
  g.letterSpacing = f.caps ? `${CAPS_TRACKING * f.size}px` : '0px';
}

function text(g: G, env: PaintEnv, t: string, x: number, y: number, f: FontSpec, color: string, align: CanvasTextAlign = 'left', rotate = 0): void {
  applyFont(g, f, env.families);
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = 'alphabetic';
  if (rotate) {
    g.save();
    g.translate(x, y);
    g.rotate(rotate);
    g.fillText(t, 0, 0);
    g.restore();
  } else g.fillText(t, x, y);
}

function roundRectPath(g: G, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  if (r > 0) g.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  else g.rect(x, y, w, h);
}

export function paintOps(g: G, ops: readonly DrawOp[], env: PaintEnv): void {
  g.lineCap = 'butt';
  g.lineJoin = 'miter';
  for (const o of ops) {
    switch (o.op) {
      case 'text':
        text(g, env, o.text, o.x, o.y, o.font, o.color, o.align ?? 'left', o.rotate ?? 0);
        break;
      case 'line':
        g.strokeStyle = o.color;
        g.lineWidth = o.width;
        g.setLineDash(o.dash ? [...o.dash] : []);
        g.beginPath();
        g.moveTo(o.x0, o.y0);
        g.lineTo(o.x1, o.y1);
        g.stroke();
        g.setLineDash([]);
        break;
      case 'rect':
        roundRectPath(g, o.x, o.y, o.w, o.h, o.radius ?? 0);
        if (o.fill) {
          g.fillStyle = o.fill;
          g.fill();
        }
        if (o.stroke) {
          g.strokeStyle = o.stroke;
          g.lineWidth = o.width ?? 0.25;
          g.setLineDash(o.dash ? [...o.dash] : []);
          g.stroke();
          g.setLineDash([]);
        }
        break;
      case 'circle':
        g.beginPath();
        g.arc(o.x, o.y, o.r, 0, Math.PI * 2);
        if (o.fill) {
          g.fillStyle = o.fill;
          g.fill();
        }
        if (o.stroke) {
          g.strokeStyle = o.stroke;
          g.lineWidth = o.width ?? 0.25;
          g.setLineDash(o.dash ? [...o.dash] : []);
          g.stroke();
          g.setLineDash([]);
        }
        break;
      case 'diamond':
        g.fillStyle = o.color;
        g.beginPath();
        g.moveTo(o.x, o.y - o.r);
        g.lineTo(o.x + o.r, o.y);
        g.lineTo(o.x, o.y + o.r);
        g.lineTo(o.x - o.r, o.y);
        g.closePath();
        g.fill();
        break;
      case 'dots':
        g.fillStyle = o.color;
        for (let x = o.x0; x <= o.x1; x += o.step) g.fillRect(x, o.y - o.size / 2, o.size, o.size);
        break;
      case 'swatch':
        paintSwatch(g, o.x, o.y, o.size, o.color, o.pattern, o.radius ?? 0);
        break;
      case 'image':
        if (env.plate) g.drawImage(env.plate, o.x, o.y, o.w, o.h);
        break;
      case 'flap-face':
        g.save();
        g.translate(o.x, o.y);
        if (o.kind === 'lesson') paintLessonFlapFront(g, o.w, o.h, { title: o.title ?? 'Why?', main: o.main ?? '', sub: o.sub ?? '', hand: o.hand ?? '' }, env);
        else paintQuizFlapFront(g, o.w, o.h, o.n ?? 1, o.hand ?? '', env);
        g.restore();
        break;
      case 'stamp':
        paintStamp(g, o.x, o.y, o.r, { n: o.n, press: o.press, label: o.label, rotate: o.rotate, seed: o.seed, lines: o.lines }, env);
        break;
      case 'tick':
        paintTick(g, o.x, o.y, o.scale, o.color, 0.7 * o.scale);
        break;
      case 'mark':
        paintMark(g, o.x, o.y, o.r, o.color, env);
        break;
    }
  }
}

export function paintLayout(g: G, layout: PageLayout, env: PaintEnv): void {
  paintOps(g, layout.ops, env);
}

// ------------------------------------------------------------------------------------------------ swatches

/** Store swatch: a rounded square in the store colour with its hatch pattern inset 1/9 of its size. */
export function paintSwatch(g: G, x: number, y: number, size: number, color: string, pattern: string | undefined, radius: number): void {
  roundRectPath(g, x, y, size, size, radius);
  g.fillStyle = color;
  g.fill();
  if (!pattern || pattern === 'solid') return;
  const s = size / 9;
  const ix = x + s, iy = y + s, w = size - 2 * s;
  g.save();
  g.beginPath();
  g.rect(ix, iy, w, w);
  g.clip();
  g.strokeStyle = g.fillStyle = 'rgba(28,36,51,0.75)';
  g.lineWidth = 0.55 * s;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  switch (pattern) {
    case 'chevrons':
      for (let k = 0; k < 3; k++) {
        const cx = ix + w * (0.22 + k * 0.28);
        g.moveTo(cx - 0.12 * w, iy + 0.18 * w);
        g.lineTo(cx + 0.1 * w, iy + 0.5 * w);
        g.lineTo(cx - 0.12 * w, iy + 0.82 * w);
      }
      break;
    case 'waves':
      for (let k = 0; k < 3; k++) {
        const yy = iy + w * (0.22 + k * 0.28);
        g.moveTo(ix, yy);
        for (let t = 0; t <= 1.001; t += 0.05) g.lineTo(ix + t * w, yy + Math.sin(t * Math.PI * 4) * 0.08 * w);
      }
      break;
    case 'zigzag':
      for (let k = 0; k < 2; k++) {
        const yy = iy + w * (0.3 + k * 0.4);
        g.moveTo(ix, yy + 0.12 * w);
        for (let t = 1; t <= 6; t++) g.lineTo(ix + (t / 6) * w, yy + (t % 2 ? -0.12 : 0.12) * w);
      }
      break;
    case 'dots':
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
        g.moveTo(ix + w * (0.2 + a * 0.3) + 0.09 * w, iy + w * (0.2 + b * 0.3));
        g.arc(ix + w * (0.2 + a * 0.3), iy + w * (0.2 + b * 0.3), 0.09 * w, 0, Math.PI * 2);
      }
      g.fill();
      g.restore();
      return;
    case 'grid':
      for (let k = 1; k < 4; k++) {
        g.moveTo(ix + (k / 4) * w, iy);
        g.lineTo(ix + (k / 4) * w, iy + w);
        g.moveTo(ix, iy + (k / 4) * w);
        g.lineTo(ix + w, iy + (k / 4) * w);
      }
      break;
    case 'rings':
      for (const r of [0.12, 0.28, 0.44]) {
        g.moveTo(ix + w / 2 + r * w, iy + w / 2);
        g.arc(ix + w / 2, iy + w / 2, r * w, 0, Math.PI * 2);
      }
      break;
    case 'diagonal':
      for (let k = -1; k <= 4; k++) {
        g.moveTo(ix + (k / 3) * w, iy + w);
        g.lineTo(ix + (k / 3) * w + w, iy);
      }
      break;
    case 'crosses':
      for (const [a, b] of [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]] as const) {
        g.moveTo(ix + (a - 0.13) * w, iy + b * w);
        g.lineTo(ix + (a + 0.13) * w, iy + b * w);
        g.moveTo(ix + a * w, iy + (b - 0.13) * w);
        g.lineTo(ix + a * w, iy + (b + 0.13) * w);
      }
      break;
  }
  g.stroke();
  g.restore();
}

// ------------------------------------------------------------------------------------------------ flap faces

/** Card speckle: n dots from a fixed LCG seed. */
function speckle(g: G, w: number, h: number, n: number, seed: number, r0: number, r1: number): void {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(140,110,70,0.04)' : 'rgba(255,255,255,0.06)';
    g.beginPath();
    g.arc(r() * w, r() * h, r0 + (r1 - r0) * r(), 0, Math.PI * 2);
    g.fill();
  }
}

export function paintLessonFlapFront(g: G, w: number, h: number, t: { title: string; main: string; sub: string; hand: string }, env: PaintEnv): void {
  const c = env.palette;
  g.fillStyle = c.card;
  g.fillRect(0, 0, w, h);
  speckle(g, w, h, 300, 41, 0.5, 3);
  g.strokeStyle = 'rgba(28,36,51,0.35)';
  g.lineWidth = 0.3;
  g.strokeRect(2.2, 2.2, w - 4.4, h - 4.4);
  const mid = h / 2;
  text(g, env, t.title, 8, mid - 7.5, { size: 4, weight: 600, caps: true }, c.accent);
  text(g, env, t.main, 8, mid + 1.5, { size: 6.2, weight: 500 }, c.ink);
  text(g, env, t.sub, 8, mid + 8, { size: 4.2, italic: true }, c.ink2);
  text(g, env, t.hand, w - 26, mid - 6, { size: 5.2, weight: 560, family: 'hand' }, c.pen);
  g.strokeStyle = c.pen;
  g.lineWidth = 0.5;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(w - 18, mid - 3);
  g.quadraticCurveTo(w - 12, mid + 3, w - 7, mid + 9);
  g.moveTo(w - 7, mid + 9);
  g.lineTo(w - 7.6, mid + 5.6);
  g.moveTo(w - 7, mid + 9);
  g.lineTo(w - 10.2, mid + 8);
  g.stroke();
  g.lineCap = 'butt';
}

export function paintFlapBack(g: G, w: number, h: number, env: PaintEnv): void {
  g.fillStyle = env.palette.cardBack;
  g.fillRect(0, 0, w, h);
  g.save();
  g.beginPath();
  g.rect(3, 3, w - 6, h - 6);
  g.clip();
  g.strokeStyle = 'rgba(154,59,42,0.16)';
  g.lineWidth = 0.18;
  g.beginPath();
  for (let k = -h; k < w + h; k += 2.4) {
    g.moveTo(k, 0);
    g.lineTo(k + h, h);
  }
  g.stroke();
  g.restore();
  g.strokeStyle = 'rgba(154,59,42,0.55)';
  g.lineWidth = 0.35;
  g.strokeRect(3, 3, w - 6, h - 6);
  g.lineWidth = 0.15;
  g.strokeRect(4.2, 4.2, w - 8.4, h - 8.4);
  const r = Math.min(9, 0.36 * Math.min(w, h));
  g.fillStyle = env.palette.cardBack;
  g.beginPath();
  g.arc(w / 2, h / 2, r, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 0.35;
  g.stroke();
  g.lineWidth = 0.15;
  g.beginPath();
  g.arc(w / 2, h / 2, r * 0.89, 0, Math.PI * 2);
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  applyFont(g, { size: r * 0.9, weight: 600 }, env.families);
  g.fillStyle = 'rgba(154,59,42,0.75)';
  g.fillText(env.monogram ?? 'i', w / 2, h / 2 + r * 0.06);
  g.textBaseline = 'alphabetic';
}

export function paintQuizFlapFront(g: G, w: number, h: number, n: number, hand: string, env: PaintEnv): void {
  const c = env.palette;
  g.fillStyle = c.card;
  g.fillRect(0, 0, w, h);
  speckle(g, w, h, Math.round((w * h) / 6), 41 + 7 * n, 0.4, 2.2);
  g.strokeStyle = 'rgba(28,36,51,0.35)';
  g.lineWidth = 0.28;
  g.strokeRect(1.8, 1.8, w - 3.6, h - 3.6);
  const mid = h / 2;
  text(g, env, 'Answer', 5, mid - 3.2, { size: 3, weight: 600, caps: true }, c.accent);
  text(g, env, String(n), w - 5, mid + 3.4, { size: 9, weight: 600 }, c.ink, 'right');
  text(g, env, hand, 5, mid + 2.6, { size: 4.6, weight: 560, family: 'hand' }, c.pen);
  applyFont(g, { size: 4.6, weight: 560, family: 'hand' }, env.families);
  const hw = g.measureText(hand).width;
  g.strokeStyle = c.pen;
  g.lineWidth = 0.4;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(5, mid + 4.2);
  g.quadraticCurveTo(5 + hw / 2, mid + 5.4, 5 + hw, mid + 3.9);
  g.stroke();
  g.lineCap = 'butt';
}

// ------------------------------------------------------------------------------------------------ stamps, ticks, rings

let stampCanvas: HTMLCanvasElement | null = null;

/** Rubber stamp with worn ink, rendered offscreen (so the wear erases only stamp ink) and composited. */
export function paintStamp(
  g: G, cx: number, cy: number, r: number,
  o: { n: number | string; press: number; label: string; rotate: number; seed: number; lines?: readonly { text: string; scale: number; y: number }[]; alpha?: number },
  env: PaintEnv, color?: string,
): void {
  if (o.press <= 0) return;
  const px = env.px;
  const size = Math.ceil(2.4 * r * px);
  stampCanvas ??= document.createElement('canvas');
  const s = stampCanvas;
  if (s.width < size || s.height < size) {
    s.width = Math.max(s.width, size);
    s.height = Math.max(s.height, size);
  }
  const h = s.getContext('2d')!;
  h.setTransform(1, 0, 0, 1, 0, 0);
  h.clearRect(0, 0, size, size);
  h.setTransform(px, 0, 0, px, size / 2, size / 2);
  h.rotate(o.rotate);
  const red = color ?? env.palette.stamp;
  h.strokeStyle = h.fillStyle = red;
  h.lineWidth = 0.09 * r;
  h.beginPath();
  h.arc(0, 0, r, 0, Math.PI * 2);
  h.stroke();
  h.lineWidth = 0.04 * r;
  h.beginPath();
  h.arc(0, 0, 0.8 * r, 0, Math.PI * 2);
  h.stroke();
  h.textAlign = 'center';
  h.textBaseline = 'middle';
  if (o.lines) {
    for (const l of o.lines) {
      applyFont(h, { size: l.scale * r, weight: 700, caps: true }, env.families);
      h.fillText(l.text, 0, l.y * r);
    }
  } else {
    applyFont(h, { size: 0.62 * r, weight: 700 }, env.families);
    h.fillText(String(o.n), 0, -0.05 * r);
    applyFont(h, { size: 0.19 * r, weight: 700, caps: true }, env.families);
    h.fillText(o.label, 0, 0.5 * r);
  }
  // Wear: 70 specks erased at half strength.
  h.globalCompositeOperation = 'destination-out';
  h.fillStyle = 'rgba(0,0,0,0.5)';
  const rand = rng(o.seed);
  for (let i = 0; i < 70; i++) {
    const a = 2 * Math.PI * rand(), d = 1.05 * r * Math.sqrt(rand()), rr = r * (0.015 + 0.04 * rand());
    h.beginPath();
    h.arc(Math.cos(a) * d, Math.sin(a) * d, rr, 0, Math.PI * 2);
    h.fill();
  }
  h.globalCompositeOperation = 'source-over';
  g.save();
  g.globalAlpha *= (o.alpha ?? 0.86) * Math.min(1, o.press);
  g.drawImage(s, 0, 0, size, size, cx - size / px / 2, cy - size / px / 2, size / px, size / px);
  g.restore();
}

/** Hand tick: starts near (i, j) and flicks up to the right past the box. */
export function paintTick(g: G, i: number, j: number, s: number, color: string, width: number): void {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(i + 0.6 * s, j - 2.4 * s);
  g.quadraticCurveTo(i + 1.6 * s, j - 1 * s, i + 2 * s, j - 0.2 * s);
  g.quadraticCurveTo(i + 3.4 * s, j - 4.2 * s, i + 6.2 * s, j - 6.6 * s);
  g.stroke();
  g.lineCap = 'butt';
  g.lineJoin = 'miter';
}

/** Hand-drawn ring round a selected switch option: a loop that overshoots its start. */
export function paintRing(g: G, cx: number, cy: number, rx: number, ry: number, turns: number, width: number, color: string): void {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  for (let k = 0; k <= 40; k++) {
    const a = -0.4 + (k / 40) * turns * Math.PI;
    const x = cx + Math.cos(a) * rx * (1 + 0.04 * Math.sin(k)), y = cy + Math.sin(a) * ry;
    if (k) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.stroke();
  g.lineCap = 'butt';
}

/** Maker's mark for the colophon: a double ring round a leaf and the monogram. */
export function paintMark(g: G, x: number, y: number, r: number, color: string, env: PaintEnv): void {
  g.save();
  g.globalAlpha = 0.85;
  g.strokeStyle = g.fillStyle = color;
  g.lineWidth = 0.35;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 0.15;
  g.beginPath();
  g.arc(x, y, r * 0.86, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 0.3;
  g.beginPath();
  g.moveTo(x - 0.45 * r, y + 0.45 * r);
  g.quadraticCurveTo(x - 0.5 * r, y - 0.45 * r, x + 0.45 * r, y - 0.45 * r);
  g.quadraticCurveTo(x + 0.4 * r, y + 0.4 * r, x - 0.45 * r, y + 0.45 * r);
  g.moveTo(x - 0.45 * r, y + 0.45 * r);
  g.lineTo(x + 0.15 * r, y - 0.15 * r);
  g.stroke();
  g.restore();
}

// ------------------------------------------------------------------------------------------------ ink overlay

export interface InkState {
  /** Chosen prediction option, or null. */
  predict?: number | null;
  /** Handwritten margin lines (live lesson working). */
  margin?: readonly { text: string; size?: number; gap?: number }[];
  /** Lesson stamp: lesson number and press amount 0..1. */
  stamp?: { n: number; press: number } | null;
  /** Current switch values by switch id: the selected option gets a hand ring. */
  switches?: Readonly<Record<string, string>>;
}

/** Paints the transparent 4 px/mm overlay of a lesson page (ticks, margin notes, stamp, switch rings). */
export function paintInkOverlay(g: G, layout: PageLayout, state: InkState, P: LayoutParams, env: PaintEnv): void {
  const k = P.ink, c = P.palette;
  if (state.predict !== undefined && state.predict !== null) {
    const a = layout.anchors[`predict:${state.predict}`];
    if (a) paintTick(g, a.u + 1.5, a.v + a.h - 2, 1, c.pen, k.tickWidth);
  }
  if (state.margin?.length) {
    const m = layout.anchors.margin;
    let y = (layout.anchors.equation?.v ?? k.marginFallbackV) + 4;
    state.margin.forEach((line, i) => {
      const size = line.size ?? k.marginSize;
      text(g, env, line.text, m?.u ?? 12, y, { size, weight: 560, family: 'hand' }, c.pen, 'left', -k.marginTilt * (i % 2 ? 1 : -0.6));
      y += size * k.marginLead + (line.gap ?? 0);
    });
  }
  if (state.stamp && state.stamp.press > 0) {
    const a = layout.anchors.stamp;
    if (a) {
      const r = (a.w / 2) * k.stampScale;
      paintStamp(g, a.u + a.w / 2, a.v + a.h / 2, r, {
        n: state.stamp.n, press: state.stamp.press, label: 'Done', rotate: -0.16 + (state.stamp.n % 3) * 0.07, seed: 7 * 9973 + 31 * state.stamp.n, alpha: k.stampAlpha,
      }, env);
    }
  }
  if (state.switches) {
    for (const reg of layout.regions) {
      if (reg.kind !== 'switch') continue;
      const [, id, value] = reg.action.split(':');
      if (id === undefined || state.switches[id] !== value) continue;
      paintRing(g, reg.u + reg.w / 2, reg.v + reg.h / 2 - 0.4, reg.w / 2 + k.ringPadX, reg.h / 2 + k.ringPadY, k.ringTurns, k.ringWidth, c.pen);
    }
  }
}
