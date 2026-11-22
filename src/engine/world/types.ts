/**
 * The world manifest: everything an agent writes to make a new inkleaf book. Text and structure live here;
 * each lesson's 3D figure is a small module (`build`) that uses the engine's kits.
 */
import type { ParamValue } from '../core/registry';

/** A quantity a book tracks in stores and flows: an energy store, a carbon pool, money in an account... */
export interface Quantity {
  id: string;
  label: string;
  /** Short word for tight places, for example "kinetic". */
  short?: string;
  color: string;
  /** Hatch pattern drawn on its tag so the store reads without colour. */
  pattern?: 'chevrons' | 'waves' | 'zigzag' | 'dots' | 'grid' | 'rings' | 'diagonal' | 'crosses' | 'solid';
  unit?: string;
  /** One sentence for the magnifier card. */
  define?: string;
}

/** A way a quantity moves between stores: mechanical work, an electric current, heating, radiation... */
export interface Pathway {
  id: string;
  label: string;
  style?: 'beads' | 'dashes' | 'wave' | 'sparks';
}

export interface Theme {
  /** Cover cloth colour. */
  cloth: string;
  /** Spine and corner cloth when it differs from the cover. */
  spine?: string;
  /** Page edge colour (gilt, coloured or plain). */
  edge: string;
  ribbon: string;
  /** Printed ink colour for text and drawings. */
  ink: string;
  /** Accent for kickers, labels and page marks. */
  accent: string;
  paper: string;
  /** Handwriting colour for margin working. */
  hand: string;
  pad: string;
  desk: 'oak' | 'walnut' | 'birch' | 'none';
  fonts?: { serif?: string; hand?: string };
}

export interface FormulaSpec {
  /** Plain text with `^` for superscript and `_` for subscript: `E_k = 1/2 m v^2`. */
  symbolic: string;
  words: string;
  units: string;
}

export interface Switch {
  id: string;
  label: string;
  options: readonly string[];
  value: string;
}

export interface TourShot {
  /** A named camera intent the figure module understands, or explicit numbers in page millimetres. */
  cam: 'wide' | 'figure' | 'text' | { pos: readonly [number, number, number]; look: readonly [number, number, number] } | { follow: string };
  caption: string;
  /** Seconds this shot lasts. */
  hold?: number;
  /** An action name the figure module performs when the shot starts (`release`, `drop`, `heat`...). */
  act?: string;
}

export interface LensTerm {
  term: string;
  card: string;
}

export interface LessonSpec {
  id: string;
  n: number;
  title: string;
  kicker: string;
  intro: readonly string[];
  formula?: FormulaSpec;
  keyWords: readonly { term: string; def: string }[];
  predict: { question: string; options: readonly string[]; answer: number };
  flap: { title: string; text: string };
  challenge: { text: string };
  figure: { caption: string; instruction: string; switches?: readonly Switch[] };
  lensTerms?: readonly LensTerm[];
  a11y: string;
  tour: readonly TourShot[];
  sources?: readonly number[];
  /** Name of the figure module in the world's figure table. */
  figureModule: string;
}

export interface QuizQuestion {
  question: string;
  options: readonly string[];
  answer: number;
  explain: string;
  lesson?: number;
}

export interface GlossaryEntry {
  term: string;
  def: string;
  lessons: readonly number[];
}

export interface SourceEntry {
  n: number;
  title: string;
  publisher: string;
  url: string;
  checked: string;
  supports?: string;
}

export type SpreadSpec =
  | { kind: 'contents'; howTo?: string }
  | { kind: 'lesson'; lesson: LessonSpec }
  | { kind: 'quiz'; questions: readonly QuizQuestion[] }
  | { kind: 'glossary' }
  | { kind: 'sources' };

export interface CoverSpec {
  title: string;
  subtitle: string;
  /** Figure module drawn on the cover plate. */
  plate?: string;
  spineTitle?: string;
}

export interface WorldManifest {
  id: string;
  title: string;
  subtitle?: string;
  lang: string;
  theme: Theme;
  quantities: readonly Quantity[];
  pathways: readonly Pathway[];
  cover: CoverSpec;
  spreads: readonly SpreadSpec[];
  glossary: readonly GlossaryEntry[];
  sources: readonly SourceEntry[];
  /** Parameter overrides by entity id, applied as entities register. Paste the inspector's "Copy tune" here. */
  tune?: Readonly<Record<string, Readonly<Record<string, ParamValue>>>>;
}

export const defineWorld = (w: WorldManifest): WorldManifest => w;
