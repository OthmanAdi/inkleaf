/**
 * Maps a world manifest to printed pages: spread 1 is the title page and contents, lessons follow, then the index
 * (glossary), quiz and sources. Folios are 2k (left) and 2k + 1 (right).
 */
import type { WorldManifest } from '../../world/types';
import type { ContentsRow, IndexData, LessonContent, PageSpec, QuizData, SourcesData, SpreadPages } from './types';
import { shortHost } from './backmatter';

/** Interface words printed in the book; a world may replace any of them. */
export const BOOK_WORDS = {
  contents: 'Contents',
  howToTitle: 'Using this book',
  howTo: [
    'Choose an answer before you read on.',
    'Watch the drawing rise off the page.',
    'Touch the parts of the model to see what changes.',
    'Lift the card to check your thinking.',
    'Meet the challenge to earn the stamp.',
  ],
  keyTitle: 'The quantities in this book',
  keyCaption: 'Each colour follows one quantity from page to page.',
  continueLabel: 'Continue at lesson',
  resetLabel: 'Start again',
  pendingNote: 'not yet written',
  indexTitle: 'Index',
  indexKicker: 'Every term and the page that teaches it',
  indexIntro: 'Page numbers lead to the lesson where a word is first explained. Tap one to turn there.',
  quizTitle: 'Quiz',
  quizKicker: 'Check what you remember',
  quizIntro: 'Tick one answer for each question, then lift the card beside it to check.',
  answersLabel: 'Answers',
  answersNote: 'beneath the cards',
  scoreLabel: 'Score',
  scoreOf: 'of',
  scoreRight: 'correct',
  scoreInstruction: 'Lift every card, then count the ticks that match.',
  sourcesTitle: 'Sources',
  sourcesKicker: 'The references behind the numbers',
  sourcesIntro: 'Each value in this book was checked against one of these references.',
  colophonTitle: 'Colophon',
  colophon: [
    'Set in Source Serif 4, with notes in Caveat. Drawn and bound in three.js.',
    'Every figure in this book is a working model: change it, and the numbers follow.',
  ],
  copyright: 'Made with inkleaf',
  flapTitle: 'Why?',
};
export type BookWords = typeof BOOK_WORDS;

export function spreadPagesFromWorld(world: WorldManifest, words: Partial<BookWords> = {}): SpreadPages[] {
  const W = { ...BOOK_WORDS, ...words };
  const lessonSpread = new Map<number, number>();
  world.spreads.forEach((s, i) => {
    if (s.kind === 'lesson') lessonSpread.set(s.lesson.n, i + 1);
  });
  const spreadOfLesson = (n: number) => lessonSpread.get(n) ?? 2;
  const quantity = (term: string) => world.quantities.find((q) => q.label.toLowerCase() === term.toLowerCase() || q.id === term.toLowerCase());
  const rows: ContentsRow[] = [];
  world.spreads.forEach((s, i) => {
    const k = i + 1;
    if (s.kind === 'lesson') rows.push({ n: s.lesson.n, title: s.lesson.title, page: 2 * k, spread: k, available: true });
    else if (s.kind === 'glossary') rows.push({ title: W.indexTitle, page: 2 * k, spread: k, available: true, backMatter: true });
    else if (s.kind === 'quiz') rows.push({ title: W.quizTitle, page: 2 * k, spread: k, available: true, backMatter: true });
    else if (s.kind === 'sources') rows.push({ title: W.sourcesTitle, page: 2 * k, spread: k, available: true, backMatter: true });
  });
  return world.spreads.map((s, i): SpreadPages => {
    const k = i + 1;
    const fl = 2 * k, fr = 2 * k + 1;
    switch (s.kind) {
      case 'contents':
        return {
          left: {
            kind: 'title', kicker: world.cover.subtitle, title: world.title, tagline: world.subtitle ?? '',
            howToTitle: W.howToTitle, howTo: s.howTo ? s.howTo.split('\n').filter(Boolean) : W.howTo, copyright: W.copyright,
          },
          right: {
            kind: 'contents', head: W.contents, folio: fr, title: W.contents, rows, keyTitle: W.keyTitle,
            key: world.quantities.map((q) => ({ label: q.label, color: q.color, pattern: q.pattern })), keyCaption: W.keyCaption,
            continueLabel: W.continueLabel, resetLabel: W.resetLabel, pendingNote: W.pendingNote,
          },
        };
      case 'lesson': {
        const l = s.lesson;
        const content: LessonContent = {
          n: l.n, title: l.title, kicker: l.kicker || `Lesson ${l.n}`, intro: l.intro,
          formula: l.formula ? { symbolic: l.formula.symbolic, words: l.formula.words, units: l.formula.units } : undefined,
          keyWords: l.keyWords, predict: { question: l.predict.question, options: l.predict.options },
          flap: { title: l.flap.title || W.flapTitle, text: l.flap.text }, challenge: l.challenge,
          figure: { caption: l.figure.caption, instruction: l.figure.instruction, switches: l.figure.switches },
        };
        return {
          left: { kind: 'lesson-left', head: `Lesson ${l.n} · ${l.title}`, folio: fl, lesson: content },
          right: { kind: 'lesson-right', head: world.title, folio: fr, lesson: content },
        };
      }
      case 'glossary': {
        const data: IndexData = {
          kicker: W.indexKicker, title: W.indexTitle, intro: W.indexIntro,
          entries: world.glossary.map((g) => {
            const q = quantity(g.term);
            return { term: g.term, def: g.def, pages: g.lessons.map((n) => 2 * spreadOfLesson(n)), swatch: q ? { color: q.color, pattern: q.pattern } : undefined };
          }),
          lessonSpread: (folio) => Math.floor(folio / 2),
        };
        return { left: { kind: 'index', part: 'left', head: W.indexTitle, folio: fl, data }, right: { kind: 'index', part: 'right', head: W.indexTitle, folio: fr, data } };
      }
      case 'quiz': {
        const data: QuizData = {
          kicker: W.quizKicker, title: W.quizTitle, intro: W.quizIntro, answersLabel: W.answersLabel, answersNote: W.answersNote,
          questions: s.questions, scoreLabel: W.scoreLabel, scoreOf: W.scoreOf, scoreRight: W.scoreRight, instruction: W.scoreInstruction,
          lessonSpread: spreadOfLesson, bookTitle: world.title,
        };
        return { left: { kind: 'quiz', part: 'left', head: W.quizTitle, folio: fl, data }, right: { kind: 'quiz', part: 'right', head: W.quizTitle, folio: fr, data } };
      }
      case 'sources': {
        const data: SourcesData = {
          kicker: W.sourcesKicker, title: W.sourcesTitle, intro: W.sourcesIntro,
          entries: world.sources.map((src) => ({
            n: src.n, title: src.title, detail: src.publisher, url: src.url, host: shortHost(src.url),
            lessons: world.spreads.flatMap((sp) => (sp.kind === 'lesson' && sp.lesson.sources?.includes(src.n) ? [sp.lesson.n] : [])),
          })),
          colophon: { title: W.colophonTitle, paragraphs: W.colophon },
        };
        return { left: { kind: 'sources', part: 'left', head: W.sourcesTitle, folio: fl, data }, right: { kind: 'sources', part: 'right', head: W.sourcesTitle, folio: fr, data } };
      }
    }
  });
}

/** Placeholder spread: running heads and folios only. */
export function blankSpread(k: number, head?: string): SpreadPages {
  const left: PageSpec = { kind: 'blank', head, folio: 2 * k };
  const right: PageSpec = { kind: 'blank', head, folio: 2 * k + 1 };
  return { left, right };
}
