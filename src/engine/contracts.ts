/**
 * Contracts between the engine packages. Each package implements its interface in its own folder and exports a
 * factory; `src/engine/index.ts` wires them together. Units: millimetres, seconds, radians. World: Y up, the
 * desk top near y = -12.575, the book spine along Z at x ~ 0, the reader at +Z.
 */
import type {
  Color, Group, Material, Matrix4, Mesh, Object3D, PerspectiveCamera, PointLight, Raycaster, Scene, SpotLight,
  Texture, Vector2, Vector3, Vector4, WebGLRenderer, HemisphereLight, IUniform,
} from 'three';
import type { Registry } from './core/registry';

/** Render layers. Pop-up lines and surfaces render on POP for the print camera; glow objects on GLOW for the spill map. */
export const LAYERS = { default: 0, pop: 1, bloom: 2, glow: 3 } as const;

export interface FrameInfo {
  /** Seconds since the last frame, clamped to [0, 0.05]. */
  dt: number;
  /** Seconds since boot (sum of clamped dt). */
  time: number;
  frame: number;
  /** Reduced motion: animations snap to their end. */
  still: boolean;
}

/** The frame is split into ordered phases; packages hook into the phase that matches the reference's loop order. */
export const FRAME_PHASES = ['book', 'tour', 'runtime', 'flaps', 'shadow', 'camera', 'uniforms', 'spill', 'lens', 'ui', 'render', 'after'] as const;
export type FramePhase = (typeof FRAME_PHASES)[number];

export type Unsubscribe = () => void;

export interface Emitter<E extends Record<string, unknown>> {
  on<K extends keyof E>(type: K, fn: (payload: E[K]) => void): Unsubscribe;
  emit<K extends keyof E>(type: K, payload: E[K]): void;
}

export interface EngineEvents extends Record<string, unknown> {
  'turn-start': { from: number; to: number; leaves: number };
  'turn-end': { spread: number };
  'leaf-land': { leaf: number; speed: number };
  'arrive': { spread: number };
  'leave': { spread: number };
  'pop-state': { spread: number; state: PopState };
  'live': { spread: number };
  'still': { on: boolean };
  'quality': { tier: QualityTier };
  'resize': { width: number; height: number; pixelRatio: number };
}

export type QualityTier = 'high' | 'medium' | 'low';
export interface Quality {
  tier: QualityTier;
  set(tier: QualityTier): void;
  /** Feed frame times (ms) while live and idle; steps down when slow. */
  sample(ms: number): void;
}

/** Built by WP1 (`src/engine/core/app.ts`): renderer, scene, camera, loop. */
export interface EngineContext {
  registry: Registry;
  canvas: HTMLCanvasElement;
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  quality: Quality;
  events: Emitter<EngineEvents>;
  readonly still: boolean;
  setStill(on: boolean): void;
  onFrame(phase: FramePhase, fn: (f: FrameInfo) => void): Unsubscribe;
  /** Drawing-buffer size in device pixels. */
  readonly resolution: Vector2;
  /** Shared uniforms custom shaders read: key light direction and colour in view space, hatch light direction. */
  readonly sharedUniforms: { uKeyDir: IUniform<Vector3>; uKeyColor: IUniform<Color>; uIllus: IUniform<Vector3>; uHatchQ: IUniform<number> };
  start(): void;
  dispose(): void;
}

/** WP1 stage: desk, pad, lights, environment. */
export interface StageApi {
  key: SpotLight;
  hemi: HemisphereLight;
  spillLights: readonly PointLight[];
  desk: Mesh;
  pad: Mesh;
  /** y of the pad's top surface, where the book rests. */
  deskTop: number;
  /** Per frame: key light direction/colour uniforms. */
  update(camera: PerspectiveCamera): void;
  /** Coloured light from glow sources: up to three point lights follow the strongest sources. */
  updateSpill(sources: readonly GlowSource[], dt: number): void;
}

/** WP1 post: composer chain and the effects other packages talk to. */
export interface PostApi {
  render(dt: number): void;
  setSize(width: number, height: number): void;
  /** Selective bloom: only selected objects glow. */
  bloomSelect(obj: Object3D, on: boolean): void;
  exposure: number;
  /** Glass rectangles (device px, top-left origin) for the capsule, lens disc and cards; refreshed every frame by the UI. */
  setGlassRects(rects: readonly GlassRect[]): void;
  /** Blurred top-down map of glow objects, multiplied onto the paper. */
  spillMap: SpillMap;
}

export interface GlassRect {
  x: number; y: number; w: number; h: number;
  radius: number; tint: number; strength: number; pressed: boolean;
  /** 1 = plain glass; > 1 magnifies what is under it (the lens). */
  zoom: number;
}

export interface SpillMap {
  texture: Texture;
  /** World XZ rectangle the map covers: (x0, z0, width, depth). */
  rect: Vector4;
  gain: number;
  /** Renders the glow layer from above when live (and for a tail of frames after). */
  update(live: boolean): void;
}

/** A glowing thing that lights the page: an energy store, a stream, a lamp filament. Linear colour. */
export interface GlowSource {
  id: string;
  position: Vector3;
  color: Color;
  strength: number;
}

// ---------------------------------------------------------------- book (WP2)

export type Side = 'left' | 'right';

export interface BookDims {
  W: number; D: number; N: number; leaf: number; board: number; T: number; Yb: number;
  [k: string]: number | readonly number[];
}

export interface PageHit {
  spread: number;
  side: Side;
  /** Page millimetres: u across the page from the spine edge, v down from the head. */
  u: number;
  v: number;
  point: Vector3;
}

/** Where the paper shader composites the pop-up print, the handwriting layer and the glow spill. */
export interface PageSlot {
  material: Material;
  /** Print texture placed at rect (u0, v0, width, height) in page mm; alpha fades it. */
  setPrint(tex: Texture | null, rectMm: Vector4, alpha: number): void;
  setPrintAlpha(alpha: number): void;
  /** Handwriting / margin ink layer (transparent canvas), rect in page mm. */
  setInk(tex: Texture | null, rectMm: Vector4, alpha: number): void;
}

export interface BookApi {
  group: Group;
  dims: BookDims;
  nSpreads: number;
  /** Continuous position: 0 closed, 1 = spread 1 open, k = spread k open; fractional while turning. */
  readonly position: number;
  readonly openSpread: number;
  readonly turning: boolean;
  goTo(spread: number, opts?: { duration?: number; instant?: boolean }): Promise<void>;
  update(dt: number): void;
  pageToWorld(spread: number, side: Side, u: number, v: number, out?: Vector3): Vector3;
  pageNormal(spread: number, side: Side, u: number, v: number, out?: Vector3): Vector3;
  hitTest(raycaster: Raycaster): PageHit | null;
  /** Redraw a page canvas (text, regions) on the next frame. */
  invalidatePage(spread: number, side: Side): void;
  pageSlot(spread: number, side: Side): PageSlot;
  setRibbon(spread: number): void;
}

/** The world tells the book what to print; WP2's typography engine lays it out and reports hit regions. */
export interface PageRegion {
  id: string;
  kind: 'link' | 'predict' | 'flap' | 'switch' | 'quiz' | 'lens-term' | 'source' | 'stamp' | 'button';
  /** Rect in page mm. */
  u: number; v: number; w: number; h: number;
  /** Action string handled by the app, e.g. `goto:5`, `predict:1`, `switch:drag:on`, `flap`. */
  action: string;
  label?: string;
}

// ---------------------------------------------------------------- ink and pop-up (WP3)

export type PopState = 'print' | 'peel' | 'shade' | 'live' | 'undraw';

export interface PenSchedule { t0: number; dur: number }

export interface PenScheduler {
  next(lengthMm: number, delay?: number): PenSchedule;
  pause(seconds: number): void;
  readonly end: number;
  fit(totalSeconds: number): void;
}

export interface LineOptions {
  width?: number; t0?: number; dur?: number; sched?: PenSchedule; seed?: number; taper?: boolean; closed?: boolean;
  overshoot?: number; maxSeg?: number; wobble?: number; visibleInPrint?: boolean;
}

export interface LineSet {
  mesh: Mesh;
  add(points: readonly Vector3[], opts?: LineOptions): void;
  build(): void;
  setLines(lines: readonly (readonly Vector3[])[], flat?: readonly (readonly Vector3[])[]): void;
  reschedule(): void;
  readonly end: number;
}

export interface Pop {
  group: Group;
  readonly state: PopState;
  readonly t: number;
  readonly printAlpha: number;
  readonly drawEnd: number;
  /** Model frame: X along the page, Y out of the page, Z toward the page head is negative. */
  frame: Matrix4;
  ink(opts?: { color?: string; widthPx?: number; opacity?: number; bias?: number }): Material;
  paper(opts?: { color?: string; hatchA?: readonly number[]; hatchB?: readonly number[]; spacing?: number; shade?: number; hatch?: number; seed?: number }): Material;
  lines(material: Material, opts?: { capacity?: number }): LineSet;
  addLines(set: LineSet, parent?: Object3D): void;
  addSurface(mesh: Mesh, parent?: Object3D): void;
  pen(opts?: { speed?: number; gap?: number; min?: number; max?: number }): PenScheduler;
  set(state: 'print' | 'live'): void;
  draw(): void;
  undraw(): Promise<void>;
  update(dt: number): void;
  renderPrint(): Texture;
  setResolution(width: number, height: number): void;
  dispose(): void;
}

// ---------------------------------------------------------------- figures (lessons) and runtime (WP6)

export interface FigureContext {
  engine: EngineContext;
  pop: Pop;
  book: BookApi;
  spread: number;
  /** World quantities palette by id (colour, pattern, label). */
  quantity(id: string): { id: string; label: string; color: Color; hex: string; pattern?: string } | undefined;
  /** Register an entity under this lesson's prefix (`lesson-N.<id>`). */
  register(id: string, label: string, tags: readonly string[], object?: Object3D, describe?: string): void;
  sound: SoundApi;
  switches: Readonly<Record<string, string>>;
}

export interface PointerInfo {
  /** Hit point on the figure's drag plane in model-frame mm. */
  local: Vector3;
  world: Vector3;
  ndc: Vector2;
}

/** What a lesson figure module returns. Only `update` and `glowObjects` are required. */
export interface FigureBehaviour {
  update(dt: number, f: { live: boolean; still: boolean; paused: boolean; touring: boolean; camera: PerspectiveCamera }): void;
  glowObjects(): readonly Object3D[];
  lightSources?(): readonly GlowSource[];
  targets?(): readonly Object3D[];
  press?(target: Object3D, p: PointerInfo): 'drag' | void;
  drag?(p: PointerInfo): void;
  release?(p: PointerInfo): void;
  hover?(target: Object3D | null): void;
  cursor?(target: Object3D): string;
  onSwitch?(id: string, value: string, opts: { restore: boolean }): void;
  onLive?(): void;
  busy?(): boolean;
  challenge?(): { met: boolean; progress?: number };
  margin?(): readonly { text: string; size?: number; gap?: number }[];
  /** Tour actions named in the manifest (`release`, `drop`...). */
  act?(name: string): void;
  follow?(name: string): Vector3 | null;
  resetTour?(): void;
  leave?(): void;
  a11y?(): readonly string[];
}

export type FigureModule = (ctx: FigureContext) => FigureBehaviour;

// ---------------------------------------------------------------- sound (WP5)

export type SoundName =
  | 'pageTurn' | 'riffle' | 'flap' | 'pen' | 'bookThud' | 'roll' | 'stamp' | 'bounce' | 'bounceBall'
  | 'kettle' | 'kettleClick' | 'springStretch' | 'springRelease' | 'click';

export interface SoundLoop {
  set(params: { gain?: number; rate?: number; layer?: number }): void;
  stop(fadeSeconds?: number): void;
  readonly playing: boolean;
}

export interface SoundApi {
  readonly enabled: boolean;
  setEnabled(on: boolean): void;
  unlock(): void;
  play(name: SoundName, opts?: { gain?: number; rate?: number; variant?: number; delay?: number }): void;
  loop(name: SoundName, opts?: { gain?: number; rate?: number }): SoundLoop;
}

// ---------------------------------------------------------------- camera (WP5)

export interface CameraPose {
  pos: Vector3;
  look: Vector3;
  fov: number;
}

export interface CameraRigApi {
  readonly pose: CameraPose;
  readonly orbit: { yaw: number; pitch: number; held: boolean };
  /** A pose expressed in a lesson frame, held until a time (hero hold). */
  hold(pose: CameraPose | null, untilMs?: number): void;
  /** Tour (watch) target; null returns to the reading framing. */
  setTourShot(shot: { pose?: CameraPose; follow?: () => Vector3 | null; offset?: Vector3; fov?: number } | null): void;
  update(dt: number): void;
}

export interface Disposable {
  dispose(): void;
}

export type { Texture, Vector3, Vector4, Matrix4, Mesh, Object3D, Group, Color };
