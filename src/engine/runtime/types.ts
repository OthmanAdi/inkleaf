/** Shared runtime types: the spread map, live page state and the lesson runtime interface. */
import type { Matrix4, Object3D, Vector2, Vector3 } from 'three';
import type { CameraPose, FigureBehaviour, FigureModule, GlowSource, Pop, PopState } from '../contracts';
import type { LessonSpec } from '../world/types';
import type { PointerAt, TourSubject } from './deps';

export type SpreadKind = 'cover' | 'contents' | 'lesson' | 'quiz' | 'glossary' | 'sources';

export interface SpreadInfo {
  /** Spread number: 0 is the closed cover, 1 the first opening. */
  k: number;
  kind: SpreadKind;
  title: string;
  /** Page numbers printed on the left and right page. */
  folios: readonly [number, number];
  /** Deep-link hash that returns to this spread ('' for the cover). */
  hash: string;
  /** Position in `manifest.spreads` (-1 for the cover). */
  index: number;
  lesson?: LessonSpec;
  figure?: FigureModule;
}

/**
 * Live state the page painters read when a page is repainted. Writers update it and call `book.invalidatePage` for
 * the pages it shows on.
 */
export interface PageState {
  /** Lesson numbers whose stamp is earned (contents stamps). */
  stamps: Set<number>;
  /** Spread of the "continue" link on the contents page. */
  bookmark: number;
  /** Lesson spreads whose 3D flap is lifted, so the left page omits the printed flap face. */
  flapsOpen: Set<number>;
  /** Quiz question index -> picked option. */
  quizPicks: Map<number, number>;
  /** Quiz questions whose 3D answer flap is lifted (the page prints the answer, not the flap face). */
  quizOpen: Set<number>;
  /** Quiz questions whose flap was lifted at least once (the score shows when all are). */
  quizChecked: Set<number>;
}

export function createPageState(bookmark: number): PageState {
  return { stamps: new Set(), bookmark, flapsOpen: new Set(), quizPicks: new Map(), quizOpen: new Set(), quizChecked: new Set() };
}

export interface MarginLine {
  text: string;
  /** Size in mm (default 5.6). */
  size?: number;
  /** Extra mm after the line. */
  gap?: number;
}

export interface RuntimeFlags {
  still: boolean;
  /** Tour paused: the figure receives dt 0. */
  paused: boolean;
  touring: boolean;
}

/** Shared across all runtimes of one session. */
export interface RuntimeSession {
  /** Spreads whose figure has been live at least once this session (the first-live event fires once). */
  liveSeen: Set<number>;
  /** URL `noevent`: never fire first-live events. */
  noEvent: boolean;
}

export const createSession = (noEvent = false): RuntimeSession => ({ liveSeen: new Set(), noEvent });

export interface PickHit {
  object: Object3D;
  /** World point of the hit. */
  point: Vector3;
  ndc: Vector2;
}

/** One lesson spread at run time: the figure, its pop-up, the page ink, flap, stamp and switches. */
export interface LessonRuntime extends TourSubject {
  readonly n: number;
  readonly spread: number;
  readonly id: string;
  readonly lesson: LessonSpec;
  readonly pop: Pop;
  readonly behaviour: FigureBehaviour;
  readonly frame: Matrix4;
  readonly state: PopState;
  readonly live: boolean;
  /** True once a press forced the figure live before its peel finished. */
  readonly forcedLive: boolean;
  readonly predict: number | null;
  readonly flapOpen: boolean;
  /** Open amount of the flap, 0..1 (smoothed). */
  readonly flapAmount: number;
  readonly stamped: boolean;
  /** Stamp press, 0..1. */
  readonly stampPress: number;
  readonly switches: Readonly<Record<string, string>>;
  readonly dragging: boolean;
  readonly captions: readonly string[];

  /** Renders the print onto the page with the model in its rest pose (call once after creation). */
  prepare(): void;
  /** The page turn landed here: refit the frame, start the peel and the pen loop. */
  arrive(): void;
  /** Before a turn away: sink the model back into the print (0.5 s), or at once when instant or still. */
  leave(opts?: { instant?: boolean }): Promise<void>;
  update(dt: number, flags: RuntimeFlags): void;
  /** Shows or hides the model and flap (only the current spread is active). */
  setActive(on: boolean): void;

  setPredict(i: number | null): void;
  clearPredict(): void;
  /** Sets a switch by option value or index; false when the id or value is unknown. */
  setSwitch(id: string, value: string | number): boolean;
  toggleFlap(open?: boolean): void;
  stamp(): void;
  unstamp(): void;
  marginLines(): readonly MarginLine[];
  busy(): boolean;

  /** Lesson target meshes; during peel/shade only for a press. */
  targets(down?: boolean): readonly Object3D[];
  pick(at: PointerAt, down?: boolean): PickHit | null;
  /** Press on a picked target; forces the figure live first. Returns 'drag' when the figure captured the pointer. */
  press(hit: PickHit): 'drag' | void;
  drag(at: PointerAt): void;
  release(at?: PointerAt): void;
  /** Ends a drag without a pointer (page turn, dialog): the figure gets `release` with the last pointer. */
  cancelDrag(): void;
  hover(target: Object3D | null): void;
  cursor(target: Object3D): string;

  /** A lesson-frame camera pose in world space. */
  framePose(pos: readonly number[], look: readonly number[], fov: number): CameraPose;
  glowObjects(): readonly Object3D[];
  /** Glow sources for the spill lights: empty unless live. */
  lightSources(): readonly GlowSource[];
  /** The flap card object, when the book built one (for hit tests). */
  flapObject(): Object3D | null;
  a11y(): readonly string[];
  dispose(): void;
}
