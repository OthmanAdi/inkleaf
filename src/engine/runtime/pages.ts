/**
 * Page specs: what each page of the book prints, mapped from the world manifest. The book's typography engine lays
 * these out (fonts, wrapping, column fitting) and reports hit regions whose `action` strings come from here. Live
 * marks (stamps, ticks, lifted flaps, the bookmark, quiz picks) are read from `PageState` when a page repaints.
 */
import type { Side } from '../contracts';
import type { FormulaSpec, Quantity, WorldManifest } from '../world/types';
import { formatAction } from './actions';
import type { SpreadInfo, SpreadKind } from './types';

/** Fixed places on the lesson text page (page mm), shared by the page painter and the runtime's ink layer. */
export const LESSON_TEMPLATE = {
  margin: { u0: 12, v0: 20, u1: 52, v1: 180 },
  stamp: { cu: 31, cv: 194, r: 13 },
  printRect: { u: 4, v: 16, w: 180, h: 200 },
} as const;

export interface PageLabels {
  contents: string;
  howToTitle: string;
  howTo: readonly string[];
  keyTitle: string;
  keyCaption: string;
  resume: string;
  reset: string;
  keyWords: string;
  predict: string;
  challenge: string;
  flapLine: string;
  flapSub: string;
  flapHint: string;
  fig: string;
  lesson: string;
  index: { kicker: string; title: string; intro: string };
  quiz: { kicker: string; title: string; intro: string; answers: string; answersSub: string; answer: string; score: string; of: string; right: string; instruction: string; flapHint: string };
  sources: { kicker: string; title: string; intro: string };
  colophon: { title: string; lines: readonly string[] };
}

export const DEFAULT_LABELS: PageLabels = {
  contents: 'Contents',
  howToTitle: 'How to use this book',
  howTo: [
    'Predict first: tick the answer you expect.',
    'Test it on the model: tap, drag and switch.',
    'Lift the flap to see why.',
    'Meet the challenge to earn a stamp.',
    'Press play for a short guided tour.',
  ],
  keyTitle: 'The jars in this book',
  keyCaption: 'Each jar holds one kind of store; its colour and pattern stay the same on every page.',
  resume: 'Continue at',
  reset: 'Start again',
  keyWords: 'Key words',
  predict: 'Predict',
  challenge: 'Challenge',
  flapLine: 'Predict first, then lift',
  flapSub: 'The reason is under this card.',
  flapHint: 'lift here',
  fig: 'Fig.',
  lesson: 'Lesson',
  index: { kicker: 'Key words and where to find them', title: 'Index', intro: 'Every key word in the book, with the pages that use it. Tap a page number to go there.' },
  quiz: {
    kicker: 'Check what you know', title: 'Quiz', intro: 'Tick one answer for each question, then lift its flap to check.',
    answers: 'Answers', answersSub: 'under the flaps', answer: 'Answer', score: 'Score', of: 'of', right: 'right',
    instruction: 'Lift every flap to see your score.', flapHint: 'lift to check',
  },
  sources: { kicker: 'Where the numbers come from', title: 'Sources', intro: 'Every value in the book comes from one of these sources; each link was opened on the date shown.' },
  colophon: { title: 'Colophon', lines: ['Made with inkleaf, a three.js engine for pop-up books.', 'Set in Source Serif 4 and Caveat.'] },
};

interface PageBase {
  spread: number;
  side: Side;
  /** Printed page number, or null. */
  folio: number | null;
  /** Running head; null hides the head and its rule. */
  head: string | null;
}

export interface TitlePageSpec extends PageBase {
  kind: 'title';
  kicker: string;
  title: string;
  tagline: string;
  /** Figure module drawn as the plate miniature. */
  plate?: string;
  howToTitle: string;
  howTo: readonly string[];
}

export interface ContentsEntry {
  spread: number;
  /** Lesson number for lesson rows. */
  n?: number;
  title: string;
  folio: number;
  group: 'lesson' | 'back';
  action: string;
}

export interface ContentsPageSpec extends PageBase {
  kind: 'contents';
  title: string;
  entries: readonly ContentsEntry[];
  keyTitle: string;
  key: readonly { id: string; label: string; color: string; pattern?: Quantity['pattern'] }[];
  keyCaption: string;
  /** Spread -> "Continue at ..." text; shown for `PageState.bookmark` when it is past the first lesson. */
  resume: Readonly<Record<number, string>>;
  firstLessonSpread: number;
  resumeAction: (spread: number) => string;
  resetLabel: string;
  resetAction: string;
}

export interface LessonTextPageSpec extends PageBase {
  kind: 'lesson-text';
  n: number;
  kicker: string;
  title: string;
  intro: readonly string[];
  formula?: FormulaSpec;
  keyWordsTitle: string;
  keyWords: readonly { term: string; def: string }[];
  predictTitle: string;
  predict: { question: string; options: readonly { label: string; action: string }[] };
  flap: { title: string; text: string; action: string; face: { kicker: string; line: string; sub: string; hint: string } };
  challengeTitle: string;
  challenge: string;
  stamp: { cu: number; cv: number; r: number };
  margin: { u0: number; v0: number; u1: number; v1: number };
}

export interface LessonFigurePageSpec extends PageBase {
  kind: 'lesson-figure';
  n: number;
  caption: string;
  hint: string;
  switches: readonly { id: string; label: string; options: readonly { label: string; action: string }[] }[];
  /** Where the print of the 3D figure lands, page mm (left blank by the painter). */
  printRect: { u: number; v: number; w: number; h: number };
}

export interface IndexEntry {
  term: string;
  def: string;
  /** Upper-case first letter for the letter headings. */
  letter: string;
  pages: readonly { folio: number; action: string }[];
  /** Goes to the first lesson using the term. */
  action: string | null;
  /** Store colour when the term names a quantity. */
  swatch?: string;
}

export interface GlossaryPageSpec extends PageBase {
  kind: 'glossary';
  /** The four columns flow over both pages: each page gets the full list and which half it prints. */
  part: Side;
  kicker: string;
  title: string;
  intro: string;
  entries: readonly IndexEntry[];
}

export interface QuizItem {
  /** Index over the whole quiz (0-based). */
  q: number;
  number: number;
  question: string;
  options: readonly { label: string; action: string }[];
  answer: number;
  explain: string;
  flapAction: string;
  /** Link printed under the flap. */
  lesson?: { n: number; action: string };
}

export interface QuizPageSpec extends PageBase {
  kind: 'quiz';
  part: Side;
  kicker: string;
  title: string;
  intro: string;
  labels: PageLabels['quiz'];
  /** Questions printed on this page. */
  questions: readonly QuizItem[];
  /** Number of questions in the whole quiz (score "of N"). */
  total: number;
}

export interface SourceItem {
  n: number;
  title: string;
  publisher: string;
  url: string;
  host: string;
  checked: string;
  supports?: string;
  lessons: readonly number[];
  action: string;
}

export interface SourcesPageSpec extends PageBase {
  kind: 'sources';
  part: Side;
  kicker: string;
  title: string;
  intro: string;
  entries: readonly SourceItem[];
  colophon?: { title: string; book: string; lines: readonly string[] };
}

export interface BlankPageSpec extends PageBase {
  kind: 'blank';
}

export type PageSpec =
  | TitlePageSpec | ContentsPageSpec | LessonTextPageSpec | LessonFigurePageSpec | GlossaryPageSpec | QuizPageSpec
  | SourcesPageSpec | BlankPageSpec;

export interface SpreadPages {
  spread: number;
  kind: SpreadKind;
  left: PageSpec;
  right: PageSpec;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^(www|assets|data)\./, '');
  } catch {
    return '';
  }
};

const sortKey = (s: string) => s.toLowerCase().replace(/-/g, ' ');

function captionOf(fig: string, n: number, caption: string): string {
  return /^fig\.?\s*\d/i.test(caption.trim()) ? caption.trim() : `${fig} ${n}  ${caption.trim()}`;
}

function quantityFor(term: string, qs: readonly Quantity[]): Quantity | undefined {
  const t = term.toLowerCase().trim();
  return qs.find((q) => {
    const l = q.label.toLowerCase();
    return t === q.id || t === l || t === `${l} store` || t === `${q.id} store`;
  });
}

/** Maps a manifest and its spread map to one `SpreadPages` per spread (index 0 is the cover: no pages). */
export function buildPages(w: WorldManifest, spreads: readonly SpreadInfo[], labels: PageLabels = DEFAULT_LABELS): (SpreadPages | null)[] {
  const lessonSpread = new Map<number, number>();
  for (const s of spreads) if (s.kind === 'lesson' && s.lesson) lessonSpread.set(s.lesson.n, s.k);
  const firstLesson = spreads.find((s) => s.kind === 'lesson')?.k ?? 1;
  const goto = (k: number) => formatAction({ type: 'goto', spread: k });
  const blank = (spread: number, side: Side, folio: number | null, head: string | null): BlankPageSpec => ({ kind: 'blank', spread, side, folio, head });

  const contentsEntries: ContentsEntry[] = spreads
    .filter((s) => s.kind === 'lesson' || s.kind === 'quiz' || s.kind === 'glossary' || s.kind === 'sources')
    .map((s) => ({ spread: s.k, n: s.lesson?.n, title: s.title, folio: s.folios[0], group: s.kind === 'lesson' ? 'lesson' : 'back', action: goto(s.k) }));
  const resume: Record<number, string> = {};
  for (const s of spreads) {
    if (s.kind === 'cover' || s.kind === 'contents') continue;
    resume[s.k] = s.kind === 'lesson' && s.lesson ? `${labels.resume} ${labels.lesson.toLowerCase()} ${s.lesson.n}, ${s.title}` : `${labels.resume} ${s.title.toLowerCase()}`;
  }

  const index: IndexEntry[] = [...w.glossary]
    .sort((a, b) => sortKey(a.term).localeCompare(sortKey(b.term)))
    .map((g) => {
      const ks = g.lessons.map((n) => lessonSpread.get(n)).filter((k): k is number => k !== undefined);
      return {
        term: g.term, def: g.def, letter: (g.term.trim()[0] ?? '').toUpperCase(),
        pages: ks.map((k) => ({ folio: 2 * k, action: goto(k) })),
        action: ks.length ? goto(ks[0]!) : null,
        swatch: quantityFor(g.term, w.quantities)?.color,
      };
    });

  const sourceLessons = new Map<number, number[]>();
  for (const s of spreads) for (const n of s.lesson?.sources ?? []) {
    const list = sourceLessons.get(n) ?? [];
    if (s.lesson && !list.includes(s.lesson.n)) list.push(s.lesson.n);
    sourceLessons.set(n, list);
  }
  const sources: SourceItem[] = w.sources.map((s) => ({
    n: s.n, title: s.title, publisher: s.publisher, url: s.url, host: hostOf(s.url), checked: s.checked, supports: s.supports,
    lessons: (sourceLessons.get(s.n) ?? []).sort((a, b) => a - b), action: formatAction({ type: 'source', n: s.n }),
  }));

  return spreads.map((info): SpreadPages | null => {
    const k = info.k;
    const [fl, fr] = info.folios;
    switch (info.kind) {
      case 'cover':
        return null;
      case 'contents': {
        const spec = w.spreads[info.index];
        const howTo = spec?.kind === 'contents' && spec.howTo ? spec.howTo.split('\n').map((l) => l.trim()).filter(Boolean) : labels.howTo;
        return {
          spread: k, kind: info.kind,
          left: {
            kind: 'title', spread: k, side: 'left', folio: null, head: null,
            kicker: w.subtitle ?? '', title: w.title, tagline: w.cover.subtitle, plate: w.cover.plate, howToTitle: labels.howToTitle, howTo,
          },
          right: {
            kind: 'contents', spread: k, side: 'right', folio: fr, head: labels.contents, title: labels.contents,
            entries: contentsEntries, keyTitle: labels.keyTitle,
            key: w.quantities.map((q) => ({ id: q.id, label: q.label, color: q.color, pattern: q.pattern })),
            keyCaption: labels.keyCaption, resume, firstLessonSpread: firstLesson, resumeAction: goto,
            resetLabel: labels.reset, resetAction: formatAction({ type: 'reset' }),
          },
        };
      }
      case 'lesson': {
        const L = info.lesson!;
        return {
          spread: k, kind: info.kind,
          left: {
            kind: 'lesson-text', spread: k, side: 'left', folio: fl, head: `${labels.lesson} ${L.n} · ${L.title}`,
            n: L.n, kicker: L.kicker, title: L.title, intro: L.intro, formula: L.formula,
            keyWordsTitle: labels.keyWords, keyWords: L.keyWords,
            predictTitle: labels.predict,
            predict: { question: L.predict.question, options: L.predict.options.map((label, i) => ({ label, action: formatAction({ type: 'predict', index: i }) })) },
            flap: { title: L.flap.title, text: L.flap.text, action: formatAction({ type: 'flap' }), face: { kicker: L.flap.title, line: labels.flapLine, sub: labels.flapSub, hint: labels.flapHint } },
            challengeTitle: labels.challenge, challenge: L.challenge.text,
            stamp: { ...LESSON_TEMPLATE.stamp }, margin: { ...LESSON_TEMPLATE.margin },
          },
          right: {
            kind: 'lesson-figure', spread: k, side: 'right', folio: fr, head: w.title,
            n: L.n, caption: captionOf(labels.fig, L.n, L.figure.caption), hint: L.figure.instruction,
            switches: (L.figure.switches ?? []).map((sw) => ({ id: sw.id, label: sw.label, options: sw.options.map((o) => ({ label: o, action: formatAction({ type: 'switch', id: sw.id, value: o }) })) })),
            printRect: { ...LESSON_TEMPLATE.printRect },
          },
        };
      }
      case 'glossary': {
        const base = { kind: 'glossary' as const, spread: k, kicker: labels.index.kicker, title: labels.index.title, intro: labels.index.intro, entries: index };
        return { spread: k, kind: info.kind, left: { ...base, side: 'left', part: 'left', folio: fl, head: labels.index.title }, right: { ...base, side: 'right', part: 'right', folio: fr, head: labels.index.title } };
      }
      case 'quiz': {
        const spec = w.spreads[info.index];
        const qs = spec?.kind === 'quiz' ? spec.questions : [];
        const items: QuizItem[] = qs.map((q, i) => {
          const ls = q.lesson !== undefined ? lessonSpread.get(q.lesson) : undefined;
          return {
            q: i, number: i + 1, question: q.question, answer: q.answer, explain: q.explain,
            options: q.options.map((label, o) => ({ label, action: formatAction({ type: 'quiz', q: i, option: o }) })),
            flapAction: formatAction({ type: 'quiz-flap', q: i }),
            lesson: q.lesson !== undefined && ls !== undefined ? { n: q.lesson, action: goto(ls) } : undefined,
          };
        });
        const half = Math.ceil(items.length / 2);
        const base = { kind: 'quiz' as const, spread: k, kicker: labels.quiz.kicker, title: labels.quiz.title, intro: labels.quiz.intro, labels: labels.quiz, total: items.length };
        return {
          spread: k, kind: info.kind,
          left: { ...base, side: 'left', part: 'left', folio: fl, head: labels.quiz.title, questions: items.slice(0, half) },
          right: { ...base, side: 'right', part: 'right', folio: fr, head: labels.quiz.title, questions: items.slice(half) },
        };
      }
      case 'sources': {
        const base = { kind: 'sources' as const, spread: k, kicker: labels.sources.kicker, title: labels.sources.title, intro: labels.sources.intro, entries: sources };
        return {
          spread: k, kind: info.kind,
          left: { ...base, side: 'left', part: 'left', folio: fl, head: labels.sources.title },
          right: { ...base, side: 'right', part: 'right', folio: fr, head: labels.sources.title, colophon: { title: labels.colophon.title, book: w.title, lines: labels.colophon.lines } },
        };
      }
      default:
        return { spread: k, kind: info.kind, left: blank(k, 'left', fl, null), right: blank(k, 'right', fr, null) };
    }
  });
}
