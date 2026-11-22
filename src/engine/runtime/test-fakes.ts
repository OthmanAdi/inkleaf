/**
 * Small stand-ins for the engine, book, pop and sound so the runtime and navigator can be tested without a GPU.
 * Imported only by the `*.test.ts` files in this folder.
 */
import { Color, Group, PerspectiveCamera, Scene, Texture, Vector2, Vector3, type Material, type Object3D, type Vector4 } from 'three';
import {
  FRAME_PHASES, type BookApi, type EngineContext, type EngineEvents, type FigureBehaviour, type FigureContext, type FigureModule,
  type FrameInfo, type FramePhase, type PageRegion, type PageSlot, type Pop, type PopState, type Side, type SoundApi, type SoundLoop, type SoundName,
} from '../contracts';
import { Registry } from '../core/registry';
import type { LessonSpec, WorldManifest } from '../world/types';
import type { LayoutSource, PopInit } from './deps';

export type Log = string[];

export function fakeEngine(log: Log = []) {
  const hooks = new Map<FramePhase, Set<(f: FrameInfo) => void>>(FRAME_PHASES.map((p) => [p, new Set()]));
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  let still = false;
  let time = 0, frame = 0;
  const camera = new PerspectiveCamera(30, 16 / 9, 20, 9000);
  camera.position.set(16, 430, 400);
  camera.lookAt(12, 24, 4);
  camera.updateMatrixWorld(true);
  const scene = new Scene();
  const engine = {
    registry: new Registry(),
    canvas: document.createElement('canvas'),
    renderer: {} as EngineContext['renderer'],
    scene,
    camera,
    quality: { tier: 'high', set: () => {}, sample: () => {} },
    events: {
      on: (type: string, fn: (p: unknown) => void) => {
        const s = listeners.get(type) ?? new Set();
        listeners.set(type, s);
        s.add(fn);
        return () => void s.delete(fn);
      },
      emit: (type: string, payload: unknown) => {
        log.push(`event:${type}:${JSON.stringify(payload)}`);
        listeners.get(type)?.forEach((fn) => fn(payload));
      },
    } as unknown as EngineContext['events'],
    get still() { return still; },
    setStill(on: boolean) {
      still = on;
      engine.events.emit('still', { on } as EngineEvents['still']);
    },
    onFrame: (phase: FramePhase, fn: (f: FrameInfo) => void) => {
      hooks.get(phase)!.add(fn);
      return () => void hooks.get(phase)!.delete(fn);
    },
    resolution: new Vector2(1600, 900),
    sharedUniforms: {} as EngineContext['sharedUniforms'],
    start: () => {},
    dispose: () => {},
  } satisfies EngineContext;
  const step = (dt = 1 / 60) => {
    time += dt;
    const f: FrameInfo = { dt, time, frame: frame++, still };
    for (const p of FRAME_PHASES) hooks.get(p)!.forEach((fn) => fn(f));
  };
  return { engine: engine as EngineContext, step };
}

export function fakeSlot(log: Log, name: string): PageSlot & { printAlpha: number } {
  const slot = {
    material: {} as Material,
    printAlpha: 0,
    setPrint(tex: Texture | null, rect: Vector4, alpha: number) {
      slot.printAlpha = alpha;
      log.push(`${name}.setPrint:${tex ? 'tex' : 'null'}:${rect.toArray().map((x) => +x.toFixed(2)).join(',')}:${alpha}`);
    },
    setPrintAlpha(a: number) {
      slot.printAlpha = a;
    },
    setInk(tex: Texture | null, _rect: Vector4, alpha: number) {
      log.push(`${name}.setInk:${tex ? 'tex' : 'null'}:${alpha}`);
    },
  };
  return slot;
}

export interface FakeBook extends BookApi {
  openSpreadValue: number | null;
  calls: string[];
  /** Resolve the running turn. */
  finishTurn(): void;
  pendingTurns: number;
  slots: Map<string, ReturnType<typeof fakeSlot>>;
}

/** A flat book: right page u, v map to world (u, 0, v - 125); turns wait for `finishTurn()` unless `autoFinish`. */
export function fakeBook(log: Log = [], opts: { autoFinish?: boolean; bulge?: (u: number) => number } = {}): FakeBook {
  const resolvers: (() => void)[] = [];
  const slots = new Map<string, ReturnType<typeof fakeSlot>>();
  const book: FakeBook = {
    group: new Group(),
    dims: { W: 190, D: 250, N: 14, leaf: 0.55, board: 3, T: 19.15, Yb: -9.575 },
    nSpreads: 14,
    position: 0,
    openSpreadValue: null,
    get openSpread() { return book.openSpreadValue as number; },
    turning: false,
    calls: [],
    slots,
    pendingTurns: 0,
    goTo(spread, o = {}) {
      book.calls.push(`goTo:${spread}:${o.instant ? 'instant' : (o.duration ?? 'default')}`);
      log.push(`book.goTo:${spread}${o.instant ? ':instant' : ''}`);
      const land = () => {
        (book as { position: number }).position = spread;
        book.openSpreadValue = spread;
      };
      if (o.instant || opts.autoFinish) {
        land();
        return Promise.resolve();
      }
      book.pendingTurns++;
      return new Promise<void>((res) => resolvers.push(() => {
        book.pendingTurns--;
        land();
        res();
      }));
    },
    finishTurn() {
      resolvers.shift()?.();
    },
    update: () => {},
    pageToWorld(_k: number, side: Side, u: number, v: number, out = new Vector3()) {
      return out.set(side === 'right' ? u : -u, opts.bulge ? opts.bulge(u) : 0, v - 125);
    },
    pageNormal: (_k, _s, _u, _v, out = new Vector3()) => out.set(0, 1, 0),
    hitTest: () => null,
    invalidatePage(k: number, side: Side) {
      book.calls.push(`invalidate:${k}:${side}`);
    },
    pageSlot(k: number, side: Side) {
      const key = `${k}${side[0]}`;
      let s = slots.get(key);
      if (!s) slots.set(key, (s = fakeSlot(log, `slot${key}`)));
      return s;
    },
    setRibbon(k: number) {
      book.calls.push(`ribbon:${k}`);
    },
  };
  return book;
}

export interface FakePop extends Pop {
  init: PopInit;
  prints: number;
  disposed: boolean;
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/** The pop state machine with the spec's timings, without any drawing. */
export function fakePop(init: PopInit, drawEnd = 1.45): FakePop {
  let state: PopState = 'print';
  let t = 0;
  let printAlpha = 1;
  let resolveUndraw: (() => void) | null = null;
  const group = new Group();
  group.visible = false;
  const pop: FakePop = {
    group, init, prints: 0, disposed: false,
    get state() { return state; },
    get t() { return t; },
    get printAlpha() { return printAlpha; },
    drawEnd,
    frame: init.frame.clone(),
    ink: () => ({}) as Material,
    paper: () => ({}) as Material,
    lines: () => { throw new Error('not in tests'); },
    addLines: () => {},
    addSurface: () => {},
    pen: () => { throw new Error('not in tests'); },
    set(s) {
      state = s;
      t = 0;
      printAlpha = s === 'print' ? 1 : 0;
      group.visible = s !== 'print';
    },
    draw() {
      if (state !== 'print') return;
      state = 'peel';
      t = 0;
      group.visible = true;
    },
    undraw() {
      if (state === 'print') return Promise.resolve();
      state = 'undraw';
      t = 0;
      return new Promise<void>((res) => (resolveUndraw = res));
    },
    update(dt) {
      t += dt;
      if (state === 'peel') {
        printAlpha = 1 - smooth(Math.min(1, t / 0.28));
        if (t >= drawEnd) { state = 'shade'; t = 0; }
      } else if (state === 'shade') {
        if (t >= 0.45) { state = 'live'; t = 0; }
      } else if (state === 'undraw') {
        const r = Math.min(1, Math.max(0, (t - 0.15) / 0.35));
        printAlpha = smooth(Math.min(1, Math.max(0, (r - 0.78) / 0.22)));
        if (t >= 0.5) {
          pop.set('print');
          resolveUndraw?.();
          resolveUndraw = null;
        }
      }
    },
    renderPrint() {
      pop.prints++;
      return new Texture();
    },
    setResolution: () => {},
    dispose() {
      pop.disposed = true;
    },
  };
  return pop;
}

export function fakeSound(log: Log = []): SoundApi & { played: { name: SoundName; opts?: object }[]; loops: { name: SoundName; stops: number[] }[] } {
  const s = {
    enabled: true,
    played: [] as { name: SoundName; opts?: object }[],
    loops: [] as { name: SoundName; stops: number[] }[],
    setEnabled: () => {},
    unlock: () => {},
    play(name: SoundName, opts?: object) {
      s.played.push({ name, opts });
      log.push(`sound:${name}`);
    },
    loop(name: SoundName): SoundLoop {
      const rec = { name, stops: [] as number[] };
      s.loops.push(rec);
      log.push(`loop:${name}`);
      let playing = true;
      return {
        set: () => {},
        stop(fade = 0) {
          rec.stops.push(fade);
          playing = false;
        },
        get playing() { return playing; },
      };
    },
  };
  return s;
}

/** Page regions as the book typography would report them for a lesson spread. */
export function fakeLayout(spread: number, extra: Partial<Record<Side, PageRegion[]>> = {}): LayoutSource {
  const left: PageRegion[] = [
    { id: 'equation', kind: 'button', u: 54, v: 90, w: 118, h: 30, action: '' },
    { id: 'predict-0', kind: 'predict', u: 54.5, v: 150, w: 117.5, h: 7.4, action: 'predict:0' },
    { id: 'predict-1', kind: 'predict', u: 54.5, v: 157, w: 117.5, h: 7.4, action: 'predict:1' },
    { id: 'flap', kind: 'flap', u: 54, v: 170, w: 118, h: 40, action: 'flap' },
  ];
  const right: PageRegion[] = [
    { id: 'sw-off', kind: 'switch', u: 150, v: 217.5, w: 8, h: 7.5, action: 'switch:friction:off' },
    { id: 'sw-on', kind: 'switch', u: 160, v: 217.5, w: 8, h: 7.5, action: 'switch:friction:on' },
  ];
  return {
    regions: (k, side) => (k !== spread ? (extra[side] ?? []) : side === 'left' ? [...left, ...(extra.left ?? [])] : [...right, ...(extra.right ?? [])]),
  };
}

export interface FigureProbe {
  log: string[];
  met: boolean;
  busy: boolean;
  margin: { text: string; size?: number; gap?: number }[];
  ctx: FigureContext | null;
  target: Object3D;
  glow: Object3D;
}

export function fakeFigure(): { figure: FigureModule; probe: FigureProbe } {
  const probe: FigureProbe = { log: [], met: false, busy: false, margin: [], ctx: null, target: new Group(), glow: new Group() };
  const figure: FigureModule = (ctx) => {
    probe.ctx = ctx;
    ctx.pop.group.add(probe.target, probe.glow);
    const b: FigureBehaviour = {
      update: (dt, f) => void probe.log.push(`update:${dt}:${f.live ? 'live' : 'flat'}${f.paused ? ':paused' : ''}`),
      glowObjects: () => [probe.glow],
      lightSources: () => [{ id: 'jar', position: new Vector3(), color: new Color(1, 0.5, 0), strength: 1 }],
      targets: () => [probe.target],
      press: (_t, p) => {
        probe.log.push(`press:${p.local.toArray().map((x) => Math.round(x)).join(',')}`);
        return 'drag';
      },
      drag: () => void probe.log.push('drag'),
      release: () => void probe.log.push('release'),
      onSwitch: (id, v, o) => void probe.log.push(`switch:${id}:${v}${o.restore ? ':restore' : ''}`),
      onLive: () => void probe.log.push('onLive'),
      busy: () => probe.busy,
      challenge: () => ({ met: probe.met }),
      margin: () => probe.margin,
      act: (name) => void probe.log.push(`act:${name}`),
      follow: () => new Vector3(1, 2, 3),
      resetTour: () => void probe.log.push('resetTour'),
      leave: () => void probe.log.push('leave'),
      a11y: () => ['A ball on a track.'],
    };
    return b;
  };
  return { figure, probe };
}

export const lessonSpec = (over: Partial<LessonSpec> = {}): LessonSpec => ({
  id: 'the-ramp',
  n: 1,
  title: 'Up and down',
  kicker: 'Lesson 1',
  intro: ['A ball trades height for speed.'],
  formula: { symbolic: 'E_k = 1/2 m v^2', words: 'kinetic energy equals half the mass times the speed squared', units: 'E_k in J · m in kg · v in m/s' },
  keyWords: [{ term: 'kinetic store', def: 'Energy of a moving object.' }],
  predict: { question: 'How high does it come back?', options: ['Higher', 'No higher'], answer: 1 },
  flap: { title: 'Why?', text: 'Some energy warms the track.' },
  challenge: { text: 'Make it reach the flag.' },
  figure: { caption: 'Ball on a track', instruction: 'Drag the ball up, then let go.', switches: [{ id: 'friction', label: 'Friction', options: ['off', 'on'], value: 'off' }] },
  lensTerms: [],
  a11y: 'A ball on a U-shaped track.',
  tour: [
    { cam: 'wide', caption: 'The track.' },
    { cam: { pos: [95, 130, 10], look: [95, 70, -100] }, caption: 'The jars.', act: 'release' },
    { cam: { follow: 'ball' }, caption: 'Follow the ball.' },
    { cam: 'text', caption: 'Your turn.' },
  ],
  sources: [1],
  figureModule: 'ramp',
  ...over,
});

export const worldManifest = (over: Partial<WorldManifest> = {}): WorldManifest => ({
  id: 'demo',
  title: 'Where Energy Goes',
  subtitle: 'A pop-up book about energy',
  lang: 'en',
  theme: { cloth: '#d9a52b', edge: '#d4b04a', ribbon: '#1c2a5a', ink: '#1c2433', accent: '#9a3b2a', paper: '#f4efe2', hand: '#273463', pad: '#8fa89b', desk: 'oak' },
  quantities: [
    { id: 'kinetic', label: 'Kinetic', color: '#2f7bff', pattern: 'chevrons' },
    { id: 'thermal', label: 'Thermal', color: '#ff7a1c', pattern: 'waves' },
  ],
  pathways: [{ id: 'mechanical', label: 'Mechanically' }],
  cover: { title: 'Where Energy Goes', subtitle: 'Ten small experiments', plate: 'ramp' },
  spreads: [
    { kind: 'contents' },
    { kind: 'lesson', lesson: lessonSpec() },
    { kind: 'lesson', lesson: lessonSpec({ id: 'the-spring', n: 2, title: 'Stretch', figureModule: 'spring', figure: { caption: 'Fig. 2 A spring', instruction: 'Pull.' }, sources: [1, 2] }) },
    { kind: 'quiz', questions: [
      { question: 'Q1?', options: ['a', 'b', 'c'], answer: 1, explain: 'Because.', lesson: 1 },
      { question: 'Q2?', options: ['a', 'b'], answer: 0, explain: 'So.', lesson: 2 },
      { question: 'Q3?', options: ['a', 'b'], answer: 1, explain: 'Hence.' },
    ] },
    { kind: 'glossary' },
    { kind: 'sources' },
  ],
  glossary: [
    { term: 'thermal store', def: 'Energy of warm things.', lessons: [1, 2] },
    { term: 'kinetic store', def: 'Energy of a moving object.', lessons: [1] },
    { term: 'elastic', def: 'Springs.', lessons: [2] },
  ],
  sources: [
    { n: 1, title: 'Energy stores', publisher: 'A publisher', url: 'https://www.example.org/energy', checked: '2026-11-01' },
    { n: 2, title: 'Springs', publisher: 'B publisher', url: 'https://data.example.com/springs', checked: '2026-11-02' },
  ],
  ...over,
});
