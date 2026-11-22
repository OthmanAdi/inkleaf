import { describe, expect, it } from 'vitest';
import type { FigureModule } from '../contracts';
import type { ContentsPageSpec, GlossaryPageSpec, LessonFigurePageSpec, LessonTextPageSpec, QuizPageSpec, SourcesPageSpec, TitlePageSpec } from './pages';
import { lessonSpec, worldManifest } from './test-fakes';
import { loadWorld, WorldError } from './world';

const fig: FigureModule = () => ({ update: () => {}, glowObjects: () => [] });
const figures = { ramp: fig, spring: fig };

describe('loadWorld', () => {
  it('builds the spread map with folios, hashes and special spreads', () => {
    const w = loadWorld(worldManifest(), figures);
    expect(w.spreads.map((s) => `${s.k}:${s.kind}:${s.hash}`)).toEqual(['0:cover:', '1:contents:#contents', '2:lesson:#spread-1', '3:lesson:#spread-2', '4:quiz:#quiz', '5:glossary:#index', '6:sources:#sources']);
    expect(w.spreads[2]!.folios).toEqual([4, 5]);
    expect(w.spreads[2]!.figure).toBe(fig);
    expect(w.lastSpread).toBe(6);
    expect(w.firstLessonSpread).toBe(2);
    expect(w.special).toEqual({ contents: 1, quiz: 4, glossary: 5, sources: 6 });
    expect(w.lessonSpread(2)).toBe(3);
    expect(w.pageState.bookmark).toBe(2);
    expect(w.pages[0]).toBeNull();
  });

  it('throws one readable error listing every problem', () => {
    const bad = worldManifest({
      theme: { ...worldManifest().theme, ink: 'navy' },
      spreads: [{ kind: 'contents' }, { kind: 'contents' }, { kind: 'lesson', lesson: lessonSpec({ figureModule: 'nope', predict: { question: 'q', options: ['a', 'b'], answer: 4 } }) }],
    });
    let err: unknown;
    try {
      loadWorld(bad, figures);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(WorldError);
    const msg = (err as Error).message;
    expect(msg).toMatch(/the world "demo" has 4 problems to fix/);
    expect(msg).toContain('theme.ink: "navy" must be a #rrggbb colour');
    expect(msg).toContain('spreads[1]: a book has at most one contents spread');
    expect(msg).toContain('predict.answer');
    expect(msg).toContain('no figure module named "nope"');
    expect((err as WorldError).problems.length).toBeGreaterThanOrEqual(4);
  });

  it('requires figure modules when the book has lessons', () => {
    expect(() => loadWorld(worldManifest(), {})).toThrow(/no figure modules were given/);
  });
});

describe('page specs', () => {
  const w = loadWorld(worldManifest(), figures);

  it('maps the contents spread to a title page and a contents list', () => {
    const left = w.page(1, 'left') as TitlePageSpec;
    expect(left).toMatchObject({ kind: 'title', folio: null, head: null, kicker: 'A pop-up book about energy', title: 'Where Energy Goes', tagline: 'Ten small experiments', plate: 'ramp' });
    expect(left.howTo).toHaveLength(5);
    const right = w.page(1, 'right') as ContentsPageSpec;
    expect(right.folio).toBe(3);
    expect(right.entries.map((e) => `${e.n ?? '-'} ${e.title} p${e.folio} ${e.action} ${e.group}`)).toEqual([
      '1 Up and down p4 goto:2 lesson', '2 Stretch p6 goto:3 lesson', '- Quiz p8 goto:4 back', '- Index p10 goto:5 back', '- Sources p12 goto:6 back',
    ]);
    expect(right.key.map((q) => q.id)).toEqual(['kinetic', 'thermal']);
    expect(right.resume[3]).toBe('Continue at lesson 2, Stretch');
    expect(right.resetAction).toBe('reset');
    expect(right.resumeAction(5)).toBe('goto:5');
  });

  it('maps a lesson to its text page and figure page', () => {
    const left = w.page(2, 'left') as LessonTextPageSpec;
    expect(left).toMatchObject({ kind: 'lesson-text', folio: 4, head: 'Lesson 1 · Up and down', kicker: 'Lesson 1', challenge: 'Make it reach the flag.' });
    expect(left.predict.options.map((o) => o.action)).toEqual(['predict:0', 'predict:1']);
    expect(left.flap.action).toBe('flap');
    expect(left.stamp).toEqual({ cu: 31, cv: 194, r: 13 });
    expect(left.margin).toEqual({ u0: 12, v0: 20, u1: 52, v1: 180 });
    const right = w.page(2, 'right') as LessonFigurePageSpec;
    expect(right).toMatchObject({ kind: 'lesson-figure', folio: 5, head: 'Where Energy Goes', caption: 'Fig. 1  Ball on a track', hint: 'Drag the ball up, then let go.' });
    expect(right.switches[0]!.options.map((o) => o.action)).toEqual(['switch:friction:off', 'switch:friction:on']);
    expect((w.page(3, 'right') as LessonFigurePageSpec).caption).toBe('Fig. 2 A spring');
  });

  it('splits the quiz over both pages and links answers to their lessons', () => {
    const left = w.page(4, 'left') as QuizPageSpec;
    const right = w.page(4, 'right') as QuizPageSpec;
    expect(left.questions.map((q) => q.number)).toEqual([1, 2]);
    expect(right.questions.map((q) => q.number)).toEqual([3]);
    expect(left.total).toBe(3);
    expect(left.questions[0]!.options.map((o) => o.action)).toEqual(['quiz:0:0', 'quiz:0:1', 'quiz:0:2']);
    expect(left.questions[0]!.flapAction).toBe('quiz-flap:0');
    expect(left.questions[1]!.lesson).toEqual({ n: 2, action: 'goto:3' });
    expect(right.questions[0]!.lesson).toBeUndefined();
  });

  it('sorts the index and links each page number to its lesson', () => {
    const g = w.page(5, 'left') as GlossaryPageSpec;
    expect(g.entries.map((e) => `${e.letter} ${e.term}`)).toEqual(['E elastic', 'K kinetic store', 'T thermal store']);
    expect(g.entries[2]!.pages).toEqual([{ folio: 4, action: 'goto:2' }, { folio: 6, action: 'goto:3' }]);
    expect(g.entries[1]!.swatch).toBe('#2f7bff');
    expect(g.entries[0]!.swatch).toBeUndefined();
    expect((w.page(5, 'right') as GlossaryPageSpec).part).toBe('right');
  });

  it('lists sources with their host and the lessons that cite them, and a colophon', () => {
    const s = w.page(6, 'right') as SourcesPageSpec;
    expect(s.entries.map((e) => `${e.n} ${e.host} ${e.lessons.join(',')} ${e.action}`)).toEqual(['1 example.org 1,2 source:1', '2 example.com 2 source:2']);
    expect(s.colophon?.book).toBe('Where Energy Goes');
    expect((w.page(6, 'left') as SourcesPageSpec).colophon).toBeUndefined();
  });
});
