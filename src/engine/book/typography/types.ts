/**
 * Page specifications (what to print) and page layouts (where it lands). A layout is a display list in page
 * millimetres plus the hit regions, read regions and named anchors the rest of the engine needs.
 */
import type { PageRegion } from '../../contracts';

export type FontFamily = 'serif' | 'hand';

export interface FontSpec {
  size: number;
  weight?: number;
  italic?: boolean;
  family?: FontFamily;
  /** All small caps with 0.06 x size tracking. */
  caps?: boolean;
}

export interface Rect { u: number; v: number; w: number; h: number }

export interface ReadRegion extends Rect {
  id: string;
  /** Plain text of what is printed there (for the magnifier and the text version). */
  text?: string;
}

export type DrawOp =
  | { op: 'text'; x: number; y: number; text: string; font: FontSpec; color: string; align?: 'left' | 'center' | 'right'; rotate?: number }
  | { op: 'line'; x0: number; y0: number; x1: number; y1: number; width: number; color: string; dash?: readonly number[] }
  | { op: 'rect'; x: number; y: number; w: number; h: number; stroke?: string; width?: number; fill?: string; radius?: number; dash?: readonly number[] }
  | { op: 'circle'; x: number; y: number; r: number; stroke?: string; width?: number; fill?: string; dash?: readonly number[] }
  | { op: 'diamond'; x: number; y: number; r: number; color: string }
  | { op: 'dots'; x0: number; x1: number; y: number; step: number; size: number; color: string }
  | { op: 'swatch'; x: number; y: number; size: number; color: string; pattern?: string; radius?: number }
  | { op: 'image'; x: number; y: number; w: number; h: number; source: 'plate' }
  | { op: 'flap-face'; kind: 'lesson' | 'quiz'; x: number; y: number; w: number; h: number; n?: number; title?: string; main?: string; sub?: string; hand?: string }
  | { op: 'stamp'; x: number; y: number; r: number; n: number | string; press: number; label: string; rotate: number; seed: number; lines?: readonly { text: string; scale: number; y: number }[] }
  | { op: 'tick'; x: number; y: number; scale: number; color: string }
  | { op: 'mark'; x: number; y: number; r: number; color: string };

export interface PageLayout {
  ops: DrawOp[];
  regions: PageRegion[];
  reads: ReadRegion[];
  anchors: Record<string, Rect>;
}

// ------------------------------------------------------------------------------------------------ page content

export interface Formula {
  /** `E_k = 1/2 m v^2`: `_` subscript, `^` superscript, spaces between factors. */
  symbolic: string;
  words: string;
  units?: string;
}

export interface SwitchSpec { id: string; label: string; options: readonly string[]; value: string }

export interface LessonContent {
  n: number;
  title: string;
  kicker?: string;
  intro: readonly string[];
  formula?: Formula;
  keyWords: readonly { term: string; def: string }[];
  predict: { question: string; options: readonly string[] };
  flap: { title: string; text: string; main?: string; sub?: string; hand?: string };
  challenge: { text: string };
  figure: { caption: string; note?: string; instruction: string; switches?: readonly SwitchSpec[] };
}

export interface ContentsRow {
  n?: number;
  title: string;
  page: number;
  spread: number;
  available: boolean;
  backMatter?: boolean;
}

export interface KeyEntry { label: string; color: string; pattern?: string }

export interface IndexEntry {
  term: string;
  symbol?: string;
  /** Store colour when the term names a store (draws a swatch). */
  swatch?: { color: string; pattern?: string };
  /** Folios where the term is taught. */
  pages: readonly number[];
  def: string;
  seeAlso?: readonly string[];
}

export interface QuizItem {
  question: string;
  options: readonly string[];
  answer: number;
  explain: string;
  lesson?: number;
}

export interface SourceItem {
  n: number;
  title: string;
  detail?: string;
  host?: string;
  url?: string;
  lessons?: readonly number[];
  group?: string;
}

export interface IndexData { kicker: string; title: string; intro: string; entries: readonly IndexEntry[]; lessonSpread: (folio: number) => number }
export interface QuizData {
  kicker: string; title: string; intro: string; answersLabel: string; answersNote: string;
  questions: readonly QuizItem[]; scoreLabel: string; scoreOf: string; scoreRight: string; instruction: string;
  /** Printed small on the score stamp. */
  bookTitle?: string;
  /** Spread of a lesson number, for the "lesson N" links under each answer. */
  lessonSpread: (n: number) => number;
}
export interface SourcesData { kicker: string; title: string; intro: string; link?: { text: string; url: string }; entries: readonly SourceItem[]; colophon: { title: string; paragraphs: readonly string[] } }

export type PageSpec =
  | { kind: 'blank'; head?: string; folio?: number }
  | { kind: 'title'; kicker: string; title: string; tagline: string; howToTitle: string; howTo: readonly string[]; copyright: string }
  | { kind: 'contents'; head: string; folio: number; title: string; rows: readonly ContentsRow[]; keyTitle: string; key: readonly KeyEntry[]; keyCaption: string; continueLabel: string; resetLabel: string; pendingNote?: string }
  | { kind: 'lesson-left'; head: string; folio: number; lesson: LessonContent }
  | { kind: 'lesson-right'; head: string; folio: number; lesson: LessonContent }
  | { kind: 'index'; part: 'left' | 'right'; head: string; folio: number; data: IndexData }
  | { kind: 'quiz'; part: 'left' | 'right'; head: string; folio: number; data: QuizData }
  | { kind: 'sources'; part: 'left' | 'right'; head: string; folio: number; data: SourcesData };

export interface SpreadPages { left: PageSpec; right: PageSpec }

/** Dynamic state the printed pages show: flaps printed open, quiz picks, stamps, bookmark. */
export interface PageState {
  /** Flap ids (`flap`, `quiz-flap:3`) whose card is lifted, per spread. */
  printedOpen: ReadonlySet<string>;
  quizPicks: Readonly<Record<number, number>>;
  quizOpen: Readonly<Record<number, boolean>>;
  /** Lesson number -> stamp press (0..1). */
  stamps: Readonly<Record<number, number>>;
  /** Spread the reader last reached (2 = the first lesson). */
  bookmark: number;
  /** Last spread that has content. */
  lastSpread: number;
}

export const emptyPageState = (): PageState => ({ printedOpen: new Set(), quizPicks: {}, quizOpen: {}, stamps: {}, bookmark: 2, lastSpread: 14 });
