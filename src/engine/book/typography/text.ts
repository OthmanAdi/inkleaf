/** Line breaking, rich text runs and the equation typesetter, all in page millimetres. */
import type { Measurer } from './measure';
import type { DrawOp, FontSpec } from './types';

/** Non-breaking space between a number and a following unit. */
export function tidy(s: string): string {
  return s.replace(/(\d)[ ]+(?=(?:k|M|m|c|G)?(?:J|W|N|m|g|s|h|K|V|A|Hz|Pa|L|Wh)\b|°|%)/g, '$1\u00a0');
}

const SPLIT = /[ \t\n]+/;

/** Greedy word wrap on ordinary spaces (non-breaking spaces hold words together). */
export function wrap(text: string, maxW: number, font: FontSpec, m: Measurer): string[] {
  const words = tidy(text).split(SPLIT).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (line && m.width(t, font) > maxW) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/** Wraps and emits text ops; returns the y after the last line (y + lines x lead). */
export function wrapDraw(
  ops: DrawOp[], text: string, x: number, y: number, maxW: number, lead: number, font: FontSpec, color: string, m: Measurer,
  align: 'left' | 'center' | 'right' = 'left', maxLines = Infinity,
): number {
  const lines = wrap(text, maxW, font, m).slice(0, maxLines);
  lines.forEach((t, i) => ops.push({ op: 'text', x, y: y + i * lead, text: t, font, color, align }));
  return y + lines.length * lead;
}

// ------------------------------------------------------------------------------------------------ rich text

export interface Run {
  t: string;
  font: FontSpec;
  color: string;
  /** Hit id: boxes per line are reported for runs carrying an id. */
  id?: string;
  /** Stick to the previous word (no break before). */
  nb?: boolean;
  /** Line break before this run. */
  br?: boolean;
  swatch?: { color: string; pattern?: string };
}

export interface RichLine { items: { x: number; text: string; font: FontSpec; color: string; swatch?: Run['swatch'] }[]; width: number }
export interface RichLayout { lines: RichLine[]; boxes: { id: string; line: number; x0: number; x1: number; size: number }[] }

interface Token { text: string; run: Run; space: boolean; w: number; glue: boolean }

/** Greedy layout of runs into lines of maxW with an optional hanging indent for lines after the first. */
export function layoutRich(runs: readonly Run[], maxW: number, m: Measurer, indent = 0): RichLayout {
  const tokens: (Token | 'br')[] = [];
  for (const run of runs) {
    if (run.br) tokens.push('br');
    if (run.swatch) {
      tokens.push({ text: '', run, space: false, w: run.font.size * 0.92, glue: !!run.nb });
      continue;
    }
    const parts = tidy(run.t).split(/( +)/);
    let first = true;
    for (const p of parts) {
      if (!p) continue;
      const space = /^ +$/.test(p);
      tokens.push({ text: space ? ' ' : p, run, space, w: m.width(space ? ' ' : p, run.font), glue: first && !!run.nb && !space });
      first = false;
    }
  }
  const lines: RichLine[] = [];
  const boxes: RichLayout['boxes'] = [];
  let cur: RichLine = { items: [], width: 0 };
  let x = 0;
  const limit = () => (lines.length ? maxW - indent : maxW);
  const start = () => (lines.length ? indent : 0);
  const push = () => {
    // Drop trailing spaces.
    while (cur.items.length && cur.items[cur.items.length - 1]!.text === ' ') {
      const it = cur.items.pop()!;
      x = it.x - start();
    }
    cur.width = x;
    lines.push(cur);
    cur = { items: [], width: 0 };
    x = 0;
  };
  // Group tokens into unbreakable words (a word plus glued followers).
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === 'br') {
      push();
      continue;
    }
    if (t.space) {
      if (!cur.items.length) continue;
      cur.items.push({ x: start() + x, text: ' ', font: t.run.font, color: t.run.color });
      x += t.w;
      continue;
    }
    const group: Token[] = [t];
    while (i + 1 < tokens.length) {
      const n = tokens[i + 1]!;
      if (n !== 'br' && !n.space && n.glue) {
        group.push(n);
        i++;
      } else break;
    }
    const gw = group.reduce((a, g) => a + g.w, 0);
    if (cur.items.length && x + gw > limit()) push();
    for (const g of group) {
      cur.items.push({ x: start() + x, text: g.text, font: g.run.font, color: g.run.color, swatch: g.run.swatch });
      if (g.run.id) boxes.push({ id: g.run.id, line: lines.length, x0: start() + x, x1: start() + x + g.w, size: g.run.font.size });
      x += g.w;
    }
  }
  if (cur.items.length) push();
  // Merge boxes per id and line.
  const merged: RichLayout['boxes'] = [];
  for (const b of boxes) {
    const last = merged[merged.length - 1];
    if (last && last.id === b.id && last.line === b.line) {
      last.x1 = Math.max(last.x1, b.x1);
      last.size = Math.max(last.size, b.size);
    } else merged.push({ ...b });
  }
  return { lines, boxes: merged };
}

/** Emits a rich layout as ops at (x, y) with line spacing lead. */
export function drawRich(ops: DrawOp[], lay: RichLayout, x: number, y: number, lead: number): void {
  lay.lines.forEach((line, i) => {
    for (const it of line.items) {
      if (it.text === ' ') continue;
      if (it.swatch) {
        const s = it.font.size * 0.78;
        ops.push({ op: 'swatch', x: x + it.x + it.font.size * 0.07, y: y + i * lead - s * 0.92, size: s, color: it.swatch.color, pattern: it.swatch.pattern, radius: s * 0.15 });
      } else ops.push({ op: 'text', x: x + it.x, y: y + i * lead, text: it.text, font: it.font, color: it.color });
    }
  });
}

// ------------------------------------------------------------------------------------------------ equations

const OPS_PADDED = new Set(['=', '×', '+', '−', '-']);
const TOKEN = /(Δ?[A-Za-zα-ωΑ-Ω]+)(?:_(\{[^}]*\}|[A-Za-z0-9]+))?(?:\^(\{[^}]*\}|[A-Za-z0-9.]+))?|(\d+(?:\.\d+)?)(?:\^(\{[^}]*\}|[0-9]+))?|(½)|([=×+\-−()·/])|( +)/gy;

const unbrace = (s: string | undefined) => (s && s.startsWith('{') ? s.slice(1, -1) : s);
/** Element-like words (Fe, Cu, H) stay italic-free; multi-letter words that are not element-like are upright. */
const isWordUpright = (s: string) => s.replace(/^Δ/, '').length > 1 && !/^[A-Z][a-z]?$/.test(s.replace(/^Δ/, ''));

/**
 * Typesets a plain equation: italic variables with upright subscripts (0.62 size, +0.22 size below the baseline),
 * superscripts (0.62 size, 0.4 size above), operators padded by 0.22 size, spaces of 0.28 size.
 */
export function typesetEquation(src: string, x: number, y: number, size: number, color: string, m: Measurer, ops?: DrawOp[]): number {
  const text = src.replace(/\b1\/2\b/g, '½').replace(/\*/g, '×');
  TOKEN.lastIndex = 0;
  let cx = x;
  const put = (t: string, font: FontSpec, dx: number, dy: number) => {
    ops?.push({ op: 'text', x: cx + dx, y: y + dy, text: t, font, color });
    return m.width(t, font);
  };
  const up: FontSpec = { size };
  const it: FontSpec = { size, italic: true };
  const small: FontSpec = { size: size * 0.62 };
  let pos = 0;
  while (pos < text.length) {
    TOKEN.lastIndex = pos;
    const mt = TOKEN.exec(text);
    if (!mt) {
      cx += put(text[pos]!, up, 0, 0);
      pos++;
      continue;
    }
    pos = TOKEN.lastIndex;
    const [, word, sub, sup, num, numSup, half, op, sp] = mt;
    if (word) {
      let w = word;
      if (w.startsWith('Δ')) {
        cx += put('Δ', up, 0, 0);
        w = w.slice(1);
      }
      cx += put(w, isWordUpright(word) ? up : it, 0, 0);
      const s = unbrace(sub), p = unbrace(sup);
      let tail = 0;
      if (s) {
        tail = Math.max(tail, 0.02 * size + put(s, small, 0.02 * size, 0.22 * size) + 0.04 * size);
      }
      if (p) tail = Math.max(tail, put(p, small, 0.02 * size, -0.4 * size) + 0.04 * size);
      cx += tail + 0.04 * size;
    } else if (num) {
      cx += put(num, up, 0, 0);
      const p = unbrace(numSup);
      if (p) cx += put(p, small, 0.02 * size, -0.4 * size) + 0.04 * size;
      cx += 0.04 * size;
    } else if (half) {
      cx += put('½', up, 0, 0) + 0.04 * size;
    } else if (op) {
      const sym = op === '-' ? '−' : op;
      const pad = OPS_PADDED.has(op) ? 0.22 * size : 0;
      cx += pad;
      cx += put(sym, up, 0, 0);
      cx += pad;
    } else if (sp) {
      cx += 0.28 * size;
    }
  }
  return cx - x;
}
