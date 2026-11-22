/**
 * Action strings carried by page hit regions (`goto:5`, `predict:1`, `switch:friction:on`, `quiz:3:2`...) and the
 * deep links of the book (`#spread-3`, `#contents`, `#quiz`, `#index`, `#sources`, `?k=7`).
 */

export type PageAction =
  | { type: 'goto'; spread: number }
  | { type: 'reset' }
  | { type: 'predict'; index: number }
  | { type: 'switch'; id: string; value: string }
  | { type: 'flap' }
  | { type: 'quiz'; q: number; option: number }
  | { type: 'quiz-flap'; q: number }
  | { type: 'source'; n: number }
  | { type: 'link'; url: string };

const INT = /^\d+$/;
const int = (s: string | undefined) => (s !== undefined && INT.test(s) ? Number(s) : null);

/** Parses a region action; null when it is not one the navigator handles. */
export function parseAction(action: string): PageAction | null {
  const s = action.trim();
  if (s === 'flap') return { type: 'flap' };
  if (s === 'reset') return { type: 'reset' };
  const c = s.indexOf(':');
  if (c < 0) return null;
  const head = s.slice(0, c);
  const rest = s.slice(c + 1);
  const parts = rest.split(':');
  switch (head) {
    case 'goto': {
      const k = int(rest);
      return k === null ? null : { type: 'goto', spread: k };
    }
    case 'predict': {
      const i = int(rest);
      return i === null ? null : { type: 'predict', index: i };
    }
    case 'switch': {
      const id = parts[0] ?? '';
      const value = parts.slice(1).join(':');
      return id && parts.length >= 2 && value ? { type: 'switch', id, value } : null;
    }
    case 'quiz': {
      const q = int(parts[0]), o = int(parts[1]);
      return q === null || o === null || parts.length !== 2 ? null : { type: 'quiz', q, option: o };
    }
    case 'quiz-flap': {
      const q = int(rest);
      return q === null ? null : { type: 'quiz-flap', q };
    }
    case 'source': {
      const n = int(rest);
      return n === null ? null : { type: 'source', n };
    }
    case 'link':
      return /^https?:\/\//.test(rest) || rest.startsWith('#') || rest.startsWith('./') ? { type: 'link', url: rest } : null;
    default:
      return null;
  }
}

export function formatAction(a: PageAction): string {
  switch (a.type) {
    case 'goto': return `goto:${a.spread}`;
    case 'reset': return 'reset';
    case 'predict': return `predict:${a.index}`;
    case 'switch': return `switch:${a.id}:${a.value}`;
    case 'flap': return 'flap';
    case 'quiz': return `quiz:${a.q}:${a.option}`;
    case 'quiz-flap': return `quiz-flap:${a.q}`;
    case 'source': return `source:${a.n}`;
    case 'link': return `link:${a.url}`;
  }
}

/** What deep-link resolution needs from the world model. */
export interface LinkWorld {
  lastSpread: number;
  lessonSpread(n: number): number | undefined;
  special: { contents?: number; quiz?: number; glossary?: number; sources?: number };
}

/**
 * Resolves `#spread-N` (lesson N), `#contents`, `#index` or `#glossary`, `#quiz`, `#sources`, then `?k=N` (spread
 * number). Null when there is no usable link.
 */
export function parseDeepLink(loc: { hash: string; search: string }, w: LinkWorld): number | null {
  const hash = decodeURIComponent(loc.hash.replace(/^#/, '')).trim().toLowerCase();
  if (hash) {
    const m = /^spread-(\d+)$/.exec(hash);
    const k = m
      ? w.lessonSpread(Number(m[1]))
      : hash === 'contents' ? w.special.contents
        : hash === 'index' || hash === 'glossary' ? w.special.glossary
          : hash === 'quiz' ? w.special.quiz
            : hash === 'sources' ? w.special.sources
              : undefined;
    if (k !== undefined && k >= 1 && k <= w.lastSpread) return k;
  }
  const raw = new URLSearchParams(loc.search).get('k');
  const k = raw !== null && INT.test(raw.trim()) ? Number(raw.trim()) : null;
  return k !== null && k >= 1 && k <= w.lastSpread ? k : null;
}

/** The hash that leads back to a spread: lessons as `#spread-N`, contents and back matter by name, '' for the cover. */
export function spreadHash(spread: number, info: { kind: string; n?: number } | undefined): string {
  if (!info) return '';
  switch (info.kind) {
    case 'lesson': return `#spread-${info.n ?? spread}`;
    case 'contents': return '#contents';
    case 'glossary': return '#index';
    case 'quiz': return '#quiz';
    case 'sources': return '#sources';
    default: return '';
  }
}
