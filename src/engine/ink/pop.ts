/**
 * The pop-up model of one lesson spread: shared uniforms, line sets, paper surfaces and the state machine
 * print -> peel -> shade -> live -> undraw.
 *
 *   print   the figure is a printed ink drawing on the page (the group is hidden; the page shows the print).
 *   peel    an invisible pen redraws every stroke standing up in 3D while the matching part of a flat copy on the
 *           page vanishes; the print cross-fades into that flat copy in the first 0.28 s.
 *   shade   after the last stroke the paper surfaces fade in over 0.45 s (hatching, shadows, glow spill).
 *   live    interactive; outlines of round things follow the camera.
 *   undraw  leaving: surfaces fade (0.15 s), the model folds back into the page (0.35 s), the print returns.
 */
import {
  Group, Matrix4, Vector2, Vector4, type IUniform, type Mesh, type Object3D, type PerspectiveCamera, type ShaderMaterial, type Texture,
} from 'three';
import type { EngineContext, LineSet, PageSlot, Pop, PopState } from '../contracts';
import { LAYERS } from '../contracts';
import type { Registry } from '../core/registry';
import { peelAt, shadeAt, undrawAt } from './lifecycle';
import { createInkMaterial, type InkMaterial, type InkMaterialOptions } from './line-material';
import { InkLineSet } from './line-set';
import { bindInk, type InkEnv } from './params';
import { createFadingShadowMaterial, createPaperMaterial, type PaperMaterial, type PaperOptions } from './paper-material';
import { createPen, type Pen, type PenOptions } from './pen';
import { PrintRenderer, printPageRect, type PrintRect } from './print';
import { createPopUniforms, type PopUniforms } from './uniforms';

/** What per-frame updaters (live outlines, wheels, steam, rings) receive. */
export interface PopFrame {
  dt: number;
  camera: PerspectiveCamera;
  /** Current line lift (1 standing, 0 lying on the page). */
  lift: number;
  state: PopState;
  live: boolean;
  /** Reduced motion or paused: idle motion should freeze. */
  frozen: boolean;
  /** True during the zero-dt update that runs before a print. */
  printing: boolean;
}

export type PopUpdater = (f: PopFrame) => void;

export interface PopCreateOptions {
  /** Model frame (model -> world): X along the page, Y out of the page, Z toward the reader. Default identity. */
  frame?: Matrix4;
  /** Print rect in the model frame (default x -10..170, y -4..196). */
  printRect?: PrintRect;
  /** Print resolution (default `ink.print.pxPerMm` = 6). */
  pxPerMm?: number;
  /** Cabinet shear (default 0.12, 0.32). */
  cab?: Vector2 | readonly [number, number];
  /** Registry id of this pop (default `ink.pop-<n>`). */
  id?: string;
  label?: string;
  /** Spread number used in `pop-state` events. */
  spread?: number;
  /** Parent of the pop group (default the scene; must not be transformed). */
  parent?: Object3D;
  /** Page point of the model frame origin, for the page print rect (default u 20, v 212). */
  originU?: number;
  hingeV?: number;
  /** A page slot to drive: print texture, rect and alpha are written automatically. */
  slot?: PageSlot;
}

let popCount = 0;

export class PopModel implements Pop {
  readonly id: string;
  readonly ctx: EngineContext;
  readonly env: InkEnv;
  readonly u: PopUniforms;
  readonly group = new Group();
  readonly inkMats: InkMaterial[] = [];
  readonly paperMats: PaperMaterial[] = [];
  readonly sets: InkLineSet[] = [];
  readonly surfaces: Mesh[] = [];
  readonly clocks: IUniform<number>[] = [];
  readonly updaters: PopUpdater[] = [];
  readonly print: PrintRenderer;
  readonly shadowDepth = createFadingShadowMaterial();
  readonly pageRect = new Vector4();
  /** Hooks run once before the first draw or print (the kit builds its sets here). */
  readonly beforeUse: (() => void)[] = [];
  frame: Matrix4;
  spread: number;
  originU: number;
  hingeV: number;
  slot: PageSlot | null;
  /** Called with every new state (lessons chain it to hide or restore extras). */
  onState: ((state: PopState) => void) | null = null;

  private _state: PopState = 'print';
  private _t = 0;
  private _printAlpha = 1;
  private undrawResolve: (() => void) | null = null;
  private undrawPromise: Promise<void> | null = null;
  private undrawPrinted = false;
  private disposed = false;
  private printed = false;
  private readonly lastRect = new Vector4(NaN, NaN, NaN, NaN);
  private readonly parent: Object3D;

  constructor(ctx: EngineContext, opts: PopCreateOptions = {}) {
    this.ctx = ctx;
    this.env = bindInk(ctx);
    const env = this.env;
    this.id = opts.id ?? `ink.pop-${++popCount}`;
    this.spread = opts.spread ?? -1;
    this.frame = (opts.frame ?? new Matrix4()).clone();
    const cab = opts.cab ? (Array.isArray(opts.cab) ? new Vector2(opts.cab[0], opts.cab[1]) : (opts.cab as Vector2).clone()) : new Vector2(env.print.cabX, env.print.cabY);
    const pxPerMm = opts.pxPerMm ?? env.print.pxPerMm;
    this.u = createPopUniforms(this.frame, pxPerMm, cab);
    this.originU = opts.originU ?? 20;
    this.hingeV = opts.hingeV ?? 212;
    this.slot = opts.slot ?? null;
    const p = env.print;
    this.print = new PrintRenderer({
      rect: opts.printRect ?? { x0: p.x0, x1: p.x1, y0: p.y0, y1: p.y1 },
      pxPerMm,
      samples: p.samples,
      cab,
      cameraZ: p.cameraZ,
      near: p.near,
      far: p.far,
      visScale: p.visScale,
      visBias: p.visBias,
    });
    this.print.setFrame(this.frame);
    this.group.name = this.id;
    this.group.matrixAutoUpdate = false;
    this.group.matrix.copy(this.frame);
    this.group.userData.popout = true;
    this.group.visible = false;
    this.parent = opts.parent ?? ctx.scene;
    this.parent.add(this.group);
    this.updatePageRect();
    this.register(opts.label);
  }

  get state(): PopState {
    return this._state;
  }
  get t(): number {
    return this._t;
  }
  get printAlpha(): number {
    return this._printAlpha;
  }
  /** Latest stroke end over all sets (the peel lasts this long). */
  get drawEnd(): number {
    let e = 0;
    for (const s of this.sets) e = Math.max(e, s.end);
    return e;
  }

  /** A pen line material sharing this pop's uniforms. `widthPx` is multiplied by the line scale 1.32. */
  ink(opts: InkMaterialOptions = {}): InkMaterial {
    const m = createInkMaterial(this.env, this.u, opts);
    if (opts.clock && !this.clocks.includes(opts.clock)) this.clocks.push(opts.clock);
    this.inkMats.push(m);
    return m;
  }

  /** A paper material sharing this pop's uniforms (transparent; writes depth even while invisible). */
  paper(opts: PaperOptions = {}): PaperMaterial {
    const m = createPaperMaterial(this.env, this.u, opts);
    m.colorWrite = this.u.uSurfAlpha.value > this.env.timing.colorEps;
    this.paperMats.push(m);
    return m;
  }

  /** A new line set; `capacity > 0` makes it dynamic (rewritten every frame). Add it with `addLines`. */
  lines(material: InkMaterial | ShaderMaterial, opts: { capacity?: number } = {}): InkLineSet {
    const env = this.env;
    return new InkLineSet(material, {
      capacity: opts.capacity,
      stroke: () => env.strokeParams(),
      defaultDur: env.stroke.defaultDur,
      renderOrder: env.order.lines,
      flatRenderOrder: env.order.flat,
    });
  }

  /** Adds a set to the model (and to the print layer). Works for static and dynamic sets. */
  addLines(set: InkLineSet | LineSet, parent: Object3D = this.group): void {
    const s = set as InkLineSet;
    s.mesh.layers.enable(LAYERS.pop);
    parent.add(s.mesh);
    if (!this.sets.includes(s)) this.sets.push(s);
    s.flat.visible = this._state === 'peel';
  }

  /** Adds a paper surface: print layer, receives shadows, casts only once shaded, depth-only while invisible. */
  addSurface(mesh: Mesh, parent: Object3D = this.group): void {
    mesh.layers.enable(LAYERS.pop);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = this.env.order.surfaces;
    mesh.customDepthMaterial = this.shadowDepth;
    parent.add(mesh);
    if (!this.surfaces.includes(mesh)) this.surfaces.push(mesh);
    this.applyCastShadow(mesh, this.u.uSurfAlpha.value);
  }

  /** A pen with the world's `ink.pen` defaults; options or a preset name override them. */
  pen(opts: PenOptions & { preset?: string } = {}): Pen {
    const d = this.env.pen;
    const preset = opts.preset ? this.env.presets[opts.preset] : undefined;
    const base = preset ? { speed: preset.speed, gap: preset.gap, min: preset.min, max: preset.max } : { speed: d.speed, gap: d.gap, min: d.min, max: d.max };
    return createPen({ ...base, ...defined(opts) });
  }

  /** Jumps to `print` (figure printed on the page) or `live` (fully drawn and shaded). */
  set(state: 'print' | 'live'): void {
    const k = this.env.timing;
    if (state === 'print') {
      this.u.uClock.value = 0;
      for (const c of this.clocks) c.value = 0;
      this.u.uLiftAll.value = 1;
      this.surfacesAlpha(0);
      this.showFlat(false);
      this._printAlpha = 1;
      this.group.visible = false;
    } else {
      this.runBeforeUse();
      this.u.uClock.value = k.liveClock;
      for (const c of this.clocks) c.value = k.liveClock;
      this.u.uLiftAll.value = 1;
      this.u.uLiftSurf.value = 1;
      this.surfacesAlpha(1);
      this.showFlat(false);
      this._printAlpha = 0;
      this.group.visible = true;
    }
    this.enter(state);
    this.resolveUndraw();
  }

  /** From print: starts the peel (pen redraws the figure standing up). Ignored in other states. */
  draw(): void {
    if (this._state !== 'print') return;
    this.runBeforeUse();
    this.group.visible = true;
    this.u.uClock.value = 0;
    for (const c of this.clocks) c.value = 0;
    this.u.uLiftAll.value = 1;
    this.u.uLiftSurf.value = 1;
    this.surfacesAlpha(0);
    this.showFlat(true);
    this.enter('peel');
    this.u.uCopyAlpha.value = 0;
  }

  /** Folds the model back into the page; resolves when the print is back (0.5 s), at once from print. */
  undraw(): Promise<void> {
    if (this._state === 'print') return Promise.resolve();
    if (this._state === 'undraw' && this.undrawPromise) return this.undrawPromise;
    this.showFlat(false);
    this.undrawPrinted = false;
    this.undrawPromise = new Promise<void>((res) => (this.undrawResolve = res));
    this.enter('undraw');
    return this.undrawPromise;
  }

  /** Advances the state machine and the per-frame updaters. Call once per frame with the clamped dt. */
  update(dt: number): void {
    if (this.disposed) return;
    this.syncFrame();
    const res = this.ctx.resolution;
    if (res.x > 0 && res.y > 0) this.u.uRes.value.copy(res);
    const k = this.env.timing;
    this._t += dt;
    const t = this._t;
    switch (this._state) {
      case 'peel': {
        if (this.ctx.still) {
          this.set('live');
          break;
        }
        this.u.uClock.value = t;
        for (const c of this.clocks) c.value = t;
        const s = peelAt(t, k);
        this._printAlpha = s.printAlpha;
        this.u.uCopyAlpha.value = s.copyAlpha;
        if (t >= this.drawEnd) {
          this.showFlat(false);
          this.enter('shade');
        }
        break;
      }
      case 'shade': {
        if (this.ctx.still) {
          this.set('live');
          break;
        }
        const s = shadeAt(t, k);
        this.surfacesAlpha(s.surfaces);
        if (s.done) this.enter('live');
        break;
      }
      case 'undraw': {
        if (!this.undrawPrinted) {
          this.undrawPrinted = true;
          this.renderPrint();
        }
        const s = undrawAt(t, k);
        this.surfacesAlpha(s.surfaces);
        this.u.uLiftAll.value = s.lift;
        this.u.uLiftSurf.value = s.lift;
        this._printAlpha = s.printAlpha;
        if (s.done) {
          this.u.uLiftSurf.value = 1;
          this.set('print');
        } else {
          this.u.uStandAlpha.value = s.standAlpha;
        }
        break;
      }
      default:
        break;
    }
    if (this.group.visible) this.runUpdaters(dt, false);
    this.updatePageRect();
    if (this.slot) {
      if (!this.lastRect.equals(this.pageRect) && this.printed) {
        this.slot.setPrint(this.print.texture, this.pageRect, this._printAlpha);
        this.lastRect.copy(this.pageRect);
      } else {
        this.slot.setPrintAlpha(this._printAlpha);
      }
    }
  }

  /**
   * Renders the print from the model as it is now (lines and surfaces on layer 1, oblique camera) and the
   * hidden-line visibility of every static line. Returns the texture for the page slot.
   */
  renderPrint(): Texture {
    this.runBeforeUse();
    this.syncFrame();
    const { renderer, scene } = this.ctx;
    const u = this.u;
    const k = this.env.timing;
    const saved = {
      print: u.uPrint.value, px: u.uPxPerMm.value, lift: u.uLiftAll.value, clock: u.uClock.value, liftSurf: u.uLiftSurf.value,
      surf: u.uSurfAlpha.value, res: u.uRes.value.clone(), visible: this.group.visible,
      clocks: this.clocks.map((c) => c.value), colorWrite: this.paperMats.map((m) => m.colorWrite),
    };
    const hidden: Object3D[] = [];
    for (const c of scene.children) if (c !== this.group && c.visible && c.userData.popout) (hidden.push(c), (c.visible = false));
    this.group.visible = true;
    this.group.updateMatrixWorld(true);
    this.runUpdaters(0, true);
    const restores = this.sets.map((s) => s.usePrintGeometry());
    u.uPrint.value = 1;
    u.uRes.value.set(this.print.width, this.print.height);
    u.uPxPerMm.value = this.print.pxPerMm;
    u.uLiftAll.value = 1;
    u.uClock.value = k.printClock;
    for (const c of this.clocks) c.value = k.printClock;
    u.uLiftSurf.value = 1;
    u.uSurfAlpha.value = 1;
    for (const m of this.paperMats) m.colorWrite = true;
    const tex = this.print.render(renderer, scene);
    this.print.visibility(renderer, scene, this.sets.filter((s) => !s.dynamic && s.isBuilt && s.mesh.visible));
    restores.forEach((r) => r());
    u.uPrint.value = saved.print;
    u.uRes.value.copy(saved.res);
    u.uPxPerMm.value = saved.px;
    u.uLiftAll.value = saved.lift;
    u.uClock.value = saved.clock;
    this.clocks.forEach((c, i) => (c.value = saved.clocks[i] ?? c.value));
    u.uLiftSurf.value = saved.liftSurf;
    u.uSurfAlpha.value = saved.surf;
    this.paperMats.forEach((m, i) => (m.colorWrite = saved.colorWrite[i] ?? m.colorWrite));
    this.group.visible = saved.visible;
    for (const c of hidden) c.visible = true;
    this.printed = true;
    if (this.slot) {
      this.updatePageRect();
      this.slot.setPrint(tex, this.pageRect, this._printAlpha);
      this.lastRect.copy(this.pageRect);
    }
    return tex;
  }

  /** Drawing-buffer size for the line shaders (also read from the engine every update). */
  setResolution(width: number, height: number): void {
    this.u.uRes.value.set(width, height);
  }

  /** Connects a page slot; the print and its alpha are written to it from now on. */
  attachSlot(slot: PageSlot | null): void {
    this.slot = slot;
    this.lastRect.set(NaN, NaN, NaN, NaN);
    if (slot && this.printed) slot.setPrint(this.print.texture, this.pageRect, this._printAlpha);
  }

  /** Registers a per-frame updater (live outlines, spinning parts); returns a remover. */
  addUpdater(fn: PopUpdater): () => void {
    this.updaters.push(fn);
    return () => {
      const i = this.updaters.indexOf(fn);
      if (i >= 0) this.updaters.splice(i, 1);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resolveUndraw();
    this.group.removeFromParent();
    for (const s of this.sets) s.dispose();
    for (const m of this.inkMats) m.dispose();
    for (const m of this.paperMats) {
      m.map?.dispose();
      m.dispose();
    }
    for (const m of this.surfaces) m.geometry.dispose();
    this.shadowDepth.dispose();
    this.print.dispose();
    this.ctx.registry.removeTree(this.id);
  }

  // ------------------------------------------------------------------ internals

  private enter(state: PopState): void {
    this._state = state;
    this._t = 0;
    this.u.uStandAlpha.value = 1;
    this.u.uCopyAlpha.value = 1;
    this.onState?.(state);
    this.ctx.events.emit('pop-state', { spread: this.spread, state });
  }

  private resolveUndraw(): void {
    const r = this.undrawResolve;
    this.undrawResolve = null;
    this.undrawPromise = null;
    r?.();
  }

  private runBeforeUse(): void {
    while (this.beforeUse.length) this.beforeUse.shift()!();
  }

  private runUpdaters(dt: number, printing: boolean): void {
    if (!this.updaters.length) return;
    this.group.updateMatrixWorld(true);
    const f: PopFrame = {
      dt, camera: this.ctx.camera, lift: this.u.uLiftAll.value, state: this._state, live: this._state === 'live',
      frozen: this.ctx.still, printing,
    };
    for (const fn of this.updaters) fn(f);
  }

  private surfacesAlpha(a: number): void {
    const k = this.env.timing;
    this.u.uSurfAlpha.value = a;
    const cw = a > k.colorEps;
    for (const m of this.paperMats) {
      m.colorWrite = cw;
      m.depthWrite = true;
    }
    this.shadowDepth.opacity = a;
    for (const s of this.surfaces) this.applyCastShadow(s, a);
  }

  private applyCastShadow(mesh: Mesh, a: number): void {
    mesh.castShadow = a > this.env.timing.shadowEps && mesh.userData.castShadow !== false;
  }

  private showFlat(on: boolean): void {
    for (const s of this.sets) s.flat.visible = on;
  }

  private syncFrame(): void {
    if (this.u.uScene.value.equals(this.frame)) return;
    this.u.uScene.value.copy(this.frame);
    this.u.uSceneInv.value.copy(this.frame).invert();
    this.group.matrix.copy(this.frame);
    this.group.matrixWorldNeedsUpdate = true;
    this.print.setFrame(this.frame);
  }

  private updatePageRect(): void {
    printPageRect(this.print.rect, this.originU, this.hingeV, this.env.print.printOffsetU, this.pageRect);
  }

  private register(label?: string): void {
    const registry: Registry = this.ctx.registry;
    const STATES = ['print', 'peel', 'shade', 'live', 'undraw'] as const;
    registry.add({
      id: this.id,
      label: label ?? 'Pop-up model',
      tags: ['object', 'ink', 'animation', 'figure'],
      kind: 'pop-model',
      object: this.group,
      source: 'src/engine/ink/pop.ts',
      describe: 'A lesson figure that is printed on the page, peels up as a hand-inked 3D model, fades in its paper and folds back down when leaving. Set `state` to replay it.',
      params: [
        {
          key: 'state', label: 'State', type: 'enum', options: STATES, help: 'print, peel (draw from print), live, undraw',
          get: () => this._state,
          set: (v) => {
            if (v === 'print' || v === 'live') this.set(v);
            else if (v === 'peel') {
              this.set('print');
              this.draw();
            } else if (v === 'undraw') void this.undraw();
          },
        },
        { key: 'printAlpha', label: 'Print alpha', type: 'number', min: 0, max: 1, help: 'How strongly the page shows the print now (read only).', get: () => this._printAlpha, set: () => {} },
        { key: 'drawEnd', label: 'Peel length', type: 'number', unit: 's', help: 'Latest stroke end (read only).', get: () => this.drawEnd, set: () => {} },
        {
          key: 'cab', label: 'Cabinet shear', type: 'vector2', help: 'Receding direction of the oblique drawing (x, y per mm of depth).',
          get: () => [this.u.uCab.value.x, this.u.uCab.value.y],
          set: (v) => {
            const a = v as readonly number[];
            this.u.uCab.value.set(a[0] ?? 0.12, a[1] ?? 0.32);
            this.print.setCab(this.u.uCab.value.x, this.u.uCab.value.y);
          },
        },
        {
          key: 'originU', label: 'Frame origin u', type: 'number', unit: 'mm', min: 0, max: 190, help: 'Page u of the model frame origin (for the print rect).',
          get: () => this.originU, set: (v) => void (this.originU = v as number),
        },
        {
          key: 'hingeV', label: 'Hinge v', type: 'number', unit: 'mm', min: 0, max: 250, help: 'Page v of the hinge line (for the print rect).',
          get: () => this.hingeV, set: (v) => void (this.hingeV = v as number),
        },
      ],
    });
  }
}

function defined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && k !== 'preset') (out as Record<string, unknown>)[k] = v;
  return out;
}

/** Creates the pop-up model of a lesson spread. See `PopModel`. */
export function createPop(ctx: EngineContext, opts: PopCreateOptions = {}): PopModel {
  return new PopModel(ctx, opts);
}
