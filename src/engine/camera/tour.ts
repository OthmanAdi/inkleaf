/**
 * Watch mode: a guided demonstration of a lesson figure. A fixed cadence of short shots (2 s each by default),
 * each with a camera pose in the lesson frame (fixed, following a moving part, or the reading view), a caption and
 * an optional lesson action. Starts by itself 0.9 s after a lesson's model goes live on its first visit, once the
 * figure is not busy and no pointer is down. Space pauses, Escape stops, any canvas press stops.
 */
import { Vector3 } from 'three';
import type { CameraPose, EngineContext, FigureBehaviour, Unsubscribe } from '../contracts';
import { registerCameraConfig } from './config';
import { makePose, vec } from './math';
import type { CameraRig, TourShot } from './rig';

/** One shot of a tour: a superset of the world manifest's tour shot. */
export interface TourShotDef {
  /** `wide`: high establishing view; `figure`: close 3/4 view of the figure; `text`/null: the reading view; explicit poses are lesson-frame mm. */
  cam?: null | 'wide' | 'figure' | 'text'
    | { pos: readonly number[]; look: readonly number[]; fov?: number }
    | { follow: string; offset?: readonly number[]; fov?: number };
  caption: string;
  /** Seconds this shot lasts (default: the tour's shot length). */
  hold?: number;
  /** A lesson action fired when the shot starts. */
  act?: string;
  fov?: number;
}

/** Shot timing: which shot is on at time t, and when the tour is over. */
export class TourTimeline {
  readonly starts: number[] = [];
  readonly total: number;
  constructor(holds: readonly number[], readonly endPad: number) {
    let t = 0;
    for (const h of holds) {
      this.starts.push(t);
      t += h;
    }
    this.total = t;
  }
  get count(): number {
    return this.starts.length;
  }
  index(t: number): number {
    let i = 0;
    while (i + 1 < this.starts.length && t >= this.starts[i + 1]!) i++;
    return i;
  }
  ended(t: number): boolean {
    return t > this.total + this.endPad;
  }
}

export interface TourDeps {
  ctx: EngineContext;
  rig: CameraRig;
  /** The current lesson figure, if the current spread is a lesson. */
  figure(): FigureBehaviour | null;
  /** Tour shots of the current spread (null when it has none). */
  shots(): readonly TourShotDef[] | null;
  spread(): number;
  /** Whether the current lesson model is live. */
  live(): boolean;
  /** False while landing or otherwise unable to tour. */
  canStart?(): boolean;
  /** True while a pointer operation is in progress (blocks the automatic start). */
  pointerActive?(): boolean;
  /** Caption mode of the toolbar: text or null to leave it. */
  caption?(text: string | null, index: number, count: number, paused: boolean, opts: { natural: boolean }): void;
  /** Sound is held (muted without changing the preference) while paused. */
  sound?: { hold(on: boolean): void };
  /** Called when a tour starts (hide the lens, reset the cursor). */
  onStart?(): void;
  /** Called after a tour stops (re-apply the user's switch choices). */
  onStop?(natural: boolean): void;
  /** A tour was watched on this spread (persist it). */
  watched?(spread: number): void;
  now?(): number;
}

export interface Tour {
  readonly running: boolean;
  readonly paused: boolean;
  readonly t: number;
  readonly index: number;
  /** Starts the tour of the current spread; `fromButton` honours the restart debounce. Returns whether it started. */
  start(opts?: { fromButton?: boolean }): boolean;
  stop(natural?: boolean): void;
  togglePause(): void;
  /** Schedules the automatic start for a spread (called on a lesson's first visit). */
  scheduleAuto(spread: number): void;
  cancelAuto(): void;
  update(dt: number): void;
  dispose(): void;
}

export function createTour(deps: TourDeps, opts: { autoUpdate?: boolean } = {}): Tour {
  const { ctx, rig } = deps;
  const cfg = registerCameraConfig(ctx.registry).tour;
  const now = deps.now ?? (() => performance.now());
  let running = false;
  let paused = false;
  let t = 0;
  let idx = -1;
  let shots: readonly TourShotDef[] = [];
  let timeline = new TourTimeline([], 0);
  let endedAt = -Infinity;
  let auto: { spread: number; at: number | null } | null = null;
  const follow = new Vector3();

  function shotFor(s: TourShotDef): TourShot | null {
    const c = s.cam;
    const fig = deps.figure();
    if (!c || c === 'text') return null;
    const fixed = (p: readonly number[], l: readonly number[], fov?: number): TourShot => {
      const out: CameraPose = makePose();
      vec(p, out.pos);
      vec(l, out.look);
      out.fov = fov ?? s.fov ?? 30;
      return { pose: out, fov: out.fov };
    };
    if (c === 'wide') return fixed(cfg.widePos, cfg.wideLook);
    if (c === 'figure') return fixed(rig.config.hero.pos, rig.config.hero.look, rig.config.hero.fov);
    if ('follow' in c) {
      const name = c.follow;
      return {
        follow: () => {
          const p = fig?.follow?.(name);
          return p ? follow.copy(p) : null;
        },
        offset: c.offset ? vec(c.offset) : undefined,
        fov: c.fov ?? s.fov,
      };
    }
    return fixed(c.pos, c.look, c.fov);
  }

  function enter(i: number): void {
    idx = i;
    const s = shots[i]!;
    rig.setTourShot(shotFor(s));
    if (s.act) deps.figure()?.act?.(s.act);
    deps.caption?.(s.caption, i, shots.length, paused, { natural: false });
  }

  function start(o: { fromButton?: boolean } = {}): boolean {
    if (o.fromButton && now() - endedAt < cfg.restartDebounce * 1000) return false;
    const list = deps.shots();
    if (!list?.length || ctx.still || deps.canStart?.() === false || !deps.figure()) return false;
    if (running) stop();
    if (!deps.live()) {
      tour.scheduleAuto(deps.spread());
      return false;
    }
    deps.onStart?.();
    rig.cancelHero();
    shots = list;
    timeline = new TourTimeline(list.map((s) => s.hold ?? cfg.shotSeconds), cfg.endPad);
    running = true;
    paused = false;
    t = 0;
    idx = -1;
    auto = null;
    rig.setTour(true, false);
    deps.watched?.(deps.spread());
    enter(0);
    return true;
  }

  function stop(natural = false): void {
    if (!running) return;
    running = false;
    paused = false;
    idx = -1;
    rig.setTour(false);
    deps.sound?.hold(false);
    deps.figure()?.resetTour?.();
    deps.onStop?.(natural);
    deps.caption?.(null, 0, shots.length, false, { natural });
    if (natural) endedAt = now();
  }

  function update(dt: number): void {
    if (running) {
      if (!paused) t += dt;
      const i = timeline.index(t);
      if (i !== idx) enter(i);
      if (timeline.ended(t)) stop(true);
      return;
    }
    if (!auto || !cfg.autoStart || ctx.still) return;
    const fig = deps.figure();
    if (auto.spread !== deps.spread() || !fig || !deps.live() || fig.busy?.() || deps.pointerActive?.()) return;
    auto.at ??= now() + cfg.autoDelay * 1000;
    if (now() > auto.at) start();
  }

  const unsubs: Unsubscribe[] = [];
  if (opts.autoUpdate !== false) unsubs.push(ctx.onFrame('tour', (f) => update(f.still ? 0 : f.dt)));
  unsubs.push(ctx.events.on('turn-start', () => {
    stop();
    auto = null;
  }));
  unsubs.push(ctx.events.on('still', ({ on }) => {
    if (on) {
      stop();
      auto = null;
    }
  }));

  const tour: Tour = {
    get running() {
      return running;
    },
    get paused() {
      return paused;
    },
    get t() {
      return t;
    },
    get index() {
      return idx;
    },
    start,
    stop,
    togglePause() {
      if (!running) return;
      paused = !paused;
      rig.setTour(true, paused);
      deps.sound?.hold(paused);
      const s = shots[idx];
      if (s) deps.caption?.(s.caption, idx, shots.length, paused, { natural: false });
    },
    scheduleAuto(spread) {
      if (ctx.still || !cfg.autoStart) return;
      auto = { spread, at: null };
    },
    cancelAuto() {
      auto = null;
    },
    update,
    dispose() {
      stop();
      for (const u of unsubs) u();
    },
  };
  return tour;
}
