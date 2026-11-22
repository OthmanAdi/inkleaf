/** Lesson runtime, navigator, progress store and world loader: the glue that turns a world manifest into a working book. */
export { createRuntime, type RuntimeOptions } from './runtime';
export { createNavigator, type Navigator, type NavigatorDeps, type NavigatorHooks, type RuntimeShared, type QuizScore, type LocationLike, type HistoryLike } from './navigator';
export { createProgress, migrateProgress, PROGRESS_VERSION, type Progress, type ProgressData, type StorageLike } from './progress';
export { loadWorld, WorldError, type WorldModel } from './world';
export { buildPages, DEFAULT_LABELS, LESSON_TEMPLATE } from './pages';
export type {
  PageSpec, SpreadPages, PageLabels, TitlePageSpec, ContentsPageSpec, ContentsEntry, LessonTextPageSpec, LessonFigurePageSpec,
  GlossaryPageSpec, IndexEntry, QuizPageSpec, QuizItem, SourcesPageSpec, SourceItem, BlankPageSpec,
} from './pages';
export { parseAction, formatAction, parseDeepLink, spreadHash, type PageAction } from './actions';
export { computeLessonFrame, frameToWorld, frameDirToWorld } from './frame';
export { TOUCH_PROBES } from './pointer';
export { paintStamp, DEFAULT_FONTS } from './ink';
export { runtimeTunables, navTunables } from './tunables';
export { createSession, createPageState } from './types';
export type { LessonRuntime, SpreadInfo, SpreadKind, PageState, MarginLine, RuntimeFlags, RuntimeSession, PickHit } from './types';
export type { PopFactory, PopInit, LayoutSource, FlapCard, FlapFactory, FlapInit, TourControl, TourSubject, ResolvedShot, TourCam, PointerAt, PageRect } from './deps';
