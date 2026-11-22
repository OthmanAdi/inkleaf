import { describe, expect, it } from 'vitest';
import type { LessonSpec, WorldManifest } from './types';
import { validateWorld } from './validate';

const lesson = (over: Partial<LessonSpec> = {}): LessonSpec => ({
  id: 'the-swing',
  n: 1,
  title: 'The swing',
  kicker: 'Lesson 1',
  intro: ['A swing trades height for speed.'],
  keyWords: [{ term: 'kinetic store', def: 'Energy held by a moving object.' }],
  predict: { question: 'Where is it fastest?', options: ['Top', 'Bottom'], answer: 1 },
  flap: { title: 'Why?', text: 'At the bottom the gravitational store is smallest.' },
  challenge: { text: 'Release from 0.10 m.' },
  figure: { caption: 'Fig. 1 A swing', instruction: 'Drag the bob, then let go.', switches: [{ id: 'drag', label: 'Air drag', options: ['off', 'on'], value: 'off' }] },
  a11y: 'A pendulum on a frame.',
  tour: [],
  sources: [1],
  figureModule: 'swing',
  ...over,
});

const world = (over: Partial<WorldManifest> = {}): WorldManifest => ({
  id: 'demo',
  title: 'Demo',
  lang: 'en',
  theme: { cloth: '#d9a52b', edge: '#d4b04a', ribbon: '#1c2a5a', ink: '#1c2433', accent: '#9a3b2a', paper: '#f4efe2', hand: '#273463', pad: '#8fa89b', desk: 'oak' },
  quantities: [{ id: 'kinetic', label: 'Kinetic', color: '#2f7bff' }],
  pathways: [{ id: 'mechanical', label: 'Mechanically' }],
  cover: { title: 'Demo', subtitle: 'a test' },
  spreads: [{ kind: 'contents' }, { kind: 'lesson', lesson: lesson() }],
  glossary: [{ term: 'kinetic store', def: 'x', lessons: [1] }],
  sources: [{ n: 1, title: 'S', publisher: 'P', url: 'https://example.org', checked: '2026-11-22' }],
  ...over,
});

describe('validateWorld', () => {
  it('accepts a well-formed world', () => {
    expect(validateWorld(world(), ['swing'])).toEqual([]);
  });

  it('reports actionable problems', () => {
    const bad = world({
      theme: { ...world().theme, cloth: 'yellow' },
      spreads: [{ kind: 'contents' }, { kind: 'lesson', lesson: lesson({ predict: { question: 'q', options: ['a', 'b'], answer: 5 }, sources: [9], figureModule: 'nope' }) }],
    });
    const msgs = validateWorld(bad, ['swing']).map((p) => `${p.path}: ${p.message}`);
    expect(msgs.some((m) => m.startsWith('theme.cloth'))).toBe(true);
    expect(msgs.some((m) => m.includes('predict.answer'))).toBe(true);
    expect(msgs.some((m) => m.includes('source 9'))).toBe(true);
    expect(msgs.some((m) => m.includes('no figure module named "nope"'))).toBe(true);
  });

  it('warns when a key word is missing from the glossary', () => {
    const w = world({ glossary: [] });
    expect(validateWorld(w).some((p) => p.severity === 'warning' && p.message.includes('not in the glossary'))).toBe(true);
  });
});
