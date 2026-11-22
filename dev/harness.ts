/**
 * A minimal EngineContext for package dev pages while the real app (src/engine/core/app.ts) is being built:
 * renderer, scene, camera with orbit controls, a plain light rig, a registry and the phased frame loop.
 * Dev pages only; never imported by the product.
 */
import {
  ACESFilmicToneMapping, AmbientLight, Color, DirectionalLight, PCFShadowMap, PerspectiveCamera, Scene, SRGBColorSpace,
  Vector2, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Registry } from '../src/engine/core/registry';
import { mountInspector } from '../src/engine/core/inspector';
import { FRAME_PHASES, type EngineContext, type EngineEvents, type FrameInfo, type FramePhase, type QualityTier } from '../src/engine/contracts';

export function makeHarness(opts: { canvas?: HTMLCanvasElement; lights?: boolean; background?: string; camera?: { pos: [number, number, number]; look: [number, number, number]; fov?: number } } = {}) {
  const canvas = opts.canvas ?? (document.querySelector('canvas') as HTMLCanvasElement) ?? document.body.appendChild(document.createElement('canvas'));
  canvas.style.cssText = 'display:block;width:100vw;height:100vh';
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const scene = new Scene();
  scene.background = new Color(opts.background ?? '#b9b0a2');
  const cam = opts.camera ?? { pos: [16, 430, 400] as [number, number, number], look: [12, 24, 4] as [number, number, number], fov: 30 };
  const camera = new PerspectiveCamera(cam.fov ?? 30, innerWidth / innerHeight, 1, 9000);
  camera.position.set(...cam.pos);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(...cam.look);
  controls.update();
  if (opts.lights !== false) {
    scene.add(new AmbientLight('#ffffff', 0.6));
    const d = new DirectionalLight('#ffffff', 2.2);
    d.position.set(-300, 500, 200);
    d.castShadow = true;
    d.shadow.mapSize.set(2048, 2048);
    Object.assign(d.shadow.camera, { left: -300, right: 300, top: 300, bottom: -300, near: 1, far: 2000 });
    scene.add(d);
  }
  const registry = new Registry();
  const hooks = new Map<FramePhase, Set<(f: FrameInfo) => void>>(FRAME_PHASES.map((p) => [p, new Set()]));
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  let still = false;
  let tier: QualityTier = 'high';
  const resolution = new Vector2();
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.getDrawingBufferSize(resolution);
  };
  addEventListener('resize', resize);
  resize();
  const ctx: EngineContext = {
    registry, canvas, renderer, scene, camera,
    quality: { get tier() { return tier; }, set: (t) => void (tier = t), sample: () => {} },
    events: {
      on: (type, fn) => {
        const s = listeners.get(type as string) ?? new Set();
        listeners.set(type as string, s);
        s.add(fn as (p: unknown) => void);
        return () => s.delete(fn as (p: unknown) => void);
      },
      emit: (type, payload) => listeners.get(type as string)?.forEach((fn) => fn(payload)),
    } as EngineContext['events'],
    get still() { return still; },
    setStill: (on) => { still = on; ctx.events.emit('still', { on } as EngineEvents['still']); },
    onFrame: (phase, fn) => { hooks.get(phase)!.add(fn); return () => hooks.get(phase)!.delete(fn); },
    resolution,
    sharedUniforms: {
      uKeyDir: { value: new Vector3(-0.6, 0.66, -0.48).normalize() },
      uKeyColor: { value: new Color('#f3f7ff') },
      uIllus: { value: new Vector3(-0.5, 0.78, 0.36).normalize() },
      uHatchQ: { value: 1 },
    },
    start: () => {
      let last = performance.now(), time = 0, frame = 0;
      const loop = (ts: number) => {
        requestAnimationFrame(loop);
        const dt = Math.min(0.05, Math.max(0, (ts - last) / 1000));
        last = ts;
        time += dt;
        const f: FrameInfo = { dt, time, frame: frame++, still };
        controls.update();
        for (const p of FRAME_PHASES) {
          if (p === 'render') { renderer.render(scene, camera); continue; }
          hooks.get(p)!.forEach((fn) => fn(f));
        }
        (window as unknown as { __frame: number }).__frame = frame;
      };
      requestAnimationFrame(loop);
    },
    dispose: () => renderer.dispose(),
  };
  if (new URLSearchParams(location.search).has('inspect')) mountInspector(registry);
  (window as unknown as { inkleaf: unknown }).inkleaf = { ctx, registry, set: registry.set.bind(registry), describe: registry.describe.bind(registry) };
  return { ctx, controls };
}
