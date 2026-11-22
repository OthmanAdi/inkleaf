/**
 * The reader's progress, kept in localStorage under one key with a version number: earned stamps (with the time they
 * were earned), the bookmark spread, watched tours, visited lessons, lifted flaps, quiz picks and lifted quiz flaps,
 * and the still-mode preference. Storage failures (private windows, quotas) are tolerated: the store keeps working in
 * memory and `storageOk` turns false.
 */

export const PROGRESS_VERSION = 2;

export interface ProgressData {
  v: number;
  /** Lesson number -> time the stamp was earned (ms since 1970; 0 when unknown). */
  stamps: Record<string, number>;
  watched: Record<string, number>;
  visited: Record<string, number>;
  /** Lesson number -> first time its flap was lifted. */
  flaps: Record<string, number>;
  /** Spread the reader last reached by navigation; null until set. */
  bookmark: number | null;
  quiz: { picks: Record<string, number>; open: Record<string, boolean> };
  /** Still mode: true or false when chosen, null to follow the system's reduced-motion setting. */
  still: boolean | null;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface Progress {
  readonly key: string;
  readonly storageOk: boolean;
  readonly data: Readonly<ProgressData>;
  stamped(n: number): boolean;
  /** Records a stamp; false when the lesson already had one. */
  stamp(n: number): boolean;
  unstamp(n: number): void;
  visit(n: number): void;
  visited(n: number): boolean;
  markWatched(n: number): void;
  watched(n: number): boolean;
  /** Records the first lift of a lesson's flap. */
  flap(n: number): void;
  /** The bookmark, or the fallback given at creation. */
  readonly bookmark: number;
  /** True when the bookmark changed. */
  setBookmark(spread: number): boolean;
  quizPick(q: number, option: number | null): void;
  quizOpen(q: number, open: boolean): void;
  readonly still: boolean | null;
  setStill(on: boolean | null): void;
  /** Clears all progress (the still preference is a setting and stays). */
  reset(): void;
}

const empty = (): ProgressData => ({ v: PROGRESS_VERSION, stamps: {}, watched: {}, visited: {}, flaps: {}, bookmark: null, quiz: { picks: {}, open: {} }, still: null });

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Keeps numeric keys; `true` (older records) becomes 0, numbers stay, anything else is dropped. */
function times(x: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(x)) return out;
  for (const [k, v] of Object.entries(x)) {
    if (!/^\d+$/.test(k)) continue;
    if (v === true) out[k] = 0;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/**
 * Turns any stored record into the current shape. Version 1 (and unversioned) records stored booleans for watched,
 * visited and flaps, kept predictions (no longer persisted) and kept the still preference under `<key>:still`.
 */
export function migrateProgress(raw: unknown, legacyStill: string | null): ProgressData {
  const d = empty();
  if (!isObj(raw)) return d;
  d.stamps = times(raw.stamps);
  d.watched = times(raw.watched);
  d.visited = times(raw.visited);
  d.flaps = times(raw.flaps);
  if (typeof raw.bookmark === 'number' && Number.isInteger(raw.bookmark) && raw.bookmark >= 1) d.bookmark = raw.bookmark;
  if (isObj(raw.quiz)) {
    if (isObj(raw.quiz.picks)) for (const [k, v] of Object.entries(raw.quiz.picks)) if (/^\d+$/.test(k) && typeof v === 'number' && Number.isInteger(v) && v >= 0) d.quiz.picks[k] = v;
    if (isObj(raw.quiz.open)) for (const [k, v] of Object.entries(raw.quiz.open)) if (/^\d+$/.test(k) && v === true) d.quiz.open[k] = true;
  }
  const version = typeof raw.v === 'number' ? raw.v : 1;
  if (typeof raw.still === 'boolean') d.still = raw.still;
  else if (version < 2 && (legacyStill === '1' || legacyStill === '0')) d.still = legacyStill === '1';
  return d;
}

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function createProgress(storageKey: string, opts: { storage?: StorageLike | null; now?: () => number; bookmark?: number } = {}): Progress {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const now = opts.now ?? (() => Date.now());
  const fallback = opts.bookmark ?? 2;
  let ok = storage !== null;
  let data = empty();

  const read = (key: string): string | null => {
    if (!storage) return null;
    try {
      return storage.getItem(key);
    } catch {
      ok = false;
      return null;
    }
  };
  const save = () => {
    if (!storage) return;
    try {
      storage.setItem(storageKey, JSON.stringify(data));
      ok = true;
    } catch {
      ok = false;
    }
  };

  const raw = read(storageKey);
  const legacyStill = read(`${storageKey}:still`);
  let parsed: unknown = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  data = migrateProgress(parsed, legacyStill);
  const storedVersion = isObj(parsed) && typeof parsed.v === 'number' ? parsed.v : raw ? 1 : PROGRESS_VERSION;
  if (raw && storedVersion < PROGRESS_VERSION) save();
  else if (!raw && legacyStill !== null && data.still !== null) save();

  const mark = (rec: Record<string, number>, n: number) => {
    if (rec[n] !== undefined) return false;
    rec[n] = now();
    save();
    return true;
  };

  return {
    key: storageKey,
    get storageOk() { return ok; },
    get data() { return data; },
    stamped: (n) => data.stamps[n] !== undefined,
    stamp: (n) => mark(data.stamps, n),
    unstamp: (n) => {
      if (data.stamps[n] === undefined) return;
      delete data.stamps[n];
      save();
    },
    visit: (n) => void mark(data.visited, n),
    visited: (n) => data.visited[n] !== undefined,
    markWatched: (n) => void mark(data.watched, n),
    watched: (n) => data.watched[n] !== undefined,
    flap: (n) => void mark(data.flaps, n),
    get bookmark() { return data.bookmark ?? fallback; },
    setBookmark: (spread) => {
      if (data.bookmark === spread) return false;
      data.bookmark = spread;
      save();
      return true;
    },
    quizPick: (q, option) => {
      if (option === null) delete data.quiz.picks[q];
      else data.quiz.picks[q] = option;
      save();
    },
    quizOpen: (q, open) => {
      if (open) data.quiz.open[q] = true;
      else delete data.quiz.open[q];
      save();
    },
    get still() { return data.still; },
    setStill: (on) => {
      data.still = on;
      save();
    },
    reset: () => {
      const still = data.still;
      data = empty();
      data.still = still;
      if (!storage) return;
      try {
        if (still === null) storage.removeItem(storageKey);
        else storage.setItem(storageKey, JSON.stringify(data));
      } catch {
        ok = false;
      }
    },
  };
}
