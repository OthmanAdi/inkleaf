/**
 * Page layouts for the lesson spreads, the title page, the contents page and placeholder pages. Every function is
 * pure: spec + state + parameters + a measurer in, a display list with hit regions, read regions and anchors out.
 */
import type { Side } from '../../contracts';
import { FLAP_WORDS, newLayout, read, rect, region, runningHead } from './common';
import type { Measurer } from './measure';
import type { LayoutParams } from './params';
import { typesetEquation, wrap, wrapDraw } from './text';
import type { FontSpec, LessonContent, PageLayout, PageSpec, PageState, SpreadPages } from './types';
import { layoutIndex, layoutQuiz, layoutSources } from './backmatter';

export function lessonLeft(spec: { head: string; folio: number; lesson: LessonContent }, k: number, state: PageState, P: LayoutParams, m: Measurer): PageLayout {
  const L = newLayout();
  const p = P.left, c = P.palette, les = spec.lesson;
  runningHead(L, 'left', spec.head, spec.folio, P);
  const x = p.textX, W = p.textW, right = x + W;
  const label = (t: string, y: number, size = p.labelSize, xx = x) =>
    L.ops.push({ op: 'text', x: xx, y, text: t, font: { size, weight: 600, caps: true }, color: c.accent });
  label(les.kicker ?? `Lesson ${les.n}`, p.kickerV, p.kickerSize);
  L.ops.push({ op: 'text', x, y: p.titleV, text: les.title, font: { size: p.titleSize, weight: 560 }, color: c.ink });
  let y = p.bodyV;
  for (const para of les.intro) y = wrapDraw(L.ops, para, x, y, W, p.bodyLead, { size: p.bodySize }, c.ink, m) + p.paraGap;
  read(L, 'head', rect(x - 4, 18, right, y), [les.title, ...les.intro].join(' '));
  if (les.formula) {
    y += p.eqBefore;
    const f = les.formula;
    L.ops.push({ op: 'rect', x: p.eqX, y, w: p.eqW, h: p.eqH, stroke: c.rule, width: p.eqStroke });
    typesetEquation(f.symbolic, p.eqX + p.eqPad, y + p.eqSymDy, p.eqSymSize, c.ink, m, L.ops);
    const end = wrapDraw(L.ops, f.words, p.eqX + p.eqPad, y + p.eqWordsDy, p.eqWordsW, p.eqWordsLead, { size: p.eqWordsSize, italic: true }, c.ink2, m);
    if (f.units && end <= y + p.eqUnitsLimit) {
      L.ops.push({ op: 'text', x: p.eqX + p.eqPad, y: y + p.eqUnitsDy, text: f.units.replace(/_/g, ''), font: { size: p.eqUnitsSize }, color: c.ink2 });
    }
    const r = { u: p.eqX, v: y, w: p.eqW, h: p.eqH };
    L.anchors.equation = r;
    read(L, 'equation', r, `${f.symbolic}. ${f.words}. ${f.units ?? ''}`.trim());
    y += p.eqAfter;
  }
  if (les.keyWords.length) {
    const top = y - p.labelSize;
    label('Key words', y);
    y += p.kwGap;
    for (const kw of les.keyWords) {
      const tf: FontSpec = { size: p.kwSize, weight: 600 };
      L.ops.push({ op: 'text', x, y, text: kw.term, font: tf, color: c.ink });
      const tw = m.width(kw.term + '  ', tf);
      const lines = wrap(kw.def, W - tw, { size: p.kwSize }, m);
      lines.forEach((t, i) => L.ops.push({ op: 'text', x: x + tw, y: y + i * p.kwLead, text: t, font: { size: p.kwSize }, color: c.ink2 }));
      y += Math.max(1, lines.length) * p.kwLead + p.kwAfter;
    }
    read(L, 'keywords', rect(x - 4, top - 1, right, y - p.kwLead + 2), les.keyWords.map((k) => `${k.term}: ${k.def}`).join(' '));
  }
  y += p.predictBefore;
  const pTop = y - p.labelSize;
  label('Predict', y);
  y += p.predictGap;
  y = wrapDraw(L.ops, les.predict.question, x, y, W, p.questionLead, { size: p.questionSize, weight: 500 }, c.ink, m) + p.questionAfter;
  les.predict.options.forEach((opt, i) => {
    L.ops.push({ op: 'rect', x, y: y - p.boxDy, w: p.boxSize, h: p.boxSize, stroke: c.ink, width: p.boxStroke });
    L.ops.push({ op: 'text', x: p.optionX, y, text: opt, font: { size: p.optionSize }, color: c.ink });
    const r = rect(x - 1.5, y - 5.4, right, y + 2);
    region(L, `predict:${i}`, 'predict', r, `predict:${i}`, opt);
    L.anchors[`predict:${i}`] = r;
    y += p.optionStep;
  });
  read(L, 'predict', rect(x - 4, pTop - 1, right, y - p.optionStep + 2.5), [les.predict.question, ...les.predict.options].join(' '));
  y += p.flapBefore;
  // Why? box: shrink the text until the box ends above the bottom limit.
  let size = p.flapMax;
  let lines = wrap(les.flap.text, p.flapTextW, { size }, m);
  while (size > p.flapMin && y + p.flapTextDy + lines.length * p.flapLeadF * size + 3 > p.flapBottom) {
    size = Math.max(p.flapMin, size - p.flapStep);
    lines = wrap(les.flap.text, p.flapTextW, { size }, m);
  }
  const lead = p.flapLeadF * size;
  const bottom = Math.min(p.flapBottom, Math.max(y + p.flapMinH, y + p.flapTextDy + lines.length * lead + 3));
  const fr = rect(p.eqX, y, p.eqX + p.eqW, bottom);
  L.anchors.flap = fr;
  label(les.flap.title, y + p.flapLabelDy);
  lines.forEach((t, i) => L.ops.push({ op: 'text', x, y: y + p.flapTextDy + i * lead, text: t, font: { size }, color: c.ink }));
  region(L, 'flap', 'flap', fr, 'flap', les.flap.title);
  read(L, 'explain', fr, les.flap.text);
  if (!state.printedOpen.has(`${k}:flap`)) {
    L.ops.push({
      op: 'flap-face', kind: 'lesson', x: fr.u, y: fr.v, w: fr.w, h: fr.h, title: les.flap.title,
      main: les.flap.main ?? FLAP_WORDS.main, sub: les.flap.sub ?? FLAP_WORDS.sub, hand: les.flap.hand ?? FLAP_WORDS.hand,
    });
  }
  // Margin column: challenge and the stamp target.
  label('Challenge', p.challengeV, p.challengeSize, p.marginX);
  wrapDraw(L.ops, les.challenge.text, p.marginX, p.challengeTextV, p.marginW, p.challengeLead, { size: p.challengeTextSize, italic: true }, c.ink, m);
  L.ops.push({ op: 'circle', x: p.stampU, y: p.stampV, r: p.stampR, stroke: c.rule, width: p.stampLine, dash: [0.8, 1.1] });
  const sr = { u: p.stampU - p.stampR, v: p.stampV - p.stampR, w: 2 * p.stampR, h: 2 * p.stampR };
  L.anchors.stamp = sr;
  L.anchors.margin = rect(p.marginX, 20, p.marginX + 40, 180);
  region(L, 'stamp', 'stamp', sr, 'stamp');
  read(L, 'challenge', rect(10, p.challengeV - 7, 52, 236), les.challenge.text);
  read(L, 'margin', rect(10, 60, 53, 180));
  return L;
}

export function lessonRight(spec: { head: string; folio: number; lesson: LessonContent }, _k: number, _state: PageState, P: LayoutParams, m: Measurer): PageLayout {
  const L = newLayout();
  const p = P.right, c = P.palette, les = spec.lesson;
  runningHead(L, 'right', spec.head, spec.folio, P);
  const fig = les.figure;
  const caption = `Fig. ${les.n}  ${fig.caption}${fig.note ? '. ' + fig.note : ''}`;
  L.ops.push({ op: 'text', x: p.captionX, y: p.captionV, text: caption, font: { size: p.captionSize, italic: true }, color: c.ink2 });
  L.ops.push({ op: 'text', x: p.captionX, y: p.hintV, text: fig.instruction, font: { size: p.hintSize, italic: true }, color: c.ink });
  let right = p.switchRight;
  const of: FontSpec = { size: p.switchSize, weight: 600 };
  const lf: FontSpec = { size: p.switchSize, italic: true };
  for (const sw of fig.switches ?? []) {
    const ws = sw.options.map((o) => m.width(o, of));
    const total = ws.reduce((a, b) => a + b, 0) + p.switchGap * Math.max(0, ws.length - 1);
    let ox = right - total;
    const lw = m.width(sw.label, lf);
    L.ops.push({ op: 'text', x: ox - p.switchLabelGap, y: p.switchV, text: sw.label, font: lf, color: c.ink2, align: 'right' });
    sw.options.forEach((o, i) => {
      const w = ws[i]!;
      L.ops.push({ op: 'text', x: ox, y: p.switchV, text: o, font: of, color: c.ink });
      const r = rect(ox - 2, p.switchV - 5, ox + w + 2, p.switchV + 2.5);
      region(L, `switch:${sw.id}:${i}`, 'switch', r, `switch:${sw.id}:${o}`, `${sw.label}: ${o}`);
      L.anchors[`switch:${sw.id}:${i}`] = r;
      ox += w + p.switchGap;
    });
    right -= total + lw + p.switchGroupGap;
  }
  read(L, 'figure', rect(16, p.captionV - 6.5, 178, p.hintV + 3.5), `${caption}. ${fig.instruction}`);
  L.anchors.print = { u: p.printU, v: p.printV, w: p.printW, h: p.printH };
  return L;
}

export function titlePage(spec: Extract<PageSpec, { kind: 'title' }>, P: LayoutParams, m: Measurer): PageLayout {
  const L = newLayout();
  const p = P.title, c = P.palette, X = p.centerX;
  L.ops.push({ op: 'text', x: X, y: p.kickerV, text: spec.kicker, font: { size: p.kickerSize, weight: 600, caps: true }, color: c.accent, align: 'center' });
  L.ops.push({ op: 'text', x: X, y: p.titleV, text: spec.title, font: { size: p.titleSize, weight: 560 }, color: c.ink, align: 'center' });
  L.ops.push({ op: 'line', x0: X - p.ruleHalf, y0: p.ruleV, x1: X + p.ruleHalf, y1: p.ruleV, width: 0.3, color: c.rule });
  wrapDraw(L.ops, spec.tagline, X, p.taglineV, p.taglineW, p.taglineLead, { size: p.taglineSize, italic: true }, c.ink2, m, 'center');
  L.ops.push({ op: 'image', x: p.plateX, y: p.plateY, w: p.plateW, h: (p.plateW * 102) / 90, source: 'plate' });
  L.ops.push({ op: 'text', x: p.howX, y: p.howV, text: spec.howToTitle, font: { size: p.howSize, weight: 600, caps: true }, color: c.accent });
  let y = p.howLineV;
  for (const line of spec.howTo) y = wrapDraw(L.ops, line, p.howX, y, p.howW, p.howLead, { size: p.howLineSize, italic: true }, c.ink, m) + p.howAfter;
  L.ops.push({ op: 'text', x: X, y: p.copyV, text: spec.copyright, font: { size: p.copySize }, color: c.ink2, align: 'center' });
  read(L, 'title', rect(30, 50, 160, 112), `${spec.title}. ${spec.tagline}`);
  read(L, 'howto', rect(38, p.howV - 8, 152, 232), spec.howTo.join(' '));
  return L;
}

export function contentsPage(spec: Extract<PageSpec, { kind: 'contents' }>, state: PageState, P: LayoutParams, m: Measurer): PageLayout {
  const L = newLayout();
  const p = P.contents, c = P.palette;
  runningHead(L, 'right', spec.head, spec.folio, P);
  L.ops.push({ op: 'text', x: p.titleX, y: p.titleV, text: spec.title, font: { size: p.titleSize, weight: 560 }, color: c.ink });
  let v = p.rowV;
  let back = false;
  for (const row of spec.rows) {
    if (row.backMatter && !back) {
      v += p.backGap;
      back = true;
    }
    const tf: FontSpec = { size: p.entrySize, weight: row.backMatter ? 600 : 500 };
    if (row.n !== undefined) L.ops.push({ op: 'text', x: p.titleX, y: v, text: String(row.n), font: { size: p.numSize, weight: 600 }, color: c.accent });
    L.ops.push({ op: 'text', x: p.entryX, y: v, text: row.title, font: tf, color: row.available ? c.ink : c.ink2 });
    let dotsFrom = p.entryX + 2 + m.width(row.title, tf) + 2;
    if (!row.available) {
      const nf: FontSpec = { size: p.nextSize, italic: true };
      const note = spec.pendingNote ?? 'not yet written';
      L.ops.push({ op: 'text', x: dotsFrom - 1, y: v, text: note, font: nf, color: c.ink2 });
      dotsFrom += m.width(note, nf) + 1;
    }
    L.ops.push({ op: 'text', x: p.pageX, y: v, text: String(row.page), font: { size: p.entrySize * 0.86 }, color: c.ink, align: 'right' });
    if (dotsFrom < p.dotsTo) L.ops.push({ op: 'dots', x0: dotsFrom, x1: p.dotsTo, y: v - 0.55, step: p.dotStep, size: p.dotSize, color: c.ink2 });
    if (row.n !== undefined) {
      L.ops.push({ op: 'circle', x: p.circleX, y: v - 1.8, r: p.circleR, stroke: c.rule, width: 0.3, dash: [0.6, 0.9] });
      const press = state.stamps[row.n] ?? 0;
      if (press > 0) L.ops.push({ op: 'stamp', x: p.circleX, y: v - 1.8, r: p.stampR, n: row.n, press, label: 'Done', rotate: -0.16 + (row.n % 3) * 0.07, seed: 7 * 9973 + 31 * row.n });
    }
    if (row.available) region(L, `goto:${row.spread}`, 'link', rect(18, v - 6, 170, v + 2.4), `goto:${row.spread}`, row.title);
    v += p.rowStep;
  }
  L.ops.push({ op: 'text', x: p.titleX, y: p.keyV, text: spec.keyTitle, font: { size: p.keySize, weight: 600, caps: true }, color: c.accent });
  spec.key.slice(0, 8).forEach((k, i) => {
    const sx = p.titleX + (i % 4) * p.swatchPitchX, sy = p.swatchV + Math.floor(i / 4) * p.swatchPitchY;
    L.ops.push({ op: 'swatch', x: sx, y: sy, size: p.swatchSize, color: k.color, pattern: k.pattern, radius: p.swatchRadius });
    L.ops.push({ op: 'text', x: sx + p.swatchSize + 2, y: sy + p.swatchSize * 0.69, text: k.label, font: { size: p.swatchName }, color: c.ink });
  });
  L.ops.push({ op: 'text', x: p.titleX, y: p.captionV, text: spec.keyCaption, font: { size: p.captionSize, italic: true }, color: c.ink2 });
  const lf: FontSpec = { size: p.linkSize, weight: 600, caps: true };
  const mark = state.bookmark;
  const row = spec.rows.find((r) => r.spread === mark);
  if (row && mark > 2 && mark <= state.lastSpread) {
    const t = `${spec.continueLabel} ${row.n ?? ''}, ${row.title}`.replace(' ,', ',');
    const w = m.width(t, lf);
    L.ops.push({ op: 'text', x: p.titleX, y: p.linkV, text: t, font: lf, color: c.accent });
    L.ops.push({ op: 'line', x0: p.titleX, y0: p.linkV + 1, x1: p.titleX + w, y1: p.linkV + 1, width: 0.25, color: c.accent });
    region(L, 'goto:bookmark', 'link', rect(p.titleX - 1, p.linkV - 4.5, p.titleX + w + 1, p.linkV + 2), `goto:${mark}`, t);
  }
  const rw = m.width(spec.resetLabel, lf);
  L.ops.push({ op: 'text', x: p.resetRight, y: p.linkV, text: spec.resetLabel, font: lf, color: c.accent, align: 'right' });
  L.ops.push({ op: 'line', x0: p.resetRight - rw, y0: p.linkV + 1, x1: p.resetRight, y1: p.linkV + 1, width: 0.25, color: c.accent });
  region(L, 'reset', 'button', rect(p.resetRight - rw - 1, p.linkV - 4.5, p.resetRight + 1, p.linkV + 2), 'reset', spec.resetLabel);
  read(L, 'contents', rect(16, 24, 176, 184), spec.rows.map((r) => `${r.n ?? ''} ${r.title} ${r.page}`).join('. '));
  read(L, 'key', rect(16, 186, 176, 236), spec.key.map((k) => k.label).join(', '));
  return L;
}

/** Lays out one page. Back-matter spreads flow across both pages; their flows are cached by content object. */
export function layoutPage(spec: PageSpec, k: number, side: Side, state: PageState, P: LayoutParams, m: Measurer): PageLayout {
  switch (spec.kind) {
    case 'blank': {
      const L = newLayout();
      runningHead(L, side, spec.head, spec.folio, P);
      return L;
    }
    case 'title': return titlePage(spec, P, m);
    case 'contents': return contentsPage(spec, state, P, m);
    case 'lesson-left': return lessonLeft(spec, k, state, P, m);
    case 'lesson-right': return lessonRight(spec, k, state, P, m);
    case 'index': return layoutIndex(spec, k, state, P, m);
    case 'quiz': return layoutQuiz(spec, k, state, P, m);
    case 'sources': return layoutSources(spec, k, state, P, m);
  }
}

export function layoutSpread(pages: SpreadPages, k: number, state: PageState, P: LayoutParams, m: Measurer): { left: PageLayout; right: PageLayout } {
  return { left: layoutPage(pages.left, k, 'left', state, P, m), right: layoutPage(pages.right, k, 'right', state, P, m) };
}
