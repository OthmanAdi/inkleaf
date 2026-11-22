import { describe, expect, it } from 'vitest';
import { formatAction, parseAction, parseDeepLink, spreadHash, type PageAction } from './actions';

describe('page action strings', () => {
  it('parses every action the pages emit', () => {
    expect(parseAction('goto:5')).toEqual({ type: 'goto', spread: 5 });
    expect(parseAction('predict:1')).toEqual({ type: 'predict', index: 1 });
    expect(parseAction('switch:friction:on')).toEqual({ type: 'switch', id: 'friction', value: 'on' });
    expect(parseAction('switch:ball:table tennis')).toEqual({ type: 'switch', id: 'ball', value: 'table tennis' });
    expect(parseAction('flap')).toEqual({ type: 'flap' });
    expect(parseAction('reset')).toEqual({ type: 'reset' });
    expect(parseAction('quiz:3:2')).toEqual({ type: 'quiz', q: 3, option: 2 });
    expect(parseAction('quiz-flap:11')).toEqual({ type: 'quiz-flap', q: 11 });
    expect(parseAction('source:42')).toEqual({ type: 'source', n: 42 });
    expect(parseAction('link:https://example.org/a:b?c=1')).toEqual({ type: 'link', url: 'https://example.org/a:b?c=1' });
  });

  it('rejects malformed actions', () => {
    for (const s of ['', 'goto:', 'goto:x', 'goto:-1', 'predict:1.5', 'switch:only', 'switch::on', 'quiz:1', 'quiz:1:2:3', 'quiz-flap:a', 'link:javascript:alert(1)', 'unknown:1', 'flapx'])
      expect(parseAction(s), s).toBeNull();
  });

  it('formats what it parses', () => {
    const all: PageAction[] = [
      { type: 'goto', spread: 3 }, { type: 'reset' }, { type: 'predict', index: 0 }, { type: 'switch', id: 'ball', value: 'basketball' },
      { type: 'flap' }, { type: 'quiz', q: 0, option: 3 }, { type: 'quiz-flap', q: 7 }, { type: 'source', n: 9 }, { type: 'link', url: 'https://x.org' },
    ];
    for (const a of all) expect(parseAction(formatAction(a))).toEqual(a);
  });
});

describe('deep links', () => {
  const world = {
    lastSpread: 14,
    lessonSpread: (n: number) => (n >= 1 && n <= 10 ? n + 1 : undefined),
    special: { contents: 1, glossary: 12, quiz: 13, sources: 14 },
  };
  const link = (hash: string, search = '') => parseDeepLink({ hash, search }, world);

  it('maps #spread-N to lesson N and names to the back matter', () => {
    expect(link('#spread-1')).toBe(2);
    expect(link('#spread-10')).toBe(11);
    expect(link('#contents')).toBe(1);
    expect(link('#index')).toBe(12);
    expect(link('#glossary')).toBe(12);
    expect(link('#quiz')).toBe(13);
    expect(link('#SOURCES')).toBe(14);
  });

  it('reads ?k=N as a spread number and ignores what does not exist', () => {
    expect(link('', '?k=7')).toBe(7);
    expect(link('', '?k=0')).toBeNull();
    expect(link('', '?k=15')).toBeNull();
    expect(link('#spread-11')).toBeNull();
    expect(link('#spread-11', '?k=3')).toBe(3);
    expect(link('#nowhere')).toBeNull();
    expect(link('')).toBeNull();
  });

  it('gives each spread its way back', () => {
    expect(spreadHash(3, { kind: 'lesson', n: 2 })).toBe('#spread-2');
    expect(spreadHash(1, { kind: 'contents' })).toBe('#contents');
    expect(spreadHash(12, { kind: 'glossary' })).toBe('#index');
    expect(spreadHash(0, { kind: 'cover' })).toBe('');
  });
});
