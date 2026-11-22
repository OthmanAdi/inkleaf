/**
 * The engine shell: WebGL2 renderer, scene, camera, the stage (desk, pad, lights), the post chain, quality tiers and
 * the phased frame loop. Packages hook into named phases that run in a fixed order every frame:
 *
 *   book -> tour -> runtime -> flaps -> shadow -> camera -> uniforms -> spill -> lens -> ui -> render -> after
 *
 * Built-in work per phase: `shadow` eases the key shadow toward 0.42 while a page turns; `uniforms` writes the
 * view-space key and illustration light directions; `spill` drives the spill lights and the glow map; `render`
 * runs the composer after the phase's hooks.
 */
import {
  Color, NoToneMapping, PCFShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer,
  type IUniform,
} from 'three';
import { FRAME_PHASES, type EngineContext, type EngineEvents, type FrameInfo, type FramePhase, type GlowSource, type QualityTier } from '../contracts';
import { createPost, type Post } from '../post/composer';
import { createStage, type Stage } from '../stage/stage';
import { FrameClock } from './clock';
import { createEmitter } from './emitter';
import { createQuality, tierFromSearch, type QualityController } from './quality';
import { Registry } from './registry';
import { tunable } from './tune';

export interface EngineOptions {
  registry?: Registry;
  /** Query string with URL switches (`?q=low`, `?noao`, `?exp=1.1`, ...). Defaults to `location.search`. */
  search?: string;
  /** Reduced motion at start. Defaults to the `prefers-reduced-motion` media query. */
  still?: boolean;
  /** Forced (and locked) quality tier. Overrides the URL. */
  tier?: QualityTier;
  /** Create the ambient-occlusion pass at all. Defaults to true unless `?noao`. */
  ao?: boolean;
  /** CSS size of the canvas. Defaults to the window size. */
  size?: () => { width: number; height: number };
  /** Listen to window resize events. Default true. */
  autoResize?: boolean;
}

/** Tells the loop whether the current figure is live and which glow sources it has. */
export interface SpillDriver {
  live(): boolean;
  sources(): readonly GlowSource[];
}

export type EngineSharedUniforms = EngineContext['sharedUniforms'] & {
  /** Thin ink lines below this base width are hidden (low tier 0.62). */
  uMinW: IUniform<number>;
  /** Stream bead count multiplier (low tier 0.5). */
  uBeadDensity: IUniform<number>;
};

export interface BenchResult { frames: number; msPerFrame: number; width: number; height: number; calls: number; triangles: number }

export interface Engine {
  ctx: EngineContext;
  stage: Stage;
  post: Post;
  quality: QualityController;
  uniforms: EngineSharedUniforms;
  /** The book drives this: while true the key shadow eases toward the turn target (0.42), then back. */
  turning: boolean;
  setSpillDriver(driver: SpillDriver | null): void;
  /** Resolves with the frame timestamp once the boot gate opens: at least bootFrames frames and bootMs after navigation (immediately in still mode or with ?shot). */
  readonly booted: Promise<number>;
  resize(): void;
  /** Renders `n` frames (runtime hooks, spill, post) at a fixed 1/60 s and reports the cost. */
  bench(n?: number): BenchResult;
  dispose(): void;
}

export class WebGL2UnavailableError extends Error {
  constructor() {
    super('inkleaf needs WebGL2');
    this.name = 'WebGL2UnavailableError';
  }
}

/** Probes WebGL2 on a throwaway canvas (probing the real canvas would lock its context attributes). */
export function supportsWebGL2(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

const NO_SOURCES: readonly GlowSource[] = [];

export function createEngine(canvas: HTMLCanvasElement, opts: EngineOptions = {}): Engine {
  if (!supportsWebGL2()) {
    document.body.classList.add('nogl');
    throw new WebGL2UnavailableError();
  }
  const search = opts.search ?? (typeof location !== 'undefined' ? location.search : '');
  const url = new URLSearchParams(search);
  const registry = opts.registry ?? new Registry();
  const events = createEmitter<EngineEvents>();
  const size = opts.size ?? (() => ({ width: innerWidth, height: innerHeight }));
  // Registry overrides queued before creation apply during registration; handlers wait until everything exists.
  let wired = false;

  // ------------------------------------------------------------------ renderer, scene, camera
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 16 / 9, 20, 9000);
  camera.name = 'render.camera';

  let pixelRatioOverride = 0;
  registry.add({
    id: 'render.renderer', label: 'Renderer', kind: 'renderer', tags: ['effect', 'data', 'quality'],
    describe: 'WebGL2 renderer: no canvas anti-aliasing (SMAA in post), sRGB output, no renderer tone mapping (the post chain tone maps), PCF shadows.',
    source: 'src/engine/core/app.ts',
    params: [
      { key: 'shadows', label: 'Shadows', type: 'boolean', help: 'Render shadow maps', get: () => renderer.shadowMap.enabled, set: (v) => { renderer.shadowMap.enabled = v as boolean; } },
      {
        key: 'pixelRatio', label: 'Pixel ratio override', type: 'number', min: 0, max: 3, step: 0.05,
        help: '0 = device ratio capped by the quality tier; otherwise this ratio',
        get: () => pixelRatioOverride, set: (v) => { pixelRatioOverride = v as number; if (wired) resize(); },
      },
    ],
  });
  const camCfg = tunable(registry, {
    id: 'render.camera', label: 'Main camera (lens)', kind: 'camera', tags: ['camera'],
    describe: 'Lens of the main perspective camera; poses and motion belong to the camera rig.',
    object: camera, source: 'src/engine/core/app.ts',
    params: {
      fov: { value: 30, min: 5, max: 90, step: 0.5, unit: 'deg', help: 'Vertical field of view' },
      near: { value: 20, min: 0.1, max: 500, step: 0.1, unit: 'mm', help: 'Near clip plane' },
      far: { value: 9000, min: 100, max: 50000, step: 10, unit: 'mm', help: 'Far clip plane' },
    },
    onChange: () => wired && applyCamera(),
  });
  const applyCamera = () => {
    camera.fov = camCfg.fov;
    camera.near = camCfg.near;
    camera.far = camCfg.far;
    camera.updateProjectionMatrix();
  };

  // ------------------------------------------------------------------ shared uniforms
  const uniforms: EngineSharedUniforms = {
    uKeyDir: { value: new Vector3(-0.6, 0.66, -0.48).normalize() },
    uKeyColor: { value: new Color() },
    uIllus: { value: new Vector3(-0.5, 0.78, 0.36).normalize() },
    uHatchQ: { value: 1 },
    uMinW: { value: 0 },
    uBeadDensity: { value: 1 },
  };
  const illus = tunable(registry, {
    id: 'light.illus', label: 'Ink illustration light direction', kind: 'light-uniform', tags: ['light', 'ink'],
    describe: 'World direction of the light that shades and hatches inked paper models; sent to shaders in view space as uIllus.',
    source: 'src/engine/core/app.ts',
    params: { direction: { value: [-0.5, 0.78, 0.36], help: 'World direction toward the illustration light (normalised)' } },
  });

  // ------------------------------------------------------------------ quality, stage, post
  const forced = opts.tier ?? tierFromSearch(search);
  const quality = createQuality(registry, { tier: forced ?? 'high', locked: forced !== null });
  const stage = createStage({ registry, renderer, scene, uniforms });
  const post = createPost({ registry, renderer, scene, camera, ao: opts.ao ?? !url.has('noao') });

  const turn = tunable(registry, {
    id: 'light.key.shadow-turn', label: 'Shadow fade during page turns', kind: 'animation', tags: ['shadow', 'animation', 'book'], parent: 'light.key',
    describe: 'While a page turns the key shadow eases to the target strength, then back to its resting strength, with time constant tau. Off in still mode.',
    source: 'src/engine/core/app.ts',
    params: {
      enabled: { value: true, help: 'Fade shadows during page turns' },
      target: { value: 0.42, min: 0, max: 1, step: 0.01, help: 'Shadow strength while a page turns' },
      tau: { value: 0.12, min: 0.005, max: 2, step: 0.005, unit: 's', help: 'Time constant of the exponential ease' },
    },
  });
  const loopCfg = tunable(registry, {
    id: 'render.loop', label: 'Frame loop', kind: 'frame-loop', tags: ['data', 'animation'],
    describe: 'requestAnimationFrame loop in fixed phases. Frame steps are clamped so a long frame advances motion by at most maxDt; a hidden tab pauses everything.',
    source: 'src/engine/core/app.ts',
    params: {
      maxDt: { value: 0.05, min: 0.005, max: 0.5, step: 0.005, unit: 's', help: 'Largest frame step any animation sees' },
      paused: { value: false, help: 'Freeze updates and rendering' },
      bootFrames: { value: 4, min: 0, max: 120, step: 1, unit: 'frames', help: 'Frames rendered before the boot gate opens' },
      bootMs: { value: 1600, min: 0, max: 10000, step: 50, unit: 'ms', help: 'Earliest time after navigation the boot gate opens (0 in still mode or with ?shot)' },
    },
    onChange: () => wired && (clock.maxDt = loopCfg.maxDt),
  });

  const resolution = new Vector2();
  let still = opts.still ?? (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const resize = () => {
    const { width, height } = size();
    const w = Math.max(1, Math.floor(width)), h = Math.max(1, Math.floor(height));
    const cap = pixelRatioOverride > 0 ? pixelRatioOverride : quality.settings.pixelRatioCap;
    const pr = pixelRatioOverride > 0 ? pixelRatioOverride : Math.min(devicePixelRatio || 1, cap);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    post.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.getDrawingBufferSize(resolution);
    events.emit('resize', { width: resolution.x, height: resolution.y, pixelRatio: pr });
  };
  quality.onApply((tier, s) => {
    post.setAOAllowed(s.ao);
    post.setBloomResolutionScale(s.bloomScale);
    registry.set('light.key.shadow', 'mapSize', s.shadowMapSize);
    uniforms.uHatchQ.value = s.hatchQ;
    uniforms.uMinW.value = s.minWidth;
    uniforms.uBeadDensity.value = s.beadDensity;
    events.emit('quality', { tier });
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 0);
  });

  // URL switches for look tuning.
  const num = (k: string) => {
    const v = url.get(k);
    return v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
  };
  const urlSet: [string, string, string][] = [
    ['exp', 'post.tone', 'exposure'], ['bloom', 'post.bloom', 'intensity'], ['vig', 'post.vignette', 'darkness'],
    ['lg', 'light.spill', 'gain'], ['spill', 'post.spill-map', 'gain'],
  ];
  for (const [k, id, key] of urlSet) {
    const v = num(k);
    if (v !== null) registry.set(id, key, v);
  }

  // ------------------------------------------------------------------ frame loop
  type Hook = (f: FrameInfo) => void;
  const hooks = Object.fromEntries(FRAME_PHASES.map((p) => [p, [] as Hook[]])) as Record<FramePhase, Hook[]>;
  const run = (phase: FramePhase, f: FrameInfo) => {
    const list = hooks[phase];
    for (let i = 0; i < list.length; i++) list[i]!(f);
  };
  const clock = new FrameClock(typeof performance !== 'undefined' ? performance.now() : 0);
  let turning = false;
  let driver: SpillDriver | null = null;
  const illusWorld = new Vector3();

  const step = (f: FrameInfo) => {
    run('book', f);
    run('tour', f);
    run('runtime', f);
    run('flaps', f);
    const base = stage.keyShadowBase;
    const target = turn.enabled && turning && !still ? turn.target : base;
    const sh = stage.key.shadow;
    sh.intensity += (target - sh.intensity) * (1 - Math.exp(-f.dt / turn.tau));
    run('shadow', f);
    run('camera', f);
    camera.updateMatrixWorld();
    const d = illus.direction;
    uniforms.uIllus.value.copy(illusWorld.set(d[0]!, d[1]!, d[2]!).normalize()).transformDirection(camera.matrixWorldInverse);
    stage.update(camera);
    run('uniforms', f);
    const live = driver?.live() ?? false;
    stage.updateSpill(live && driver ? driver.sources() : NO_SOURCES, f.dt);
    post.spillMap.update(live);
    run('spill', f);
    run('lens', f);
    run('ui', f);
    run('render', f);
  };

  let raf = 0;
  let started = false;
  const shot = url.has('shot');
  let bootAt = -1;
  let resolveBoot: (ts: number) => void = () => {};
  const booted = new Promise<number>((r) => (resolveBoot = r));
  const loop = (ts: number) => {
    raf = requestAnimationFrame(loop);
    const f = clock.tick(ts, typeof document !== 'undefined' && document.hidden, still);
    if (!f || loopCfg.paused) return;
    step(f);
    post.render(f.dt);
    run('after', f);
    clock.advance();
    if (bootAt < 0 && clock.info.frame >= loopCfg.bootFrames && (still || shot || performance.now() >= loopCfg.bootMs)) {
      bootAt = ts;
      resolveBoot(ts);
    }
  };

  const ctx: EngineContext = {
    registry, canvas, renderer, scene, camera, quality, events, resolution,
    sharedUniforms: uniforms,
    get still() {
      return still;
    },
    setStill(on: boolean) {
      if (on === still) return;
      still = on;
      events.emit('still', { on });
    },
    onFrame(phase, fn) {
      hooks[phase] = [...hooks[phase], fn];
      return () => {
        hooks[phase] = hooks[phase].filter((h) => h !== fn);
      };
    },
    start() {
      if (started) return;
      started = true;
      raf = requestAnimationFrame((ts) => {
        clock.tick(ts, false, still);
        loop(ts);
      });
    },
    dispose() {
      engine.dispose();
    },
  };

  wired = true;
  applyCamera();
  clock.maxDt = loopCfg.maxDt;
  const onResize = () => resize();
  if (opts.autoResize !== false && typeof addEventListener !== 'undefined') addEventListener('resize', onResize);
  resize();

  const engine: Engine = {
    ctx, stage, post, quality, uniforms, booted,
    get turning() {
      return turning;
    },
    set turning(v: boolean) {
      turning = v;
    },
    setSpillDriver(d) {
      driver = d;
    },
    resize,
    bench(n = 60) {
      const info = renderer.info;
      const f: FrameInfo = { dt: 1 / 60, time: clock.info.time, frame: clock.info.frame, still };
      const gl = renderer.getContext();
      const px = new Uint8Array(4);
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        if (i === n - 1) {
          info.autoReset = false;
          info.reset();
        }
        run('runtime', f);
        const live = driver?.live() ?? false;
        stage.updateSpill(live && driver ? driver.sources() : NO_SOURCES, f.dt);
        post.spillMap.update(live);
        post.render(f.dt);
      }
      renderer.setRenderTarget(null);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const ms = (performance.now() - t0) / n;
      const out: BenchResult = { frames: n, msPerFrame: ms, width: resolution.x, height: resolution.y, calls: info.render.calls, triangles: info.render.triangles };
      info.autoReset = true;
      return out;
    },
    dispose() {
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      if (typeof removeEventListener !== 'undefined') removeEventListener('resize', onResize);
      post.dispose();
      stage.dispose();
      renderer.dispose();
      events.clear();
      for (const p of ['stage', 'light', 'post', 'quality', 'render']) registry.removeTree(p);
    },
  };
  return engine;
}
