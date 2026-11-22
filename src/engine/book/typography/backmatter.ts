/**
 * Back matter that flows across both pages of a spread: the index (four columns, largest size that fits, right page
 * balanced), the quiz (scale that fits, answer boxes under lift-up flaps, score foot) and the sources (grouped
 * entries and a colophon).
 */
import type { Side } from '../../contracts';
import { FLAP_WORDS, backHeader, newLayout, read, rect, region, runningHead, type LayoutCtx } from './common';
import type { Measurer } from './measure';
import type { LayoutParams } from './params';
import { drawRich, layoutRich, wrap, wrapDraw, type RichLayout, type Run } from './text';
import type { FontSpec, IndexData, PageLayout, PageSpec, PageState, QuizData, SourcesData } from './types';

// ------------------------------------------------------------------------------------------------ column flow

export interface FlowBlock {
  h: number;
  before?: number;
  keepNext?: boolean;
}

export interface Column { x: number; top: number; bottom: number; side: Side }
export interface Placement { col: number; y: number }

/** Places blocks top to bottom, column after column. Returns null when they do not fit. */
export function flow(blocks: readonly FlowBlock[], cols: readonly Column[]): Placement[] | null {
  const out: Placement[] = [];
  let c = 0;
  let y = cols[0]?.top ?? 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    const next = b.keepNext ? blocks[i + 1] : undefined;
    for (;;) {
      const col = cols[c];
      if (!col) return null;
      const atTop = y <= col.top + 1e-9;
      const before = atTop ? 0 : (b.before ?? 0);
      const need = before + b.h + (next ? next.h : 0);
      if (y + need <= col.bottom + 1e-6) {
        out.push({ col: c, y: y + before });
        y += before + b.h;
        break;
      }
      if (atTop) return null;
      c++;
      y = cols[c]?.top ?? 0;
    }
  }
  return out;
}

/** Smallest common bottom for the right-page columns that still fits (binary search, 18 steps). */
function balance(blocks: readonly FlowBlock[], cols: Column[]): Placement[] | null {
  const first = flow(blocks, cols);
  if (!first) return null;
  const right = cols.map((c, i) => (c.side === 'right' ? i : -1)).filter((i) => i >= 0);
  if (!right.length || !first.some((p) => right.includes(p.col))) return first;
  const top = Math.max(...right.map((i) => cols[i]!.top));
  let lo = top, hi = Math.max(...right.map((i) => cols[i]!.bottom));
  let best = first;
  for (let it = 0; it < 18; it++) {
    const mid = (lo + hi) / 2;
    const trial = cols.map((c) => (c.side === 'right' ? { ...c, bottom: mid } : c));
    const p = flow(blocks, trial);
    if (p) {
      hi = mid;
      best = p;
    } else lo = mid;
  }
  return best;
}

interface SpreadFlow { left: LayoutCtx; right: LayoutCtx }

const flowCache = new WeakMap<object, { key: string; out: SpreadFlow }>();

function cached(data: object, key: string, make: () => SpreadFlow): SpreadFlow {
  const hit = flowCache.get(data);
  if (hit && hit.key === key) return hit.out;
  const out = make();
  flowCache.set(data, { key, out });
  return out;
}

const pick = (f: SpreadFlow, side: Side): LayoutCtx => (side === 'left' ? f.left : f.right);

function clone(L: LayoutCtx): LayoutCtx {
  return { ops: [...L.ops], regions: [...L.regions], reads: [...L.reads], anchors: { ...L.anchors } };
}

// ------------------------------------------------------------------------------------------------ index

interface IndexBlock extends FlowBlock {
  kind: 'head' | 'entry';
  letter?: string;
  lay?: RichLayout;
  entry?: IndexData['entries'][number];
}

function indexBlocks(data: IndexData, l: number, P: LayoutParams, m: Measurer): IndexBlock[] {
  const p = P.index, c = P.palette;
  const sorted = [...data.entries].sort((a, b) => a.term.localeCompare(b.term));
  const out: IndexBlock[] = [];
  let letter = '';
  for (const e of sorted) {
    const L0 = e.term.charAt(0).toUpperCase();
    if (L0 !== letter) {
      letter = L0;
      out.push({ kind: 'head', letter, h: p.headH * l, before: p.headBefore * l, keepNext: true });
    }
    const runs: Run[] = [{ t: e.term, font: { size: l, weight: 620 }, color: c.ink, id: 'entry' }];
    if (e.symbol) runs.push({ t: ', ' + e.symbol, font: { size: l, italic: true }, color: c.ink, nb: true });
    if (e.swatch) runs.push({ t: '', font: { size: l * 1.02 }, color: c.ink, swatch: e.swatch, nb: true });
    runs.push({ t: '  ', font: { size: l }, color: c.ink });
    e.pages.forEach((pg, i) => runs.push({ t: (i ? ', ' : '') + pg, font: { size: l * p.pageScale, weight: 500 }, color: c.accent, id: `page:${pg}`, nb: i > 0 }));
    runs.push({ t: e.def, font: { size: l * p.defScale }, color: c.ink2, br: true });
    if (e.seeAlso?.length) {
      runs.push({ t: ' See also ', font: { size: l * p.defScale, italic: true }, color: c.ink2 });
      runs.push({ t: e.seeAlso.join(', '), font: { size: l * p.defScale, italic: true }, color: c.ink });
    }
    const lay = layoutRich(runs, p.colW, m, p.indent * l);
    out.push({ kind: 'entry', h: lay.lines.length * p.lead * l + p.blockExtra * l, lay, entry: e });
  }
  return out;
}

function indexFlow(data: IndexData, P: LayoutParams, m: Measurer): SpreadFlow {
  const p = P.index, c = P.palette;
  const cols: Column[] = [
    { x: p.leftX0, top: p.leftTop, bottom: p.bottom, side: 'left' },
    { x: p.leftX1, top: p.leftTop, bottom: p.bottom, side: 'left' },
    { x: p.rightX0, top: p.rightTop, bottom: p.bottom, side: 'right' },
    { x: p.rightX1, top: p.rightTop, bottom: p.bottom, side: 'right' },
  ];
  let l = p.maxSize, blocks = indexBlocks(data, l, P, m), place = flow(blocks, cols);
  while (!place && l - p.sizeStep >= p.minSize - 1e-9) {
    l = Math.round((l - p.sizeStep) * 1000) / 1000;
    blocks = indexBlocks(data, l, P, m);
    place = flow(blocks, cols);
  }
  place = balance(blocks, cols) ?? place ?? flow(blocks, cols.map((cl) => ({ ...cl, bottom: 1e6 })))!;
  const f: SpreadFlow = { left: newLayout(), right: newLayout() };
  backHeader(f.left, p.x, data.kicker, data.title, P);
  wrapDraw(f.left.ops, data.intro, p.x, p.introV, p.introW, p.introLead, { size: p.introSize, italic: true }, c.ink2, m, 'left', 2);
  f.left.ops.push({ op: 'line', x0: p.x, y0: p.ruleV, x1: 172, y1: p.ruleV, width: 0.25, color: c.rule });
  read(f.left, 'bm-intro', rect(8, 14, 182, 52), `${data.title}. ${data.intro}`);
  blocks.forEach((b, i) => {
    const pl = place![i]!;
    const col = cols[pl.col]!;
    const L = pick(f, col.side);
    if (b.kind === 'head') {
      L.ops.push({ op: 'text', x: col.x, y: pl.y + 1.12 * l, text: b.letter!, font: { size: p.headSize * l, weight: 640 }, color: c.accent });
      L.ops.push({ op: 'line', x0: col.x + 1.4 * l, y0: pl.y + 0.78 * l, x1: col.x + p.colW, y1: pl.y + 0.78 * l, width: 0.18, color: c.rule });
      return;
    }
    const lead = p.lead * l, base = pl.y + 0.92 * l;
    drawRich(L.ops, b.lay!, col.x, base, lead);
    const e = b.entry!;
    const first = e.pages[0];
    if (first !== undefined) region(L, `index:${e.term}`, 'link', { u: col.x, v: pl.y, w: p.colW, h: b.h }, `goto:${data.lessonSpread(first)}`, e.term);
    for (const bx of b.lay!.boxes) {
      if (!bx.id.startsWith('page:')) continue;
      const pg = Number(bx.id.slice(5));
      const y = base + bx.line * lead;
      region(L, `index:${e.term}:${pg}`, 'link', rect(col.x + bx.x0 - 0.9, y - 0.82 * bx.size - 0.8, col.x + bx.x1 + 0.9, y + 0.3 * bx.size + 0.8), `goto:${data.lessonSpread(pg)}`, `${e.term}, page ${pg}`);
    }
    read(L, `index:${e.term}`, { u: col.x, v: pl.y, w: p.colW, h: b.h }, `${e.term}: ${e.def}`);
  });
  return f;
}

export function layoutIndex(spec: Extract<PageSpec, { kind: 'index' }>, _k: number, _state: PageState, P: LayoutParams, m: Measurer): PageLayout {
  const f = cached(spec.data, `${m.key}|${JSON.stringify(P.index)}|${JSON.stringify(P.palette)}`, () => indexFlow(spec.data, P, m));
  const L = clone(pick(f, spec.part));
  runningHead(L, spec.part, spec.head, spec.folio, P);
  return L;
}

// ------------------------------------------------------------------------------------------------ quiz

interface QuizMetrics {
  k: number; qs: number; qLead: number; os: number; oLead: number; as: number; aLead: number; cb: number; gap: number; numCol: number;
}

interface QuizBlock {
  q: number;
  h: number;
  qLines: string[];
  per: number;
  rows: number;
  cellW: number;
  aLines: string[];
}

function quizMetrics(k: number, P: LayoutParams): QuizMetrics {
  const p = P.quiz;
  const qs = p.qSize * k, os = p.oSize * k, as = p.aSize * k;
  return { k, qs, qLead: p.qLead * qs, os, oLead: p.oLead * os, as, aLead: p.aLead * as, cb: p.box * k, gap: p.colGap * k, numCol: p.numCol * Math.max(0.9, k) };
}

function quizBlock(data: QuizData, q: number, side: Side, M: QuizMetrics, P: LayoutParams, m: Measurer): QuizBlock {
  const p = P.quiz;
  const item = data.questions[q]!;
  const tx0 = side === 'left' ? p.leftText0 : p.rightText0, tx1 = side === 'left' ? p.leftText1 : p.rightText1;
  const mw = (side === 'left' ? p.leftMargin1 - p.leftMargin0 : p.rightMargin1 - p.rightMargin0) - 2 * p.answerInset - 4.4;
  const textW = tx1 - tx0 - M.numCol;
  const qLines = wrap(item.question, textW, { size: M.qs }, m);
  const n = item.options.length;
  const tries = n === 4 ? [4, 2, 1] : n === 3 ? [3, 1] : Array.from({ length: n }, (_, i) => n - i);
  let per = 1, cellW = textW;
  for (const t of tries) {
    const w = (textW - (t - 1) * M.gap) / t;
    if (item.options.every((o) => M.cb + p.labelGap * M.k + m.width(o, { size: M.os }) <= w)) {
      per = t;
      cellW = w;
      break;
    }
  }
  const rows = Math.ceil(n / per);
  const qH = 0.95 * M.qs + (qLines.length - 1) * M.qLead + 0.55 * M.qs + rows * M.oLead - 0.35 * M.oLead;
  const aLines = wrap(`${item.options[item.answer] ?? ''}. ${item.explain}`, mw, { size: M.as }, m);
  const aH = 2.2 + M.as + 1.6 + 0.95 * M.as + (aLines.length - 1) * M.aLead + 2.2;
  return { q, h: Math.max(qH, aH), qLines, per, rows, cellW, aLines };
}

function quizFlow(data: QuizData, P: LayoutParams, m: Measurer): SpreadFlow {
  const p = P.quiz, c = P.palette;
  const n = data.questions.length;
  const half = Math.ceil(n / 2);
  const pages: { side: Side; qs: number[]; top: number; bottom: number }[] = [
    { side: 'left', qs: [...Array(half).keys()], top: p.leftTop, bottom: p.leftBottom },
    { side: 'right', qs: [...Array(n - half).keys()].map((i) => i + half), top: p.rightTop, bottom: p.rightBottom },
  ];
  let M = quizMetrics(p.maxScale, P);
  let blocks: QuizBlock[][] = [];
  for (let k = p.maxScale; k >= p.minScale - 1e-9; k = Math.round((k - p.scaleStep) * 1000) / 1000) {
    M = quizMetrics(k, P);
    blocks = pages.map((pg) => pg.qs.map((q) => quizBlock(data, q, pg.side, M, P, m)));
    const fits = pages.every((pg, i) => {
      const b = blocks[i]!;
      return b.reduce((a, x) => a + x.h, 0) + p.gapFit * k * Math.max(0, b.length - 1) <= pg.bottom - pg.top;
    });
    if (fits) break;
  }
  const f: SpreadFlow = { left: newLayout(), right: newLayout() };
  // Left header.
  backHeader(f.left, p.x, data.kicker, data.title, P);
  wrapDraw(f.left.ops, data.intro, p.x, p.introV, p.leftText1 - p.x, p.introLead, { size: p.introSize, italic: true }, c.ink2, m, 'left', 2);
  f.left.ops.push({ op: 'text', x: p.leftMargin0, y: p.answersV, text: data.answersLabel, font: { size: p.answersSize, weight: 600, caps: true }, color: c.accent });
  f.left.ops.push({ op: 'text', x: p.leftMargin0, y: p.answersNoteV, text: data.answersNote, font: { size: p.answersNoteSize, italic: true }, color: c.ink2 });
  read(f.left, 'bm-intro', rect(8, 14, 182, 52), `${data.title}. ${data.intro}`);
  pages.forEach((pg, pi) => {
    const L = pick(f, pg.side);
    const bl = blocks[pi]!;
    const total = bl.reduce((a, x) => a + x.h, 0);
    const slack = pg.bottom - pg.top - total;
    const gap = bl.length > 1 ? Math.min(p.gapMax, slack / (bl.length - 1)) : 0;
    const tx0 = pg.side === 'left' ? p.leftText0 : p.rightText0, tx1 = pg.side === 'left' ? p.leftText1 : p.rightText1;
    const mx0 = pg.side === 'left' ? p.leftMargin0 : p.rightMargin0, mx1 = pg.side === 'left' ? p.leftMargin1 : p.rightMargin1;
    let y = pg.top;
    bl.forEach((b, bi) => {
      const item = data.questions[b.q]!;
      const qBase = y + 0.95 * M.qs;
      L.ops.push({ op: 'text', x: tx0, y: qBase, text: String(b.q + 1), font: { size: 1.12 * M.qs, weight: 700 }, color: c.accent });
      b.qLines.forEach((t, i) => L.ops.push({ op: 'text', x: tx0 + M.numCol, y: qBase + i * M.qLead, text: t, font: { size: M.qs }, color: c.ink }));
      const oBase = qBase + (b.qLines.length - 1) * M.qLead + 0.55 * M.qs + 0.72 * M.oLead;
      item.options.forEach((o, i) => {
        const row = Math.floor(i / b.per), col = i % b.per;
        const bx = tx0 + M.numCol + col * (b.cellW + M.gap), by = oBase + row * M.oLead;
        L.ops.push({ op: 'rect', x: bx, y: by - 0.8 * M.cb, w: M.cb, h: M.cb, stroke: c.ink, width: 0.3 });
        L.ops.push({ op: 'text', x: bx + M.cb + p.labelGap * M.k, y: by, text: o, font: { size: M.os }, color: c.ink });
        const r = rect(bx - 0.6, by - 0.8 * M.cb - 0.8, bx + b.cellW, by + 0.2 * M.cb + 0.8);
        region(L, `quiz:${b.q}:${i}`, 'quiz', r, `quiz:${b.q}:${i}`, o);
        L.anchors[`quiz:${b.q}:${i}`] = { u: bx, v: by - 0.8 * M.cb, w: M.cb, h: M.cb };
      });
      // Answer box in the margin column (covered by a lift-up flap).
      const ar = rect(mx0 + p.answerInset, y + p.answerInset, mx1 - p.answerInset, y + b.h - p.answerInset);
      L.ops.push({ op: 'rect', x: ar.u, y: ar.v, w: ar.w, h: ar.h, stroke: c.rule, width: 0.22, dash: [0.9, 0.9] });
      const ax = ar.u + 2.2;
      let ay = y + 2.2 + M.as;
      const capF: FontSpec = { size: 0.92 * M.as, weight: 600, caps: true };
      const head = `Answer ${b.q + 1}`;
      L.ops.push({ op: 'text', x: ax, y: ay, text: head, font: capF, color: c.accent });
      if (item.lesson !== undefined) {
        const hw = m.width(head + ' ', capF);
        const lf: FontSpec = { size: 0.92 * M.as, weight: 500, caps: true };
        const lt = `· lesson ${item.lesson}`;
        L.ops.push({ op: 'text', x: ax + hw, y: ay, text: lt, font: lf, color: c.ink2 });
        if (data.lessonSpread) region(L, `quiz-lesson:${b.q}`, 'link', rect(ax + hw - 0.5, ay - M.as, ax + hw + m.width(lt, lf) + 0.5, ay + 1), `goto:${data.lessonSpread(item.lesson)}`, lt);
      }
      ay += 1.6 + 0.95 * M.as;
      b.aLines.forEach((t, i) => {
        const first = i === 0;
        const ans = item.options[item.answer] ?? '';
        if (first && t.startsWith(ans)) {
          L.ops.push({ op: 'text', x: ax, y: ay, text: ans, font: { size: 1.06 * M.as, weight: 640 }, color: c.ink });
          const rest = t.slice(ans.length);
          if (rest) L.ops.push({ op: 'text', x: ax + m.width(ans, { size: 1.06 * M.as, weight: 640 }), y: ay, text: rest, font: { size: M.as }, color: c.ink2 });
        } else L.ops.push({ op: 'text', x: ax, y: ay + i * M.aLead, text: t, font: { size: M.as }, color: c.ink2 });
      });
      L.anchors[`quiz-answer:${b.q}`] = ar;
      region(L, `quiz-flap:${b.q}`, 'flap', ar, `quiz-flap:${b.q}`, head);
      read(L, `quiz:${b.q}`, rect(tx0 - 2, y, tx1, y + b.h), `${b.q + 1}. ${item.question} ${item.options.join(', ')}`);
      if (bi < bl.length - 1) {
        const ry = y + b.h + gap / 2;
        L.ops.push({ op: 'line', x0: Math.min(tx0, mx0), y0: ry, x1: Math.max(tx1, mx1), y1: ry, width: 0.18, color: c.rule });
      }
      y += b.h + gap;
    });
  });
  // Right-page foot: score line and stamp circle.
  const R = f.right;
  R.ops.push({ op: 'line', x0: p.rightText0, y0: p.footRuleV, x1: P.head.rightX, y1: p.footRuleV, width: 0.3, color: c.rule });
  R.ops.push({ op: 'text', x: p.rightText0, y: p.scoreV, text: data.scoreLabel, font: { size: p.scoreSize, weight: 600, caps: true }, color: c.accent });
  R.ops.push({ op: 'line', x0: p.rightText0, y0: p.scoreLineV, x1: p.rightText0 + 20, y1: p.scoreLineV, width: 0.32, color: c.ink2 });
  const of: FontSpec = { size: p.scoreOfSize, weight: 500 };
  const ofText = `${data.scoreOf} ${n}`;
  R.ops.push({ op: 'text', x: p.scoreOfX, y: p.scoreOfV, text: ofText, font: of, color: c.ink });
  R.ops.push({ op: 'text', x: p.scoreOfX + m.width(ofText + ' ', of), y: p.scoreOfV, text: data.scoreRight, font: { size: p.scoreNoteSize, italic: true }, color: c.ink2 });
  R.ops.push({ op: 'text', x: p.rightText0, y: p.instructionV, text: data.instruction, font: { size: p.instructionSize, italic: true }, color: c.ink2 });
  R.ops.push({ op: 'circle', x: p.stampU, y: p.stampV, r: p.stampR, stroke: c.rule, width: 0.3, dash: [0.8, 1.1] });
  R.anchors.stamp = { u: p.stampU - p.stampR, v: p.stampV - p.stampR, w: 2 * p.stampR, h: 2 * p.stampR };
  return f;
}

export function layoutQuiz(spec: Extract<PageSpec, { kind: 'quiz' }>, k: number, state: PageState, P: LayoutParams, m: Measurer): PageLayout {
  const flowOut = cached(spec.data, `${m.key}|${JSON.stringify(P.quiz)}|${JSON.stringify(P.palette)}`, () => quizFlow(spec.data, P, m));
  const L = clone(pick(flowOut, spec.part));
  runningHead(L, spec.part, spec.head, spec.folio, P);
  const p = P.quiz, c = P.palette, data = spec.data;
  // Quiz ink (printed into the page): ticks on picked options, flap faces over closed answers, the score.
  for (const [qs, pickIdx] of Object.entries(state.quizPicks)) {
    const a = L.anchors[`quiz:${qs}:${pickIdx}`];
    if (a) L.ops.push({ op: 'tick', x: a.u, y: a.v + a.h, scale: Math.max(0.85, a.w / 4.4), color: c.pen });
  }
  for (const [key, r] of Object.entries(L.anchors)) {
    if (!key.startsWith('quiz-answer:')) continue;
    const q = Number(key.slice(12));
    if (!state.printedOpen.has(`${k}:quiz-flap:${q}`)) L.ops.push({ op: 'flap-face', kind: 'quiz', x: r.u, y: r.v, w: r.w, h: r.h, n: q + 1, hand: FLAP_WORDS.quizHand });
  }
  const n = data.questions.length;
  const allOpen = n > 0 && data.questions.every((_, q) => state.quizOpen[q]);
  if (spec.part === 'right' && allOpen) {
    const score = data.questions.reduce((a, qq, q) => a + (state.quizPicks[q] === qq.answer ? 1 : 0), 0);
    L.ops.push({ op: 'text', x: p.scoreNumU, y: p.scoreNumV, text: String(score), font: { size: p.scoreNumSize, weight: 600, family: 'hand' }, color: c.pen, align: 'center', rotate: -0.03 });
    L.ops.push({
      op: 'stamp', x: p.stampU, y: p.stampV, r: 11.25, n: score, press: 1, label: '', rotate: -0.14, seed: 7919 + 31 * score,
      lines: [{ text: 'Quiz', scale: 0.2, y: -0.42 }, { text: `${score}/${n}`, scale: 0.5, y: 0.12 }, { text: data.bookTitle ?? '', scale: 0.17, y: 0.5 }],
    });
  }
  return L;
}

// ------------------------------------------------------------------------------------------------ sources

const curl = (s: string) => s.replace(/"([^"]*)"/g, '\u201c$1\u201d').replace(/'/g, '\u2019');
const dropLongParens = (s: string) => s.replace(/\s*\(([^)]{35,})\)/g, '');
export function shortHost(url: string | undefined): string {
  if (!url) return '';
  const h = url.replace(/^[a-z]+:\/\//i, '').split('/')[0] ?? '';
  return h.replace(/^(www|assets|data)\./, '');
}

interface SourceBlock extends FlowBlock {
  kind: 'head' | 'entry';
  text?: string;
  lay?: RichLayout;
  n?: number;
  url?: string;
}

function sourceBlocks(data: SourcesData, l: number, P: LayoutParams, m: Measurer): SourceBlock[] {
  const p = P.sources, c = P.palette;
  const out: SourceBlock[] = [];
  let group: string | undefined;
  for (const e of data.entries) {
    if (e.group && e.group !== group) {
      group = e.group;
      out.push({ kind: 'head', text: e.group, h: p.headH * l, before: p.headBefore * l, keepNext: true });
    }
    const detail = e.detail ? curl(dropLongParens(e.detail)) : '';
    const title = curl(e.title) + (/[.?!]$/.test(e.title) || detail.startsWith('(') ? '' : '.');
    const runs: Run[] = [{ t: title, font: { size: l, italic: true }, color: c.ink }];
    if (detail) runs.push({ t: ' ' + detail, font: { size: l }, color: c.ink });
    const host = e.host ?? shortHost(e.url);
    if (host) runs.push({ t: ' ' + host, font: { size: l * p.hostScale }, color: c.ink2 });
    if (e.lessons?.length) runs.push({ t: ` ${e.lessons.length > 1 ? 'Lessons' : 'Lesson'} ${e.lessons.join(', ')}`, font: { size: l * p.hostScale, italic: true }, color: c.accent });
    const lay = layoutRich(runs, P.sources.colW - p.numCol * l, m);
    out.push({ kind: 'entry', h: lay.lines.length * p.lead * l + p.blockExtra * l, lay, n: e.n, url: e.url });
  }
  return out;
}

function sourcesFlow(data: SourcesData, P: LayoutParams, m: Measurer): SpreadFlow {
  const p = P.sources, c = P.palette;
  const cols: Column[] = [
    { x: p.leftX0, top: p.leftTop, bottom: p.leftBottom, side: 'left' },
    { x: p.leftX1, top: p.leftTop, bottom: p.leftBottom, side: 'left' },
    { x: p.rightX0, top: p.rightTop, bottom: p.rightBottom, side: 'right' },
    { x: p.rightX1, top: p.rightTop, bottom: p.rightBottom, side: 'right' },
  ];
  let l = p.maxSize, blocks = sourceBlocks(data, l, P, m), place = flow(blocks, cols);
  while (!place && l - p.sizeStep >= p.minSize - 1e-9) {
    l = Math.round((l - p.sizeStep) * 1000) / 1000;
    blocks = sourceBlocks(data, l, P, m);
    place = flow(blocks, cols);
  }
  place ??= flow(blocks, cols.map((cl) => ({ ...cl, bottom: 1e6 })))!;
  const f: SpreadFlow = { left: newLayout(), right: newLayout() };
  backHeader(f.left, p.x, data.kicker, data.title, P);
  const runs: Run[] = [{ t: data.intro, font: { size: p.introSize, italic: true }, color: c.ink2 }];
  if (data.link) runs.push({ t: ' ' + data.link.text, font: { size: p.introSize, weight: 600 }, color: c.accent, id: 'link' });
  const intro = layoutRich(runs, p.introW, m);
  drawRich(f.left.ops, intro, p.x, p.introV, p.introLead);
  for (const b of intro.boxes) {
    const y = p.introV + b.line * p.introLead;
    if (data.link) region(f.left, `link:${data.link.url}`, 'link', rect(p.x + b.x0, y - 0.82 * b.size, p.x + b.x1, y + 0.3 * b.size), `link:${data.link.url}`, data.link.text);
  }
  const ruleV = p.introV + intro.lines.length * p.introLead + 0.5;
  f.left.ops.push({ op: 'line', x0: p.x, y0: ruleV, x1: 172, y1: ruleV, width: 0.25, color: c.rule });
  read(f.left, 'bm-intro', rect(8, 14, 182, 52), `${data.title}. ${data.intro}`);
  blocks.forEach((b, i) => {
    const pl = place![i]!;
    const col = cols[pl.col]!;
    const L = pick(f, col.side);
    if (b.kind === 'head') {
      L.ops.push({ op: 'text', x: col.x, y: pl.y + 1.05 * l, text: b.text!, font: { size: p.headScale * l, weight: 640, caps: true }, color: c.accent });
      return;
    }
    const base = pl.y + 0.92 * l;
    L.ops.push({ op: 'text', x: col.x + p.numCol * l - 0.55 * l, y: base, text: String(b.n), font: { size: 0.96 * l, weight: 700 }, color: c.accent, align: 'right' });
    drawRich(L.ops, b.lay!, col.x + p.numCol * l, base, p.lead * l);
    const r = { u: col.x, v: pl.y, w: p.colW, h: b.h };
    region(L, `source:${b.n}`, 'source', r, `source:${b.n}`, b.url);
    read(L, `source:${b.n}`, r, b.lay!.lines.map((ln) => ln.items.map((it) => it.text).join('')).join(' '));
  });
  // Colophon and maker's mark.
  const R = f.right;
  R.ops.push({ op: 'line', x0: p.rightX0, y0: p.colophonV, x1: P.head.rightX, y1: p.colophonV, width: 0.3, color: c.rule });
  R.ops.push({ op: 'text', x: p.rightX0, y: p.colophonLabelV, text: data.colophon.title, font: { size: 3.4, weight: 600, caps: true }, color: c.accent });
  let y = p.colophonTextV;
  data.colophon.paragraphs.forEach((para, i) => {
    y = wrapDraw(R.ops, para, p.rightX0, y, p.colophonW, p.colophonLead, { size: i === 0 ? 3.6 : 3.4 }, i === 0 ? c.ink : c.ink2, m);
  });
  R.ops.push({ op: 'mark', x: p.markU, y: p.markV, r: p.markR, color: c.accent });
  read(R, 'colophon', rect(16, p.colophonV, 178, 240), data.colophon.paragraphs.join(' '));
  return f;
}

export function layoutSources(spec: Extract<PageSpec, { kind: 'sources' }>, _k: number, _state: PageState, P: LayoutParams, m: Measurer): PageLayout {
  const f = cached(spec.data, `${m.key}|${JSON.stringify(P.sources)}|${JSON.stringify(P.palette)}`, () => sourcesFlow(spec.data, P, m));
  const L = clone(pick(f, spec.part));
  runningHead(L, spec.part, spec.head, spec.folio, P);
  return L;
}
