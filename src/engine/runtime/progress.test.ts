import { describe, expect, it } from 'vitest';
import { createProgress, migrateProgress, PROGRESS_VERSION, type StorageLike } from './progress';

function memory(seed: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

describe('progress store', () => {
  it('round-trips stamps with timestamps, bookmark, watched, flaps, quiz and still', () => {
    const storage = memory();
    let t = 1000;
    const a = createProgress('inkleaf:demo', { storage, now: () => t++ });
    expect(a.stamp(3)).toBe(true);
    expect(a.stamp(3)).toBe(false);
    a.markWatched(3);
    a.visit(2);
    a.flap(2);
    expect(a.setBookmark(5)).toBe(true);
    expect(a.setBookmark(5)).toBe(false);
    a.quizPick(0, 2);
    a.quizPick(1, 0);
    a.quizPick(1, null);
    a.quizOpen(4, true);
    a.setStill(true);

    const b = createProgress('inkleaf:demo', { storage });
    expect(b.stamped(3)).toBe(true);
    expect(b.data.stamps['3']).toBe(1000);
    expect(b.watched(3)).toBe(true);
    expect(b.visited(2)).toBe(true);
    expect(b.data.flaps['2']).toBeTypeOf('number');
    expect(b.bookmark).toBe(5);
    expect(b.data.quiz.picks).toEqual({ '0': 2 });
    expect(b.data.quiz.open).toEqual({ '4': true });
    expect(b.still).toBe(true);
    expect(JSON.parse(storage.map.get('inkleaf:demo')!).v).toBe(PROGRESS_VERSION);
  });

  it('falls back to the given bookmark and keeps the still preference through a reset', () => {
    const storage = memory();
    const p = createProgress('k', { storage, bookmark: 2 });
    expect(p.bookmark).toBe(2);
    p.stamp(1);
    p.setStill(false);
    p.reset();
    expect(p.stamped(1)).toBe(false);
    expect(p.still).toBe(false);
    expect(createProgress('k', { storage }).still).toBe(false);
    p.setStill(null);
    p.reset();
    expect(storage.map.has('k')).toBe(false);
  });

  it('migrates a version 1 record and the separate still key', () => {
    const v1 = {
      predictions: { 2: 1 },
      stamps: { 1: 1700000000000, 2: true },
      visited: { 2: true, 3: true },
      watched: { 2: true },
      flaps: { 2: true },
      quiz: { picks: { 0: 1, bad: 2 }, open: { 3: true, 4: false } },
      bookmark: 4,
    };
    const storage = memory({ old: JSON.stringify(v1), 'old:still': '1' });
    const p = createProgress('old', { storage });
    expect(p.data).toEqual({
      v: PROGRESS_VERSION,
      stamps: { '1': 1700000000000, '2': 0 },
      watched: { '2': 0 },
      visited: { '2': 0, '3': 0 },
      flaps: { '2': 0 },
      bookmark: 4,
      quiz: { picks: { '0': 1 }, open: { '3': true } },
      still: true,
    });
    expect(JSON.parse(storage.map.get('old')!).v).toBe(PROGRESS_VERSION);
  });

  it('ignores the legacy still key once a record is current', () => {
    expect(migrateProgress({ v: 2, still: null }, '1').still).toBe(null);
    expect(migrateProgress({ v: 2, still: false }, '1').still).toBe(false);
  });

  it('tolerates corrupt JSON and a throwing storage', () => {
    expect(createProgress('x', { storage: memory({ x: '{not json' }) }).bookmark).toBe(2);
    const throwing: StorageLike = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('quota'); },
      removeItem: () => { throw new Error('denied'); },
    };
    const p = createProgress('x', { storage: throwing });
    expect(p.stamp(1)).toBe(true);
    expect(p.stamped(1)).toBe(true);
    expect(p.storageOk).toBe(false);
    p.reset();
    expect(p.stamped(1)).toBe(false);
  });
});
