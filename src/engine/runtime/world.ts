/**
 * Loads a world manifest: validates it (all problems at once, as one readable error), builds the spread map, binds
 * each lesson to its figure module and maps the content to page specs for the book's typography engine.
 */
import type { FigureModule } from '../contracts';
import type { Quantity, WorldManifest } from '../world/types';
import { validateWorld, type Problem } from '../world/validate';
import { spreadHash, type LinkWorld } from './actions';
import { buildPages, DEFAULT_LABELS, type PageLabels, type PageSpec, type SpreadPages } from './pages';
import { createPageState, type PageState, type SpreadInfo, type SpreadKind } from './types';
import type { Side } from '../contracts';

export class WorldError extends Error {
  readonly problems: readonly Problem[];
  constructor(worldId: string, problems: readonly Problem[]) {
    const errors = problems.filter((p) => p.severity === 'error');
    const warnings = problems.length - errors.length;
    super(
      `inkleaf: the world "${worldId}" has ${errors.length} problem${errors.length === 1 ? '' : 's'} to fix:\n` +
        errors.map((p) => `  - ${p.path}: ${p.message}`).join('\n') +
        (warnings ? `\n(and ${warnings} warning${warnings === 1 ? '' : 's'}; see error.problems)` : ''),
    );
    this.name = 'WorldError';
    this.problems = problems;
  }
}

export interface WorldModel extends LinkWorld {
  manifest: WorldManifest;
  /** Index k = spread k; [0] is the closed cover. */
  spreads: readonly SpreadInfo[];
  lastSpread: number;
  firstLessonSpread: number;
  quantities: readonly Quantity[];
  /** Index k = pages of spread k; null for the cover. */
  pages: readonly (SpreadPages | null)[];
  page(spread: number, side: Side): PageSpec | undefined;
  pageState: PageState;
  warnings: readonly Problem[];
  labels: PageLabels;
}

const BACK_TITLES: Record<string, string> = { quiz: 'Quiz', glossary: 'Index', sources: 'Sources', contents: 'Contents' };

export function loadWorld(manifest: WorldManifest, figures: Readonly<Record<string, FigureModule>>, opts: { labels?: Partial<PageLabels> } = {}): WorldModel {
  const names = Object.keys(figures);
  const problems = validateWorld(manifest, names);
  manifest.spreads.forEach((s, i) => {
    if (s.kind === 'lesson' && !names.length) problems.push({ path: `spreads[${i}].lesson.figureModule`, message: `no figure module named "${s.lesson.figureModule}"; no figure modules were given`, severity: 'error' });
  });
  const kinds = new Set<string>();
  manifest.spreads.forEach((s, i) => {
    if (s.kind !== 'lesson' && kinds.has(s.kind)) problems.push({ path: `spreads[${i}]`, message: `a book has at most one ${s.kind} spread`, severity: 'error' });
    kinds.add(s.kind);
  });
  if (problems.some((p) => p.severity === 'error')) throw new WorldError(manifest.id, problems);

  const labels: PageLabels = { ...DEFAULT_LABELS, ...opts.labels };
  const spreads: SpreadInfo[] = [{ k: 0, kind: 'cover', title: manifest.cover.title, folios: [0, 1], hash: '', index: -1 }];
  manifest.spreads.forEach((s, i) => {
    const k = i + 1;
    const kind: SpreadKind = s.kind;
    const info: SpreadInfo = {
      k, kind, index: i, folios: [2 * k, 2 * k + 1], hash: '',
      title: s.kind === 'lesson' ? s.lesson.title : kind === 'glossary' ? labels.index.title : kind === 'quiz' ? labels.quiz.title : kind === 'sources' ? labels.sources.title : BACK_TITLES[kind] ?? kind,
    };
    if (s.kind === 'lesson') {
      info.lesson = s.lesson;
      info.figure = figures[s.lesson.figureModule];
    }
    info.hash = spreadHash(k, { kind, n: info.lesson?.n });
    spreads.push(info);
  });

  const special: WorldModel['special'] = {};
  for (const s of spreads) if (s.kind === 'contents' || s.kind === 'quiz' || s.kind === 'glossary' || s.kind === 'sources') special[s.kind] = s.k;
  const byLesson = new Map<number, number>();
  for (const s of spreads) if (s.lesson && !byLesson.has(s.lesson.n)) byLesson.set(s.lesson.n, s.k);
  const firstLessonSpread = spreads.find((s) => s.kind === 'lesson')?.k ?? Math.min(1, spreads.length - 1);
  const pages = buildPages(manifest, spreads, labels);

  return {
    manifest,
    spreads,
    lastSpread: spreads.length - 1,
    firstLessonSpread,
    special,
    lessonSpread: (n) => byLesson.get(n),
    quantities: manifest.quantities,
    pages,
    page: (k, side) => {
      const p = pages[k];
      return p ? (side === 'left' ? p.left : p.right) : undefined;
    },
    pageState: createPageState(firstLessonSpread),
    warnings: problems.filter((p) => p.severity === 'warning'),
    labels,
  };
}
