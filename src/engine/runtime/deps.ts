/**
 * Small interfaces for things other packages provide to the runtime that `contracts.ts` does not name yet: the pop
 * factory (ink), page layout regions and flap cards (book), and the tour driver (camera). The chair wires the real
 * implementations in `src/engine/index.ts`; see `README.md` in this folder.
 */
import type { Matrix4, Object3D, Vector3 } from 'three';
import type { CameraPose, EngineContext, PageRegion, Pop, Side } from '../contracts';

/** How a lesson's pop-up model is created (ink package, `createPop`). */
export interface PopInit {
  /** The lesson frame: model-frame mm to world. */
  frame: Matrix4;
  /** Print window in model-frame mm: x along the page, y up the page once the drawing is folded flat. */
  printRect: { x0: number; x1: number; y0: number; y1: number };
  /** Print texture resolution, pixels per millimetre (6 gives 1080 x 1200). */
  pxPerMm: number;
  /** Cabinet-oblique shear of the print and of the flat copy. */
  cab: readonly [number, number];
}

export type PopFactory = (engine: EngineContext, init: PopInit) => Pop;

/** Hit regions of a laid-out page, in page mm (book typography). */
export interface LayoutSource {
  regions(spread: number, side: Side): readonly PageRegion[];
}

/** A rectangle in page mm. */
export interface PageRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface FlapInit {
  spread: number;
  side: Side;
  rect: PageRect;
  /** Which edge the card hinges on: the lesson flap swings over its bottom edge, quiz flaps over their outer edge. */
  hinge: 'bottom' | 'top' | 'outer';
  /** Fully open angle, radians. */
  angle: number;
  face: { kind: 'lesson'; n: number } | { kind: 'quiz'; q: number };
}

/**
 * A 3D lift-the-flap card (book package). Display only: the runtime owns the open amount and its smoothing, the card
 * re-anchors itself to the curved page and shows the amount.
 */
export interface FlapCard {
  readonly object: Object3D;
  visible: boolean;
  /** Re-anchor the card to its page (pages bend while turning). */
  place(): void;
  /** Show the card opened by `amount` (0 flat on the page, 1 fully open). */
  show(amount: number): void;
  dispose(): void;
}

export type FlapFactory = (init: FlapInit) => FlapCard;

/** A camera target for one tour shot, in the shape `CameraRigApi.setTourShot` accepts. */
export interface TourCam {
  pose?: CameraPose;
  follow?: () => Vector3 | null;
  offset?: Vector3;
  fov?: number;
}

export interface ResolvedShot {
  caption: string;
  /** Seconds the shot lasts. */
  hold: number;
  /** Figure action to run when the shot starts. */
  act?: string;
  /** null: the reading view (hand-over shot). */
  cam: TourCam | null;
}

/** What a lesson offers to a tour driver. */
export interface TourSubject {
  readonly spread: number;
  readonly shotCount: number;
  shot(i: number): ResolvedShot | null;
  act(name: string): void;
  /** Called when a tour ends for any reason: reset the model and re-apply the reader's switches. */
  restoreAfterTour(): void;
}

/** The watch-mode driver (camera package): shot clock, captions, camera targets. */
export interface TourControl {
  readonly running: boolean;
  readonly paused: boolean;
  start(subject: TourSubject): void;
  stop(): void;
}

/** Client-pixel rectangle of the canvas. */
export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A pointer position in client pixels. */
export interface PointerAt {
  x: number;
  y: number;
  pointerType?: string;
  /** The canvas rectangle; read from the canvas when omitted. */
  rect?: RectLike;
}
