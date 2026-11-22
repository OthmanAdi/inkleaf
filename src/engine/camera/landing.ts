/**
 * The opening sequence: once the first frames are ready the closed book waits briefly, opens by itself to the first
 * lesson (the camera glides from the closed view to the reading view, driven by the book position), and on arrival
 * the camera dollies in for the hero hold. Any input during the opening skips it: an instant jump, input swallowed.
 */
import type { EngineContext, Unsubscribe } from '../contracts';
import { registerCameraConfig } from './config';
import type { CameraRig } from './rig';

export interface LandingDeps {
  ctx: EngineContext;
  rig: CameraRig;
  /** The app's navigator. `landing` marks the automatic opening (it must not move the reader's bookmark). */
  goTo(spread: number, opts: { duration?: number; instant?: boolean; landing?: boolean }): void;
  turning(): boolean;
  /** Queue a target while a turn is running. */
  queue?(spread: number): void;
  /** Lesson number of a spread, or null. */
  lessonOf(spread: number): number | null;
  lastSpread: number;
  /** Spread the Contents control goes to (default 1). */
  contentsSpread?: number;
  now?(): number;
}

export interface Landing {
  /** True from boot until the first arrival. */
  readonly active: boolean;
  readonly skipped: boolean;
  /** True while the automatic opening is under way (the app does not bookmark it). */
  readonly auto: boolean;
  /** The ready gate passed: the opening starts after the configured delay. */
  ready(): void;
  /**
   * Input during the opening: skips it with an instant jump (Contents goes to the contents spread) and returns true
   * (swallow the input). After the opening it only cancels a running hero hold and returns false.
   */
  skip(kind?: 'contents' | 'default'): boolean;
  /** A deep link at boot: jump there, no opening and no hero hold. */
  deepLink(spread: number): void;
  update(): void;
  dispose(): void;
}

export function createLanding(deps: LandingDeps, opts: { autoUpdate?: boolean } = {}): Landing {
  const { ctx, rig } = deps;
  const cfg = registerCameraConfig(ctx.registry).landing;
  const now = deps.now ?? (() => performance.now());
  let active = cfg.enabled;
  let bootAt: number | null = null;
  let started = false;
  let skipped = false;
  let auto = false;

  const target = () => Math.min(deps.lastSpread, Math.max(1, Math.round(cfg.target)));

  function update(): void {
    if (!active || bootAt === null || started) return;
    if (now() - bootAt > cfg.delay * 1000) {
      started = true;
      auto = true;
      deps.goTo(target(), { duration: cfg.duration, landing: true });
    }
  }

  const unsubs: Unsubscribe[] = [];
  if (opts.autoUpdate !== false) unsubs.push(ctx.onFrame('after', update));
  unsubs.push(ctx.events.on('arrive', ({ spread }) => {
    if (!active) {
      auto = false;
      return;
    }
    active = false;
    const fromLanding = started && !skipped;
    auto = false;
    const lesson = deps.lessonOf(spread);
    if (fromLanding && lesson !== null && !ctx.still && (ctx.camera.aspect || 1) >= 1) rig.heroHold(lesson);
  }));

  return {
    get active() {
      return active;
    },
    get skipped() {
      return skipped;
    },
    get auto() {
      return auto;
    },
    ready() {
      bootAt ??= now();
      if (!cfg.enabled && active) {
        active = false;
        deps.goTo(target(), { instant: true });
      }
    },
    skip(kind = 'default') {
      rig.cancelHero();
      if (!active) return false;
      skipped = true;
      const to = Math.min(deps.lastSpread, kind === 'contents' ? deps.contentsSpread ?? 1 : target());
      auto = to === target();
      if (deps.turning()) deps.queue?.(to);
      else deps.goTo(to, { instant: true, landing: auto });
      return true;
    },
    deepLink(spread) {
      skipped = true;
      started = true;
      deps.goTo(Math.min(deps.lastSpread, Math.max(1, spread)), { instant: true });
    },
    update,
    dispose() {
      for (const u of unsubs) u();
    },
  };
}
