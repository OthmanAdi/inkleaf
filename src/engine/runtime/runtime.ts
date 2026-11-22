/**
 * The lesson runtime: wraps one lesson figure module into a working spread. It fits the lesson frame to the page,
 * creates the pop-up model, prints it onto the page, peels it up on arrival (with the pen sound), runs the figure every
 * frame, and keeps the page's handwriting layer (prediction tick, margin numbers, stamp, switch loops) in step with
 * the figure. It also maps pointer input onto the figure and resolves tour shots in the lesson frame.
 */
import { CanvasTexture, Color, Matrix4, Raycaster, SRGBColorSpace, Vector2, Vector3, Vector4 } from 'three';
import {
  LAYERS, type BookApi, type CameraPose, type EngineContext, type FigureContext, type FigureModule, type GlowSource,
  type PageRegion, type PointerInfo, type PopState, type PostApi, type Side, type SoundApi, type SoundLoop,
} from '../contracts';
import type { ParamSpec } from '../core/registry';
import type { LessonSpec, Quantity } from '../world/types';
import { parseAction } from './actions';
import type { FlapCard, FlapFactory, LayoutSource, PageRect, PointerAt, PopFactory, ResolvedShot, TourCam } from './deps';
import { computeLessonFrame, frameDirToWorld, frameOriginU, frameToWorld } from './frame';
import { DEFAULT_FONTS, paintLeftInk, paintRightInk, type Fonts } from './ink';
import { DragPlane, clientToNdc, makePointerInfo, pickTargets } from './pointer';
import type { Progress } from './progress';
import { runtimeTunables } from './tunables';
import { createSession, type LessonRuntime, type MarginLine, type PageState, type PickHit, type RuntimeFlags, type RuntimeSession } from './types';

export interface RuntimeOptions {
  book: BookApi;
  figure: FigureModule;
  lesson: LessonSpec;
  spread: number;
  quantities: readonly Quantity[];
  sound: SoundApi;
  progress: Progress;
  /** Builds the pop-up model (ink package). */
  createPop: PopFactory;
  /** Bloom selection for the glow objects (post package). */
  post?: Pick<PostApi, 'bloomSelect'>;
  /** Laid-out page regions (book typography); defaults to `book.regions` when the book has it. */
  layout?: LayoutSource;
  /** 3D flap card factory (book package); without it the flap is printed only. */
  createFlap?: FlapFactory;
  session?: RuntimeSession;
  pageState?: PageState;
  /** A stamp was earned or removed: repaint the contents page, announce it. */
  onStampChange?(n: number, stamped: boolean): void;
  fonts?: Partial<Fonts>;
  /** Canvas factory for the page ink layers. */
  canvas?: (width: number, height: number) => HTMLCanvasElement;
}

interface InkLayer {
  ctx: CanvasRenderingContext2D | null;
  texture: CanvasTexture;
  pxPerMm: number;
}

const EMPTY: readonly never[] = [];
const RESERVED_KEYS = new Set(['predict', 'flap', 'stamp', 'state']);

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function makeInkLayer(W: number, D: number, pxPerMm: number, make: (w: number, h: number) => HTMLCanvasElement): InkLayer {
  const canvas = make(Math.round(W * pxPerMm), Math.round(D * pxPerMm));
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return { ctx, texture, pxPerMm };
}

function bookLayout(book: BookApi): LayoutSource | undefined {
  const b = book as BookApi & Partial<LayoutSource>;
  return typeof b.regions === 'function' ? { regions: (k, side) => b.regions!(k, side) } : undefined;
}

function lessonEntityId(registry: EngineContext['registry'], n: number, spread: number): string {
  const id = `lesson-${n}`;
  return registry.has(id) ? `lesson-${n}-s${spread}` : id;
}

const rectOf = (r: PageRegion): PageRect => ({ u0: r.u, v0: r.v, u1: r.u + r.w, v1: r.v + r.h });

export function createRuntime(engine: EngineContext, o: RuntimeOptions): LessonRuntime {
  const T = runtimeTunables(engine.registry);
  const { book, lesson, spread, sound, progress } = o;
  const registry = engine.registry;
  const n = lesson.n;
  const id = lessonEntityId(registry, n, spread);
  const layout = o.layout ?? bookLayout(book);
  const session = o.session ?? createSession();
  const fonts: Fonts = { ...DEFAULT_FONTS, ...o.fonts };
  const W = book.dims.W, D = book.dims.D;
  const regions = (side: Side): readonly PageRegion[] => layout?.regions(spread, side) ?? EMPTY;

  const frame = computeLessonFrame(book, spread, T.frame);
  const frameInv = frame.clone().invert();
  const pop = o.createPop(engine, {
    frame: frame.clone(),
    printRect: { x0: T.print.x0, x1: T.print.x1, y0: T.print.y0, y1: T.print.y1 },
    pxPerMm: T.print.pxPerMm,
    cab: [T.print.cabX, T.print.cabY],
  });
  const applyFrame = () => {
    frameInv.copy(frame).invert();
    pop.frame.copy(frame);
    pop.group.matrixAutoUpdate = false;
    pop.group.matrix.copy(frame);
    pop.group.matrixWorldNeedsUpdate = true;
    (pop as typeof pop & { setFrame?(m: Matrix4): void }).setFrame?.(frame);
  };
  if (!pop.group.parent) engine.scene.add(pop.group);
  applyFrame();
  pop.setResolution(engine.resolution.x, engine.resolution.y);

  const switchDefs = new Map((lesson.figure.switches ?? []).map((s) => [s.id, s]));
  const switches: Record<string, string> = {};
  for (const s of switchDefs.values()) switches[s.id] = s.value;

  const quantityCache = new Map<string, ReturnType<FigureContext['quantity']>>();
  const ctx: FigureContext = {
    engine, pop, book, spread, sound, switches,
    quantity: (qid) => {
      if (!quantityCache.has(qid)) {
        const q = o.quantities.find((x) => x.id === qid);
        quantityCache.set(qid, q ? { id: q.id, label: q.label, color: new Color(q.color), hex: q.color, pattern: q.pattern } : undefined);
      }
      return quantityCache.get(qid);
    },
    register: (rid, label, tags, object, describe) => {
      registry.add({
        id: `${id}.${rid}`, label, tags: [...tags, 'lesson', 'figure'], kind: object ? 'figure-object' : 'figure-part', describe, object,
        parent: id, source: `world figure module "${lesson.figureModule}"`,
      });
    },
  };
  const behaviour = o.figure(ctx);

  const glow = [...behaviour.glowObjects()];
  for (const g of glow) {
    g.layers.enable(LAYERS.glow);
    o.post?.bloomSelect(g, true);
  }

  const leftSlot = book.pageSlot(spread, 'left');
  const rightSlot = book.pageSlot(spread, 'right');
  const pageRect = new Vector4(0, 0, W, D);
  const printRect = new Vector4();
  const updatePrintRect = () => printRect.set(frameOriginU(T.frame) + T.print.x0 + T.print.offsetU, T.frame.baselineV - T.print.y1, T.print.x1 - T.print.x0, T.print.y1 - T.print.y0);
  const make = o.canvas ?? makeCanvas;
  const inkL = makeInkLayer(W, D, T.ink.pxPerMm, make);
  const inkR = makeInkLayer(W, D, T.ink.pxPerMm, make);
  leftSlot.setInk(inkL.texture, pageRect, 1);
  rightSlot.setInk(inkR.texture, pageRect, 1);

  let flap: FlapCard | null = null;
  let flapOpen = false, flapAmount = 0, flapShown = false, printedOpen = false;
  let predict: number | null = null;
  let stamped = progress.stamped(n);
  let stampPress = stamped ? 1 : 0;
  if (stamped) o.pageState?.stamps.add(n);
  let margin: readonly MarginLine[] = EMPTY;
  let marginKey = '';
  let inkDirty = true, inkClock = 0, lastInk = -Infinity;
  let penLoop: SoundLoop | null = null;
  let active = true, forcedLive = false, disposed = false;
  let lastState: PopState = pop.state;
  let dragging = false;
  let lastInfo: PointerInfo | null = null;
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const dragPlane = new DragPlane();
  const dragHit = new Vector3();

  const penTick = () => {
    const opts = { gain: T.pen.tickGain, len: T.pen.tickLength };
    sound.play('pen', opts);
  };
  const stopPen = (fade: number) => {
    penLoop?.stop(fade);
    penLoop = null;
  };
  const trackState = () => {
    const s = pop.state;
    if (s === lastState) return;
    lastState = s;
    engine.events.emit('pop-state', { spread, state: s });
    if (s === 'live') engine.events.emit('live', { spread });
  };
  const forceLive = () => {
    if (pop.state === 'live') return;
    pop.set('live');
    forcedLive = true;
    session.liveSeen.add(spread);
    trackState();
  };

  function ensureFlap(): void {
    if (flap || !o.createFlap) return;
    const r = regions('left').find((x) => x.action === 'flap');
    if (!r) return;
    flap = o.createFlap({ spread, side: 'left', rect: rectOf(r), hinge: 'bottom', angle: T.flap.angle, face: { kind: 'lesson', n } });
    flap.object.userData.inkleafAction = 'flap';
    if (!flap.object.parent) engine.scene.add(flap.object);
    flap.visible = false;
    registry.add({
      id: `${id}.why-flap`, label: `Lesson ${n} Why? flap`, tags: ['object', 'paper', 'input', 'book', 'lesson'], kind: 'flap-card',
      object: flap.object, parent: id, describe: 'The 3D card over the explanation; tap it or the printed face to lift it.', source: 'src/engine/runtime/runtime.ts',
    });
  }

  function paintInk(): void {
    if (inkL.ctx) {
      let box: PageRect | null = null;
      let eqTop: number | null = null;
      for (const r of regions('left')) {
        if (predict !== null && r.action === `predict:${predict}`) box = rectOf(r);
        if (r.id === 'equation') eqTop = r.v;
      }
      paintLeftInk(inkL.ctx, inkL.pxPerMm, { predict: box, equationTop: eqTop, lines: margin, n, press: stampPress }, T, fonts);
      inkL.texture.needsUpdate = true;
    }
    if (inkR.ctx) {
      const chosen: PageRect[] = [];
      for (const r of regions('right')) {
        const a = parseAction(r.action);
        if (a?.type === 'switch' && switches[a.id] === a.value) chosen.push(rectOf(r));
      }
      paintRightInk(inkR.ctx, inkR.pxPerMm, chosen, T);
      inkR.texture.needsUpdate = true;
    }
  }

  function setPredict(i: number | null): void {
    if (i === null) return clearPredict();
    if (!Number.isInteger(i) || i < 0 || i >= lesson.predict.options.length) return;
    predict = predict === i ? null : i;
    inkDirty = true;
    penTick();
  }
  function clearPredict(): void {
    predict = null;
    inkDirty = true;
  }
  function setSwitch(sid: string, value: string | number): boolean {
    const def = switchDefs.get(sid);
    if (!def) return false;
    const v = typeof value === 'number' ? def.options[value] : value;
    if (v === undefined || !def.options.includes(v)) return false;
    switches[sid] = v;
    behaviour.onSwitch?.(sid, v, { restore: false });
    inkDirty = true;
    penTick();
    return true;
  }
  function toggleFlap(open?: boolean): void {
    const next = open ?? !flapOpen;
    if (next === flapOpen) return;
    flapOpen = next;
    sound.play('flap');
    if (next) progress.flap(n);
  }
  function stamp(): void {
    if (stamped) return;
    stamped = true;
    stampPress = engine.still ? 1 : 0.001;
    inkDirty = true;
    progress.stamp(n);
    o.pageState?.stamps.add(n);
    sound.play('stamp');
    o.onStampChange?.(n, true);
  }
  function unstamp(): void {
    if (!stamped) return;
    stamped = false;
    stampPress = 0;
    inkDirty = true;
    progress.unstamp(n);
    o.pageState?.stamps.delete(n);
    o.onStampChange?.(n, false);
  }
  function startPeel(): void {
    if (pop.state !== 'print') pop.set('print');
    pop.draw();
    if (!engine.still) {
      stopPen(0);
      penLoop = sound.loop('pen', { gain: T.pen.loopGain });
    }
    trackState();
  }
  function pointerAt(at: PointerAt): PointerInfo | null {
    clientToNdc(at.x, at.y, at.rect ?? engine.canvas.getBoundingClientRect(), ndc);
    raycaster.setFromCamera(ndc, engine.camera);
    const p = dragPlane.intersect(raycaster, dragHit);
    return p ? makePointerInfo(p, ndc, frameInv) : null;
  }
  function release(at?: PointerAt): void {
    if (!dragging) return;
    dragging = false;
    const info = (at && pointerAt(at)) || lastInfo;
    if (info) behaviour.release?.(info);
  }
  function framePose(pos: readonly number[], look: readonly number[], fov: number): CameraPose {
    return { pos: frameToWorld(frame, pos), look: frameToWorld(frame, look), fov };
  }

  const params: ParamSpec[] = [
    {
      key: 'predict', label: 'Prediction', type: 'number', min: -1, max: lesson.predict.options.length - 1, step: 1,
      help: 'Ticked option (0-based); -1 clears', get: () => predict ?? -1,
      set: (v) => {
        const i = Math.round(Number(v));
        if (i < 0) clearPredict();
        else if (predict !== i) setPredict(i);
      },
    },
    { key: 'flap', label: 'Why? flap lifted', type: 'boolean', help: 'Lift or lower the flap', get: () => flapOpen, set: (v) => toggleFlap(Boolean(v)) },
    { key: 'stamp', label: 'Stamp earned', type: 'boolean', help: 'Earn or remove the challenge stamp', get: () => stamped, set: (v) => (v ? stamp() : unstamp()) },
    {
      key: 'state', label: 'Pop-up state', type: 'enum', options: ['print', 'peel', 'live'], help: 'print: flat on the page; peel: draw it up again; live: skip to the running model',
      get: () => pop.state,
      set: (value) => {
        const v = String(value);
        if (v === 'live') forceLive();
        else if (v === 'peel') startPeel();
        else {
          stopPen(0);
          pop.set('print');
          rightSlot.setPrintAlpha(1);
          trackState();
        }
      },
    },
    ...[...switchDefs.values()].map((s): ParamSpec => ({
      key: RESERVED_KEYS.has(s.id) ? `switch-${s.id}` : s.id, label: s.label, type: 'enum', options: s.options,
      help: `Figure switch "${s.id}"`, get: () => switches[s.id] ?? s.value, set: (v) => void setSwitch(s.id, String(v)),
    })),
  ];
  registry.add({
    id, label: `Lesson ${n}: ${lesson.title}`, tags: ['lesson', 'data', 'interaction', 'control'], kind: 'lesson-runtime', params,
    describe: `Lesson ${n} on spread ${spread}: its prediction, flap, stamp, pop-up state and figure switches. Set a switch by its id, for example inkleaf.set('${id}', '${[...switchDefs.keys()][0] ?? 'flap'}', ...).`,
    source: `manifest lesson "${lesson.id}"`,
  });
  registry.add({
    id: `${id}.pop-model`, label: `Lesson ${n} pop-up model`, tags: ['object', 'ink', 'animation', 'lesson'], kind: 'pop-model', object: pop.group, parent: id,
    describe: 'The hand-inked 3D model: printed flat on the page, peeled up on arrival, sunk back before the page turns.', source: 'src/engine/runtime/runtime.ts',
  });
  registry.add({
    id: `${id}.page-ink`, label: `Lesson ${n} page handwriting`, tags: ['texture', 'ink', 'text', 'book', 'lesson'], kind: 'canvas-layer', parent: id,
    describe: 'Transparent ink layers over both pages: prediction tick, margin numbers, stamp, switch loops. Style: runtime.page-ink, runtime.stamp, runtime.switch-ring.',
    source: 'src/engine/runtime/ink.ts',
  });

  const offResize = engine.events.on('resize', ({ width, height, pixelRatio }) => pop.setResolution(Math.round(width * pixelRatio), Math.round(height * pixelRatio)));

  const rt: LessonRuntime = {
    n, spread, id, lesson, pop, behaviour, frame,
    get state() { return pop.state; },
    get live() { return pop.state === 'live'; },
    get forcedLive() { return forcedLive; },
    get predict() { return predict; },
    get flapOpen() { return flapOpen; },
    get flapAmount() { return flapAmount; },
    get stamped() { return stamped; },
    get stampPress() { return stampPress; },
    switches,
    get dragging() { return dragging; },
    captions: lesson.tour.map((s) => s.caption),
    shotCount: lesson.tour.length,

    prepare() {
      ensureFlap();
      behaviour.update(0, { live: false, still: false, paused: true, touring: false, camera: engine.camera });
      pop.group.updateMatrixWorld(true);
      const tex = pop.renderPrint();
      pop.set('print');
      updatePrintRect();
      rightSlot.setPrint(tex, printRect, 1);
      trackState();
      inkDirty = true;
    },

    arrive() {
      computeLessonFrame(book, spread, T.frame, frame);
      applyFrame();
      ensureFlap();
      active = true;
      flapOpen = false;
      flapAmount = 0;
      predict = null;
      inkDirty = true;
      if (pop.state === 'print') startPeel();
      progress.visit(n);
    },

    leave(opts = {}) {
      release();
      behaviour.leave?.();
      flapOpen = false;
      predict = null;
      inkDirty = true;
      stopPen(T.pen.loopStop);
      if (opts.instant || engine.still) {
        pop.set('print');
        rightSlot.setPrintAlpha(1);
        trackState();
        return Promise.resolve();
      }
      return pop.undraw();
    },

    update(dt: number, f: RuntimeFlags) {
      if (disposed) return;
      inkClock += dt;
      const { still, paused, touring } = f;

      const onSpread = active && book.openSpread === spread;
      if (onSpread && !flapShown) flapAmount = 0;
      flapShown = onSpread;
      const target = flapOpen ? 1 : 0;
      flapAmount = still ? target : flapAmount + (target - flapAmount) * (1 - Math.exp(-T.flap.rate * dt));
      if (flap) {
        flap.visible = onSpread;
        if (onSpread) {
          flap.place();
          flap.show(flapAmount);
        }
      }
      const printed = flapOpen || (onSpread && flapAmount > T.flap.printedAt);
      if (printed !== printedOpen) {
        printedOpen = printed;
        if (printed) o.pageState?.flapsOpen.add(spread);
        else o.pageState?.flapsOpen.delete(spread);
        book.invalidatePage(spread, 'left');
      }

      if (still && (pop.state === 'peel' || pop.state === 'shade')) pop.set('live');
      pop.update(dt);
      pop.group.visible = active && pop.state !== 'print';
      trackState();
      if (penLoop && pop.state !== 'peel') stopPen(T.pen.loopStop);
      rightSlot.setPrintAlpha(pop.printAlpha);

      const live = pop.state === 'live';
      behaviour.update(paused ? 0 : dt, { live, still, paused, touring, camera: engine.camera });
      if (live && !session.liveSeen.has(spread)) {
        session.liveSeen.add(spread);
        if (!still && !session.noEvent && !forcedLive) behaviour.onLive?.();
      }

      if (live && !touring && !stamped && behaviour.challenge?.().met) stamp();
      if (stampPress > 0 && stampPress < 1) {
        stampPress = still ? 1 : Math.min(1, stampPress + dt / Math.max(1e-3, T.stamp.press));
        inkDirty = true;
      }

      margin = live ? behaviour.margin?.() ?? EMPTY : EMPTY;
      let key = '';
      for (let i = 0; i < margin.length; i++) key += (i ? '|' : '') + margin[i]!.text;
      if (key !== marginKey) {
        marginKey = key;
        inkDirty = true;
      }
      if (inkDirty && inkClock - lastInk >= T.ink.throttle) {
        paintInk();
        lastInk = inkClock;
        inkDirty = false;
      }
    },

    setActive(on) {
      active = on;
      pop.group.visible = on && pop.state !== 'print';
      if (flap && !on) flap.visible = false;
    },

    setPredict, clearPredict, setSwitch, toggleFlap, stamp, unstamp,
    marginLines: () => margin,
    busy: () => behaviour.busy?.() ?? false,

    targets(down = false) {
      const s = pop.state;
      if (!active) return EMPTY;
      if (s === 'live' || (down && (s === 'peel' || s === 'shade'))) return behaviour.targets?.() ?? EMPTY;
      return EMPTY;
    },
    pick(at, down = false) {
      const list = rt.targets(down);
      if (!list.length) return null;
      const hit = pickTargets(raycaster, engine.camera, list, at, at.rect ?? engine.canvas.getBoundingClientRect(), T.pointer.touchScale, ndc);
      return hit ? { object: hit.object, point: hit.point.clone(), ndc: ndc.clone() } : null;
    },
    press(hit: PickHit) {
      if (pop.state !== 'live') forceLive();
      dragPlane.begin(hit.point, frame, engine.camera, T.pointer.dragPlane);
      const info = makePointerInfo(hit.point, hit.ndc, frameInv);
      const r = behaviour.press?.(hit.object, info);
      if (r === 'drag') {
        dragging = true;
        lastInfo = info;
      }
      return r;
    },
    drag(at) {
      if (!dragging) return;
      const info = pointerAt(at);
      if (!info) return;
      lastInfo = info;
      behaviour.drag?.(info);
    },
    release,
    cancelDrag: () => release(),
    hover: (target) => behaviour.hover?.(target),
    cursor: (target) => behaviour.cursor?.(target) ?? 'pointer',

    shot(i): ResolvedShot | null {
      const s = lesson.tour[i];
      if (!s) return null;
      const fov = T.tour.fov;
      let cam: TourCam | null;
      if (s.cam === 'text') cam = null;
      else if (s.cam === 'wide') cam = { pose: framePose(T.tour.widePos, T.tour.wideLook, fov), fov };
      else if (s.cam === 'figure') cam = { pose: framePose(T.tour.figurePos, T.tour.figureLook, fov), fov };
      else if ('follow' in s.cam) {
        const name = s.cam.follow;
        cam = { follow: () => behaviour.follow?.(name) ?? null, offset: frameDirToWorld(frame, T.tour.followOffset), fov };
      } else cam = { pose: framePose(s.cam.pos, s.cam.look, fov), fov };
      return { caption: s.caption, hold: s.hold ?? T.tour.hold, act: s.act, cam };
    },
    act: (name) => behaviour.act?.(name),
    restoreAfterTour() {
      behaviour.resetTour?.();
      for (const [sid, v] of Object.entries(switches)) behaviour.onSwitch?.(sid, v, { restore: true });
    },

    framePose,
    glowObjects: () => glow,
    lightSources: (): readonly GlowSource[] => (active && pop.state === 'live' ? behaviour.lightSources?.() ?? EMPTY : EMPTY),
    flapObject: () => (flap && flap.visible ? flap.object : null),
    a11y: () => [lesson.a11y, ...(behaviour.a11y?.() ?? EMPTY)],

    dispose() {
      if (disposed) return;
      release();
      disposed = true;
      behaviour.leave?.();
      stopPen(0);
      for (const g of glow) {
        o.post?.bloomSelect(g, false);
        g.layers.disable(LAYERS.glow);
      }
      offResize();
      pop.group.removeFromParent();
      pop.dispose();
      if (flap) {
        flap.object.removeFromParent();
        flap.dispose();
      }
      const zero = new Vector4(0, 0, 0, 0);
      leftSlot.setInk(null, zero, 0);
      rightSlot.setInk(null, zero, 0);
      rightSlot.setPrint(null, zero, 0);
      inkL.texture.dispose();
      inkR.texture.dispose();
      o.pageState?.flapsOpen.delete(spread);
      registry.removeTree(id);
    },
  };
  return rt;
}
