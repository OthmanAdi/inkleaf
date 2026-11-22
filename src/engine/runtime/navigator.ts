/**
 * The navigator: which spread is open and how the reader gets to another one. It queues turns (the latest request
 * wins), sinks the leaving lesson's model back into its print before a leaf lifts, picks the page-turn or riffle
 * sound, and on arrival peels up the new figure, holds the hero camera after the opening, arms the first-visit tour
 * and moves the bookmark. It also runs the boot sequence (ready gate, the book opening by itself), deep links, page
 * actions (`goto:`, `predict:`, `switch:`, `flap`, `quiz:`, `quiz-flap:`, `source:`, `link:`, `reset`) and the quiz
 * flaps.
 */
import type { Object3D } from 'three';
import type { BookApi, CameraRigApi, EngineContext, FrameInfo, Side, SoundApi, Unsubscribe } from '../contracts';
import { parseAction, parseDeepLink } from './actions';
import type { FlapCard, FlapFactory, LayoutSource, TourControl } from './deps';
import type { Progress } from './progress';
import type { RuntimeOptions } from './runtime';
import { navTunables, runtimeTunables } from './tunables';
import { createSession, type LessonRuntime, type RuntimeSession, type SpreadInfo } from './types';
import type { WorldModel } from './world';

export interface LocationLike {
  hash: string;
  search: string;
  pathname: string;
}

export interface HistoryLike {
  replaceState(data: unknown, unused: string, url?: string | null): void;
}

export interface QuizScore {
  right: number;
  picked: number;
  checked: number;
  of: number;
  complete: boolean;
}

/** Calls into packages the navigator does not own (UI, input, a11y). All optional. */
export interface NavigatorHooks {
  /** Before every navigation, after the tour, hero and drag are stopped: cursor default, hide the lens, clear the pointer operation and pending click, close dialogs, collapse the sheet. */
  cleanup?(): void;
  /** After arrival: capsule label, a11y text version, live-region announcement, sheet content. */
  arrived?(info: SpreadInfo, rt: LessonRuntime | null): void;
  /** The ready gate passed: fade the loader. */
  ready?(): void;
  /** The reader asked to start again; resolve true to clear progress. */
  confirmReset?(): boolean | Promise<boolean>;
  /** A lesson stamp was earned (announce it). */
  stamped?(n: number): void;
  /** Every quiz flap has been lifted. */
  quizComplete?(score: QuizScore): void;
  /** Leave the book for a source or link (default: same tab, after storing the spread in the URL hash). */
  open?(url: string): void;
}

/** Options the navigator hands to every runtime it builds; spread them into `createRuntime`. */
export type RuntimeShared = Required<Pick<RuntimeOptions, 'session' | 'pageState' | 'onStampChange'>>;

export interface NavigatorDeps {
  world: WorldModel;
  book: BookApi;
  sound: SoundApi;
  progress: Progress;
  /** Builds the runtime of a lesson spread (the navigator calls `prepare()` and caches it). */
  makeRuntime(spread: number, shared: RuntimeShared): LessonRuntime | Promise<LessonRuntime>;
  camera?: Pick<CameraRigApi, 'hold'>;
  tour?: TourControl;
  /** Quiz flap cards (book package). */
  createFlap?: FlapFactory;
  layout?: LayoutSource;
  /** True while a pointer operation is in progress (the automatic tour waits). */
  pointerBusy?: () => boolean;
  hooks?: NavigatorHooks;
  location?: LocationLike | null;
  history?: HistoryLike | null;
  /** URL flags: `shot` (capture mode: no landing, hero or tours), `nowatch`, `noevent`. Read from `location.search` when omitted. */
  flags?: { shot?: boolean; nowatch?: boolean; noevent?: boolean };
  /** Milliseconds clock (default `performance.now`). */
  now?: () => number;
  idle?: (fn: () => void) => void;
  /** Run the ready gate from the frame loop (default true); false means the app calls `ready()`. */
  autoReady?: boolean;
}

export interface Navigator {
  readonly k: number;
  readonly landing: boolean;
  readonly turning: boolean;
  /** Where the book is heading: queued ?? running turn ?? current. */
  readonly target: number;
  readonly session: RuntimeSession;
  readonly current: LessonRuntime | null;
  readonly heroActive: boolean;
  runtime(spread: number): LessonRuntime | null;
  ensureRuntime(spread: number): Promise<LessonRuntime | null>;
  /** Boot: restore progress marks, follow a deep link (instant) or prebuild the first lesson. */
  start(): Promise<void>;
  ready(): void;
  goTo(spread: number, opts?: { duration?: number; instant?: boolean }): Promise<void>;
  /** Relative turn from where the book is heading; during the opening it skips the opening instead. */
  step(delta: number): Promise<void>;
  /** Skips the opening (instant jump, default the first lesson) and cancels a hero hold. True when input should be swallowed. */
  skip(target?: number): boolean;
  /** Runs a page action string; false when it is not one. */
  handleAction(action: string): boolean;
  startTour(): boolean;
  stopTour(): void;
  cancelHero(): void;
  hashChanged(): void;
  stampChanged(n: number, stamped: boolean): void;
  quizPick(q: number, option: number): void;
  toggleQuizFlap(q: number): void;
  quizScore(): QuizScore;
  /** 3D flap cards currently shown (lesson flap and quiz flaps); each carries `userData.inkleafAction`. */
  flapObjects(): readonly Object3D[];
  resetAll(): Promise<void>;
  update(f: FrameInfo): void;
  updateFlaps(f: FrameInfo): void;
  dispose(): void;
}

interface QuizFlap {
  q: number;
  side: Side;
  card: FlapCard;
  amount: number;
  shown: boolean;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function urlFlags(loc: LocationLike | null | undefined) {
  const p = new URLSearchParams(loc?.search ?? '');
  return { shot: p.has('shot'), nowatch: p.has('nowatch'), noevent: p.has('noevent') };
}

export function createNavigator(engine: EngineContext, deps: NavigatorDeps): Navigator {
  const { world, book, sound, progress } = deps;
  const N = navTunables(engine.registry);
  const R = runtimeTunables(engine.registry);
  const hooks = deps.hooks ?? {};
  const loc = deps.location === undefined ? (typeof location !== 'undefined' ? location : null) : deps.location;
  const hist = deps.history === undefined ? (typeof history !== 'undefined' ? history : null) : deps.history;
  const flags = { ...urlFlags(loc), ...deps.flags };
  const now = deps.now ?? (() => performance.now());
  const idle = deps.idle ?? ((fn: () => void) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => fn()) : setTimeout(fn, 1)));
  const last = world.lastSpread;
  const first = world.firstLessonSpread;
  const firstLessonN = world.spreads[first]?.lesson?.n;
  const pageState = world.pageState;
  const session = createSession(!!flags.noevent);

  let k = 0;
  let landing = true, turning = false;
  let turnTo: number | null = null, queued: number | null = null;
  let skipped = false, deepLinked = false, autoLanding = false, autoOpenStarted = false;
  let bootAt: number | null = null;
  let frames = 0;
  let heroUntil = 0;
  let autoWatch: { k: number; at: number | null } | null = null;
  let epoch = 0;
  const visited = new Set<number>();
  const runtimes = new Map<number, LessonRuntime>();
  const pending = new Map<number, Promise<LessonRuntime>>();

  const quizSpread = world.special.quiz;
  const quizSpec = quizSpread !== undefined ? world.manifest.spreads[world.spreads[quizSpread]!.index] : undefined;
  const questions = quizSpec?.kind === 'quiz' ? quizSpec.questions : [];
  const quizSide = new Map<number, Side>();
  if (quizSpread !== undefined) {
    for (const side of ['left', 'right'] as const) {
      const p = world.page(quizSpread, side);
      if (p?.kind === 'quiz') for (const item of p.questions) quizSide.set(item.q, side);
    }
  }
  const quizShown = new Set<number>();
  let quizFlaps: QuizFlap[] | null = null;

  const shared: RuntimeShared = {
    session,
    pageState,
    onStampChange: (n, on) => nav.stampChanged(n, on),
  };

  const current = (): LessonRuntime | null => runtimes.get(k) ?? null;

  function ensureRuntime(s: number): Promise<LessonRuntime | null> {
    if (world.spreads[s]?.kind !== 'lesson') return Promise.resolve(null);
    const have = runtimes.get(s);
    if (have) return Promise.resolve(have);
    let p = pending.get(s);
    if (!p) {
      const at = epoch;
      p = Promise.resolve(deps.makeRuntime(s, shared)).then((rt) => {
        pending.delete(s);
        if (at !== epoch) {
          rt.dispose();
          return ensureRuntime(s) as Promise<LessonRuntime>;
        }
        rt.prepare();
        if (s !== k) rt.setActive(false);
        runtimes.set(s, rt);
        return rt;
      });
      pending.set(s, p);
    }
    return p;
  }

  function cancelHero(): void {
    if (!heroUntil) return;
    heroUntil = 0;
    deps.camera?.hold(null);
  }

  function stopTour(): void {
    if (deps.tour?.running) deps.tour.stop();
  }

  function startTour(): boolean {
    const rt = current();
    if (!rt || engine.still || landing || !deps.tour) return false;
    if (!rt.live) {
      autoWatch = { k, at: null };
      return false;
    }
    if (deps.tour.running) deps.tour.stop();
    cancelHero();
    autoWatch = null;
    deps.tour.start(rt);
    progress.markWatched(rt.n);
    return true;
  }

  function invalidateQuiz(): void {
    if (quizSpread === undefined) return;
    book.invalidatePage(quizSpread, 'left');
    book.invalidatePage(quizSpread, 'right');
  }

  function clearQuiz(): void {
    pageState.quizPicks.clear();
    pageState.quizOpen.clear();
    pageState.quizChecked.clear();
    quizShown.clear();
    for (const f of quizFlaps ?? []) f.amount = 0;
    invalidateQuiz();
  }

  function cleanup(from: number, to: number): void {
    stopTour();
    autoWatch = null;
    cancelHero();
    runtimes.get(from)?.cancelDrag();
    hooks.cleanup?.();
    if (from === quizSpread && to !== from && !N.quiz.persist) clearQuiz();
  }

  function ensureQuizFlaps(target: number): void {
    if (quizFlaps || quizSpread === undefined || !deps.createFlap || target < quizSpread - N.quiz.prepareBefore) return;
    const list: QuizFlap[] = [];
    for (const side of ['left', 'right'] as const) {
      for (const r of deps.layout?.regions(quizSpread, side) ?? []) {
        const a = parseAction(r.action);
        if (a?.type !== 'quiz-flap') continue;
        const card = deps.createFlap({ spread: quizSpread, side, rect: { u0: r.u, v0: r.v, u1: r.u + r.w, v1: r.v + r.h }, hinge: 'outer', angle: N.quiz.angle, face: { kind: 'quiz', q: a.q } });
        card.object.userData.inkleafAction = r.action;
        card.visible = false;
        if (!card.object.parent) engine.scene.add(card.object);
        list.push({ q: a.q, side, card, amount: 0, shown: false });
      }
    }
    if (list.length) quizFlaps = list;
  }

  function setBookmark(s: number): void {
    if (!progress.setBookmark(s)) return;
    pageState.bookmark = s;
    if (world.special.contents !== undefined) book.invalidatePage(world.special.contents, 'right');
  }

  function arrive(t: number): void {
    const fromLanding = landing;
    k = t;
    landing = false;
    const info = world.spreads[t]!;
    const rt = runtimes.get(t) ?? null;
    for (const [s, r] of runtimes) r.setActive(s === t);
    if (!autoLanding && info.kind !== 'contents' && info.kind !== 'cover') setBookmark(t);
    autoLanding = false;
    rt?.arrive();
    if (fromLanding && rt && info.kind === 'lesson' && !flags.shot && !skipped && !engine.still && N.hero.enabled && engine.camera.aspect >= N.hero.minAspect) {
      const hold = info.lesson?.n === firstLessonN ? N.hero.holdFirst : N.hero.holdOther;
      heroUntil = now() + hold * 1000;
      deps.camera?.hold(rt.framePose(N.hero.pos, N.hero.look, N.hero.fov), heroUntil);
    }
    if (info.kind === 'lesson' && !visited.has(t)) {
      visited.add(t);
      if (!flags.shot && !engine.still && !flags.nowatch && N.watch.enabled) autoWatch = { k: t, at: null };
    }
    engine.events.emit('arrive', { spread: t });
    hooks.arrived?.(info, rt);
    const next = world.spreads.find((s) => s.k > t && s.kind === 'lesson');
    if (next && !runtimes.has(next.k)) idle(() => void ensureRuntime(next.k));
  }

  async function goTo(target: number, opts: { duration?: number; instant?: boolean } = {}): Promise<void> {
    const t = clamp(Math.round(target), 1, last);
    if (turning) {
      queued = t === turnTo ? null : t;
      return;
    }
    if (t === k && !landing) return;
    const from = k;
    cleanup(from, t);
    turning = true;
    turnTo = t;
    if (from >= 1) engine.events.emit('leave', { spread: from });
    const leaving = runtimes.get(from) ?? null;
    try {
      await ensureRuntime(t);
      ensureQuizFlaps(t);
      if (opts.instant || engine.still) {
        if (leaving) await leaving.leave({ instant: true });
        await book.goTo(t, { instant: true });
      } else {
        sound.play(Math.abs(t - from) > N.turn.riffleOver ? 'riffle' : 'pageTurn');
        if (leaving) await leaving.leave();
        await book.goTo(t, { duration: opts.duration ?? N.turn.duration });
      }
    } finally {
      turning = false;
      turnTo = null;
    }
    const q = queued;
    queued = null;
    if (q !== null && q !== t) {
      k = t;
      return goTo(q);
    }
    arrive(t);
  }

  function skip(target?: number): boolean {
    cancelHero();
    if (!landing) return false;
    skipped = true;
    const t = clamp(Math.round(target ?? first), 1, last);
    autoLanding = t === first;
    void goTo(t, { instant: true });
    return true;
  }

  function clearHash(): void {
    if (!loc || !hist) return;
    hist.replaceState(null, '', loc.pathname + loc.search);
  }

  function leaveFor(url: string): void {
    const hash = world.spreads[k]?.hash;
    if (loc && hist && hash) hist.replaceState(null, '', loc.pathname + loc.search + hash);
    if (hooks.open) hooks.open(url);
    else globalThis.location?.assign(url);
  }

  async function confirmAndReset(): Promise<void> {
    stopTour();
    const ok = hooks.confirmReset ? await hooks.confirmReset() : typeof confirm === 'function' && confirm('Start again? Your stamps and bookmark will be cleared.');
    if (ok) await resetAll();
  }

  async function resetAll(): Promise<void> {
    stopTour();
    autoWatch = null;
    cancelHero();
    progress.reset();
    clearQuiz();
    epoch++;
    session.liveSeen.clear();
    visited.clear();
    pageState.stamps.clear();
    pageState.flapsOpen.clear();
    pageState.bookmark = first;
    for (const rt of runtimes.values()) rt.dispose();
    runtimes.clear();
    pending.clear();
    for (let s = 1; s <= last; s++) {
      book.invalidatePage(s, 'left');
      book.invalidatePage(s, 'right');
    }
    book.setRibbon(first);
    if (world.spreads[k]?.kind === 'lesson') {
      const rt = await ensureRuntime(k);
      rt?.setActive(true);
      rt?.arrive();
    }
  }

  function quizScore(): QuizScore {
    let right = 0;
    for (const [q, o] of pageState.quizPicks) if (questions[q]?.answer === o) right++;
    const of = questions.length;
    return { right, picked: pageState.quizPicks.size, checked: pageState.quizChecked.size, of, complete: of > 0 && pageState.quizChecked.size >= of };
  }

  function quizPick(q: number, option: number): void {
    const question = questions[q];
    if (!question || option < 0 || option >= question.options.length) return;
    const next = pageState.quizPicks.get(q) === option ? null : option;
    if (next === null) pageState.quizPicks.delete(q);
    else pageState.quizPicks.set(q, next);
    if (N.quiz.persist) progress.quizPick(q, next);
    const opts = { gain: R.pen.tickGain, len: R.pen.tickLength };
    sound.play('pen', opts);
    invalidateQuiz();
  }

  function setQuizPrinted(q: number, printed: boolean): void {
    if (pageState.quizOpen.has(q) === printed) return;
    if (printed) pageState.quizOpen.add(q);
    else pageState.quizOpen.delete(q);
    if (quizSpread !== undefined) book.invalidatePage(quizSpread, quizSide.get(q) ?? 'left');
  }

  function toggleQuizFlap(q: number): void {
    if (q < 0 || q >= questions.length) return;
    const open = !quizShown.has(q);
    if (open) quizShown.add(q);
    else quizShown.delete(q);
    sound.play('flap');
    if (open && !pageState.quizChecked.has(q)) {
      pageState.quizChecked.add(q);
      if (N.quiz.persist) progress.quizOpen(q, true);
      if (pageState.quizChecked.size === questions.length) {
        sound.play('stamp', { delay: N.quiz.stampDelay });
        hooks.quizComplete?.(quizScore());
        invalidateQuiz();
      }
    }
    if (!quizFlaps?.some((f) => f.q === q)) setQuizPrinted(q, open);
  }

  function update(f: FrameInfo): void {
    frames++;
    const t = now();
    if (deps.autoReady !== false && bootAt === null && frames >= N.landing.readyFrames && (f.still || flags.shot || t >= N.landing.readyAfter * 1000)) nav.ready();
    if (landing && bootAt !== null && !autoOpenStarted && !skipped && !deepLinked && !flags.shot && N.landing.auto && t - bootAt > N.landing.delay * 1000) {
      autoOpenStarted = true;
      autoLanding = true;
      void goTo(first, { duration: N.turn.landingDuration });
    }
    const rt = current();
    if (rt) rt.update(f.dt, { still: f.still, paused: deps.tour?.paused ?? false, touring: deps.tour?.running ?? false });
    if (heroUntil && t >= heroUntil) heroUntil = 0;
    if (autoWatch && autoWatch.k === k && rt && !turning && rt.live && !rt.busy() && !(deps.pointerBusy?.() ?? false)) {
      autoWatch.at ??= t + N.watch.delay * 1000;
      if (t > autoWatch.at) {
        autoWatch = null;
        startTour();
      }
    }
  }

  function updateFlaps(f: FrameInfo): void {
    if (!quizFlaps || quizSpread === undefined) return;
    const onQuiz = book.openSpread === quizSpread;
    const h = 1 - Math.exp(-N.quiz.rate * f.dt);
    for (const fl of quizFlaps) {
      if (onQuiz && !fl.shown) fl.amount = 0;
      fl.shown = onQuiz;
      fl.card.visible = onQuiz;
      const target = quizShown.has(fl.q) ? 1 : 0;
      fl.amount = f.still ? target : fl.amount + (target - fl.amount) * h;
      if (onQuiz) {
        fl.card.place();
        fl.card.show(fl.amount);
      }
      setQuizPrinted(fl.q, quizShown.has(fl.q) || (onQuiz && fl.amount > R.flap.printedAt));
    }
  }

  const offs: Unsubscribe[] = [
    engine.onFrame('runtime', (f) => update(f)),
    engine.onFrame('flaps', (f) => updateFlaps(f)),
    engine.events.on('still', ({ on }) => {
      if (!on) return;
      stopTour();
      autoWatch = null;
      cancelHero();
    }),
  ];

  engine.registry.add({
    id: 'nav', label: 'Navigator', kind: 'navigator', tags: ['book', 'control', 'data'], source: 'src/engine/runtime/navigator.ts',
    describe: 'The open spread and the bookmark. Set spread to turn there; the turn waits for the open lesson to sink back into its page.',
    params: [
      { key: 'spread', label: 'Open spread', type: 'number', min: 1, max: last, step: 1, help: 'Turn to this spread', get: () => k, set: (v) => void goTo(Number(v)) },
      { key: 'bookmark', label: 'Bookmark', type: 'number', min: 1, max: last, step: 1, help: 'Spread of the contents page "continue" link', get: () => progress.bookmark, set: (v) => setBookmark(clamp(Math.round(Number(v)), 1, last)) },
    ],
  });

  const nav: Navigator = {
    get k() { return k; },
    get landing() { return landing; },
    get turning() { return turning; },
    get target() { return queued ?? turnTo ?? k; },
    session,
    get current() { return current(); },
    get heroActive() { return heroUntil > 0; },
    runtime: (s) => runtimes.get(s) ?? null,
    ensureRuntime,

    async start() {
      pageState.bookmark = clamp(progress.bookmark, 1, last);
      book.setRibbon(pageState.bookmark);
      for (const s of world.spreads) if (s.lesson && progress.stamped(s.lesson.n)) pageState.stamps.add(s.lesson.n);
      if (N.quiz.persist) {
        for (const [q, o] of Object.entries(progress.data.quiz.picks)) pageState.quizPicks.set(Number(q), o);
        for (const q of Object.keys(progress.data.quiz.open)) pageState.quizChecked.add(Number(q));
      }
      const link = loc ? parseDeepLink(loc, world) : null;
      if (link !== null) {
        skipped = true;
        deepLinked = true;
        if (loc?.hash) clearHash();
        await goTo(link, { instant: true });
      } else {
        await ensureRuntime(first);
      }
    },

    ready() {
      if (bootAt !== null) return;
      bootAt = now();
      hooks.ready?.();
    },

    goTo,
    step(delta) {
      if (landing) {
        skip();
        return Promise.resolve();
      }
      return goTo((queued ?? turnTo ?? k) + delta);
    },
    skip,

    handleAction(action) {
      const a = parseAction(action);
      if (!a) return false;
      const rt = current();
      switch (a.type) {
        case 'goto': void goTo(a.spread); break;
        case 'reset': void confirmAndReset(); break;
        case 'predict': stopTour(); rt?.setPredict(a.index); break;
        case 'switch': stopTour(); rt?.setSwitch(a.id, a.value); break;
        case 'flap': stopTour(); rt?.toggleFlap(); break;
        case 'quiz': quizPick(a.q, a.option); break;
        case 'quiz-flap': toggleQuizFlap(a.q); break;
        case 'source': {
          const src = world.manifest.sources.find((s) => s.n === a.n);
          if (src) leaveFor(src.url);
          break;
        }
        case 'link': leaveFor(a.url); break;
      }
      return true;
    },

    startTour, stopTour, cancelHero,

    hashChanged() {
      if (!loc) return;
      const t = parseDeepLink({ hash: loc.hash, search: '' }, world);
      if (t === null) return;
      clearHash();
      if (landing) skip(t);
      else void goTo(t);
    },

    stampChanged(n, on) {
      if (world.special.contents !== undefined) book.invalidatePage(world.special.contents, 'right');
      if (on) hooks.stamped?.(n);
    },

    quizPick, toggleQuizFlap, quizScore,

    flapObjects() {
      const out: Object3D[] = [];
      const lessonFlap = current()?.flapObject();
      if (lessonFlap) out.push(lessonFlap);
      for (const f of quizFlaps ?? []) if (f.card.visible) out.push(f.card.object);
      return out;
    },

    resetAll, update, updateFlaps,

    dispose() {
      for (const off of offs) off();
      for (const rt of runtimes.values()) rt.dispose();
      runtimes.clear();
      for (const f of quizFlaps ?? []) {
        f.card.object.removeFromParent();
        f.card.dispose();
      }
      quizFlaps = null;
      engine.registry.remove('nav');
    },
  };
  return nav;
}
