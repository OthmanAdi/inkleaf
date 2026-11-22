/**
 * One state machine for canvas pointers: a press first tries the figure's drag targets, then clickable page hits
 * (open flaps, then page regions), then becomes an orbit drag; a second finger freezes the orbit; a still finger on
 * readable text shows the magnifier after a long press; a quick horizontal flick turns the page; a press that does
 * not move past the click slop is a click. Hover (mouse and pen) drives the cursor, figure highlights and the
 * magnifier. The wheel turns one page per gesture; arrow and page keys turn pages; Space and Escape control tours.
 */
import { Matrix4, Plane, Raycaster, Vector2, Vector3, type Object3D } from 'three';
import type { BookApi, EngineContext, FigureBehaviour, PageHit, PageRegion, PointerInfo, PopState, Side } from '../contracts';
import type { CameraRig } from '../camera/rig';
import type { LensContent, LensTarget } from '../lens/content';
import { flickDirection, isTextEntry, registerInputConfig, slopFor, touchProbes, WheelAccumulator, type InputConfig } from './gesture';

/** The current lesson figure as the router sees it. */
export interface FigureHandle {
  behaviour: FigureBehaviour;
  state: PopState;
  /** Model frame: pointer `local` coordinates are in it. */
  frame: Matrix4;
  /** Skips the peel when a target is pressed before the model is live. */
  forceLive?(): void;
  /** Figure objects that carry magnifier terms (hover shows the lens). */
  terms?(): readonly Object3D[];
}

export interface InputDeps {
  ctx: EngineContext;
  rig: CameraRig;
  book?(): Pick<BookApi, 'hitTest' | 'openSpread' | 'turning'> | null;
  /** Hit regions of a page, from the page typography engine. */
  regions?(spread: number, side: Side): readonly PageRegion[];
  /** Clickable things checked before the page regions (open flap meshes). */
  pick?(raycaster: Raycaster): { region: PageRegion; hit: PageHit | null } | null;
  figure?(): FigureHandle | null;
  nav: { next(): void; prev(): void };
  /** Click on a region (goto:, predict:, switch:, flap...). Return true when handled. */
  action?(region: PageRegion, hit: PageHit | null): boolean;
  landing?: { readonly active: boolean; skip(kind?: 'contents' | 'default'): boolean };
  tour?: { readonly running: boolean; stop(natural?: boolean): void; cancelAuto(): void; togglePause(): void };
  lens?: { readonly visible: boolean; show(t: LensTarget, x: number, y: number): boolean; move(x: number, y: number): void; hide(): void };
  /** Card content for a lens target (decides which regions are readable). */
  lensContent?(t: LensTarget): LensContent | null;
  dialogOpen?(): boolean;
  collapseSheet?(): void;
  /** Screenshot mode: no input at all. */
  disabled?: boolean;
}

export interface InputRouter {
  readonly config: InputConfig;
  /** A pointer operation is in progress (blocks the automatic tour start). */
  readonly busy: boolean;
  readonly cursor: string;
  dispose(): void;
}

type Op =
  | { kind: 'orbit'; id: number; type: string; x: number; y: number; t: number; x0: number; y0: number; moved: boolean; pinch: boolean; lens: boolean }
  | { kind: 'pop'; id: number; fig: FigureHandle };

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'CapsLock']);

export function createInputRouter(deps: InputDeps): InputRouter {
  const { ctx, rig } = deps;
  const cfg = registerInputConfig(ctx.registry);
  const canvas = ctx.canvas;
  const ray = new Raycaster();
  ray.layers.enableAll();
  const ndc = new Vector2();
  const plane = new Plane();
  const inv = new Matrix4();
  const _n = new Vector3(), _w = new Vector3();
  const wheel = new WheelAccumulator(cfg.wheel);
  const pointers = new Set<number>();
  let op: Op | null = null;
  let pending: { region: PageRegion; hit: PageHit | null; x: number; y: number; slop: number } | null = null;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let cursor = 'default';
  let hovered: Object3D | null = null;
  let spaceUsed = false;

  const setCursor = (c: string) => {
    if (c === cursor) return;
    cursor = c;
    canvas.style.cursor = c;
  };

  function aim(x: number, y: number): Raycaster {
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, ctx.camera);
    return ray;
  }

  function info(fig: FigureHandle, world: Vector3): PointerInfo {
    inv.copy(fig.frame).invert();
    return { world: world.clone(), local: world.clone().applyMatrix4(inv), ndc: ndc.clone() };
  }

  /** The figure's drag target under the pointer (touch tries 13 probes). */
  function targetAt(x: number, y: number, touch: boolean, liveOnly: boolean): { object: Object3D; point: Vector3; fig: FigureHandle } | null {
    const fig = deps.figure?.();
    if (!fig || fig.state === 'print' || fig.state === 'undraw' || (liveOnly && fig.state !== 'live')) return null;
    const targets = fig.behaviour.targets?.() ?? [];
    if (!targets.length) return null;
    const probes = touch ? touchProbes(cfg.pointer) : [[0, 0] as [number, number]];
    for (const [ox, oy] of probes) {
      const hits = aim(x + ox, y + oy).intersectObjects(targets as Object3D[], true);
      const hit = hits[0];
      if (hit) {
        let o: Object3D | null = hit.object;
        while (o && !targets.includes(o)) o = o.parent;
        return { object: o ?? hit.object, point: hit.point.clone(), fig };
      }
    }
    return null;
  }

  interface PageFind { hit: PageHit | null; click: PageRegion | null; read: LensTarget | null }
  /** Clickable region and readable region under the pointer (only on the open spread, not while turning). */
  function pageAt(x: number, y: number, touch: boolean): PageFind {
    const out: PageFind = { hit: null, click: null, read: null };
    const book = deps.book?.();
    if (!book || book.turning || deps.landing?.active) return out;
    const r = aim(x, y);
    const picked = deps.pick?.(r);
    if (picked) out.click = picked.region;
    const hit = book.hitTest(r);
    if (!hit || hit.spread !== book.openSpread) return out;
    out.hit = hit;
    const g = touch ? cfg.pointer.touchGrow : 0;
    for (const reg of deps.regions?.(hit.spread, hit.side) ?? []) {
      if (hit.u < reg.u - g || hit.u > reg.u + reg.w + g || hit.v < reg.v - g || hit.v > reg.v + reg.h + g) continue;
      if (!out.click && reg.kind !== 'lens-term' && reg.action) out.click = reg;
      if (!out.read && hit.u >= reg.u && hit.u <= reg.u + reg.w && hit.v >= reg.v && hit.v <= reg.v + reg.h) {
        const t: LensTarget = { kind: 'region', spread: hit.spread, side: hit.side, region: reg };
        if (deps.lensContent?.(t)) out.read = t;
      }
      if (out.click && out.read) break;
    }
    return out;
  }

  /** A figure object carrying a magnifier term under the pointer. */
  function termAt(x: number, y: number): LensTarget | null {
    const fig = deps.figure?.();
    const terms = fig?.terms?.() ?? [];
    if (!fig || fig.state !== 'live' || !terms.length) return null;
    const hit = aim(x, y).intersectObjects(terms as Object3D[], true)[0];
    if (!hit) return null;
    let o: Object3D | null = hit.object;
    while (o && !terms.includes(o)) o = o.parent;
    const t: LensTarget = { kind: 'object', object: o ?? hit.object };
    return deps.lensContent?.(t) ? t : null;
  }

  function hover(e: PointerEvent): void {
    if (deps.landing?.active || deps.book?.()?.turning || deps.dialogOpen?.()) return;
    const touch = e.pointerType === 'touch';
    const tgt = targetAt(e.clientX, e.clientY, touch, true);
    const obj = tgt?.object ?? null;
    if (obj !== hovered) {
      hovered = obj;
      deps.figure?.()?.behaviour.hover?.(obj);
    }
    if (tgt) {
      setCursor(tgt.fig.behaviour.cursor?.(tgt.object) ?? 'pointer');
      if (!touch) deps.lens?.hide();
      return;
    }
    const page = pageAt(e.clientX, e.clientY, touch);
    let c = page.click ? 'pointer' : 'default';
    const read = !touch && !deps.tour?.running ? page.read ?? termAt(e.clientX, e.clientY) : null;
    if (read && deps.lens?.show(read, e.clientX, e.clientY)) {
      if (!page.click) c = 'zoom-in';
    } else if (!touch) deps.lens?.hide();
    setCursor(c);
  }

  const clearTimer = () => {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
  };

  function onDown(e: PointerEvent): void {
    if (deps.disabled) return;
    pointers.add(e.pointerId);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer may already be gone */
    }
    if (deps.landing?.skip()) {
      e.preventDefault();
      return;
    }
    if (deps.dialogOpen?.()) return;
    deps.tour?.stop();
    deps.tour?.cancelAuto();
    const touch = e.pointerType === 'touch';
    if (touch) deps.collapseSheet?.();
    else deps.lens?.hide();
    if (pointers.size > 1) {
      if (op?.kind === 'orbit') op.pinch = true;
      pending = null;
      clearTimer();
      return;
    }
    if (touch && deps.lens?.visible) deps.lens.hide();
    const tgt = targetAt(e.clientX, e.clientY, touch, false);
    if (tgt) {
      if (tgt.fig.state !== 'live') tgt.fig.forceLive?.();
      const res = tgt.fig.behaviour.press?.(tgt.object, info(tgt.fig, tgt.point));
      if (res === 'drag') {
        op = { kind: 'pop', id: e.pointerId, fig: tgt.fig };
        _n.setFromMatrixColumn(tgt.fig.frame, 2).normalize();
        plane.setFromNormalAndCoplanarPoint(_n, tgt.point);
        setCursor('grabbing');
      }
      return;
    }
    const page = pageAt(e.clientX, e.clientY, touch);
    if (page.click) pending = { region: page.click, hit: page.hit, x: e.clientX, y: e.clientY, slop: slopFor(e.pointerType, cfg.pointer) };
    const o: Op = { kind: 'orbit', id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, t: performance.now(), x0: e.clientX, y0: e.clientY, moved: false, pinch: false, lens: false };
    if (touch && page.read) {
      const read = page.read;
      pressTimer = setTimeout(() => {
        pressTimer = null;
        if (op === o && !o.moved && pointers.size === 1) {
          pending = null;
          if (deps.lens?.show(read, o.x, o.y)) o.lens = true;
        }
      }, cfg.longPress.ms);
    }
    op = o;
    rig.setHeld(true);
  }

  function dragPoint(e: PointerEvent, fig: FigureHandle): PointerInfo | null {
    const r = aim(e.clientX, e.clientY);
    if (Math.abs(r.ray.direction.dot(plane.normal)) < 1e-3) {
      _n.setFromMatrixColumn(fig.frame, 1).normalize();
      plane.setFromNormalAndCoplanarPoint(_n, plane.coplanarPoint(_w));
    }
    return r.ray.intersectPlane(plane, _w) ? info(fig, _w) : null;
  }

  function onMove(e: PointerEvent): void {
    if (deps.disabled) return;
    if (!op) {
      if (e.pointerType !== 'touch') hover(e);
      return;
    }
    if (op.kind === 'pop') {
      if (e.pointerId !== op.id) return;
      setCursor('grabbing');
      const p = dragPoint(e, op.fig);
      if (p) op.fig.behaviour.drag?.(p);
      return;
    }
    if (e.pointerId !== op.id) return;
    const slop = slopFor(op.type, cfg.pointer);
    if (!op.moved && Math.hypot(e.clientX - op.x0, e.clientY - op.y0) > slop) {
      op.moved = true;
      pending = null;
      clearTimer();
    }
    const dx = e.clientX - op.x, dy = e.clientY - op.y;
    op.x = e.clientX;
    op.y = e.clientY;
    if (op.pinch || op.lens) return;
    rig.orbitDrag(dx, dy);
  }

  function onUp(e: PointerEvent): void {
    pointers.delete(e.pointerId);
    clearTimer();
    const p = pending;
    pending = null;
    const o = op;
    if (!o) return;
    if (o.kind === 'pop') {
      if (e.pointerId !== o.id) return;
      const pi = dragPoint(e, o.fig);
      o.fig.behaviour.release?.(pi ?? info(o.fig, plane.coplanarPoint(_w)));
      op = null;
      setCursor('default');
      if (e.pointerType !== 'touch') hover(e);
      return;
    }
    rig.setHeld(false);
    op = null;
    if (e.type === 'pointerup' && p && !o.moved && !o.lens && !o.pinch && deps.action?.(p.region, p.hit)) return;
    if (o.pinch || o.lens || pointers.size > 0) return;
    const dir = flickDirection(performance.now() - o.t, e.clientX - o.x0, cfg.flick);
    if (dir) {
      rig.resetYaw();
      if (dir > 0) deps.nav.next();
      else deps.nav.prev();
    }
  }

  function onLeave(e: PointerEvent): void {
    if (e.pointerType !== 'touch') deps.lens?.hide();
  }

  function onWheel(e: WheelEvent): void {
    if (deps.disabled || !cfg.wheel.enabled || e.ctrlKey || deps.dialogOpen?.()) return;
    const t = e.target as Element | null;
    if (t?.closest?.('[data-glass], #a11y')) return;
    const now = performance.now();
    if (deps.landing?.skip()) {
      wheel.lock(now);
      return;
    }
    const dir = wheel.push(e.deltaX, e.deltaY, now);
    if (dir > 0) deps.nav.next();
    else if (dir < 0) deps.nav.prev();
  }

  function onKey(e: KeyboardEvent): void {
    if (deps.disabled || deps.dialogOpen?.()) return;
    const active = document.activeElement;
    if (deps.tour?.running) {
      if (e.key === ' ' && !isTextEntry(active)) {
        e.preventDefault();
        if (!e.repeat) deps.tour.togglePause();
        spaceUsed = true;
        return;
      }
      if (e.key === 'Escape') {
        deps.tour.stop();
        return;
      }
    }
    if (active?.closest?.('#a11y') || isTextEntry(active)) return;
    if (MODIFIERS.has(e.key)) return;
    if (deps.landing?.skip()) {
      e.preventDefault();
      return;
    }
    if (!cfg.keys.enabled) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      e.preventDefault();
      deps.nav.next();
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      deps.nav.prev();
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (spaceUsed && e.key === ' ') {
      e.preventDefault();
      spaceUsed = false;
    }
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  window.addEventListener('wheel', onWheel, { passive: true });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  const offTurn = ctx.events.on('turn-start', () => {
    setCursor('default');
    deps.lens?.hide();
    if (op?.kind === 'pop') op.fig.behaviour.release?.(info(op.fig, plane.coplanarPoint(_w)));
    op = null;
    pending = null;
    clearTimer();
  });

  return {
    config: cfg,
    get busy() {
      return op !== null;
    },
    get cursor() {
      return cursor;
    },
    dispose() {
      clearTimer();
      offTurn();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      for (const id of ['input.pointer', 'input.flick', 'input.wheel', 'input.keys', 'input.long-press']) ctx.registry.remove(id);
    },
  };
}
