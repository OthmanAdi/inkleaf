# Debugging and testing three.js scenes

The engine must be inspectable by a coding agent: every object has an id, label and tags; a debug
handle exposes the scene; tests drive time explicitly and assert on pixels and state. Verified
against three r187, Playwright 1.65 (the product's dev dependency), Vitest 5.

## 1. The debug handle

Expose it in development and behind `?debug` in production builds; never by default.

```ts
import type { Object3D, WebGLRenderer, Scene, PerspectiveCamera } from 'three';
import type { EffectComposer } from 'postprocessing';

export interface InkDebug {
  renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera; composer: EffectComposer | null;
  get(id: string): Object3D | undefined;
  list(tag?: string): { id: string; label: string; tags: string[]; type: string; visible: boolean }[];
  dump(root?: Object3D): string;
  freeze(): void;                          // stop the rAF loop
  step(dt: number, frames?: number): void; // advance simulation and render deterministically
  stats(): Record<string, number>;
  shaders(filter?: string): { name: string; cacheKey: string; vertex: string; fragment: string }[];
  state(): Record<string, unknown>;        // diagram states, page turn, lens, quality level
}

declare global { interface Window { __inkleaf?: InkDebug } }

export function exposeDebug(d: InkDebug): void {
  const wanted = import.meta.env.DEV || new URLSearchParams(location.search).has('debug');
  if (wanted) window.__inkleaf = d;
}
```

`step` must run the same update functions as the live loop with a fixed `dt`, then render once
with `composer.render(dt)` (or `renderer.render`). Tests call `freeze()` first so the real loop
cannot interleave frames.

## 2. Registry of named and tagged objects

```ts
export interface Tagged { id: string; label: string; tags: string[] }
const registry = new Map<string, Object3D>();

export function tag<T extends Object3D>(o: T, meta: Tagged): T {
  if (registry.has(meta.id)) throw new Error(`[inkleaf] duplicate id ${meta.id}`);
  o.name = meta.id;                                   // shows up in getObjectByName and devtools
  o.userData.ink = meta;
  registry.set(meta.id, o);
  return o;
}
export const byId = (id: string) => registry.get(id);
export const byTag = (t: string) => [...registry.values()].filter((o) => (o.userData.ink as Tagged).tags.includes(t));
export function untag(o: Object3D) { o.traverse((c) => { const m = c.userData.ink as Tagged | undefined; if (m) registry.delete(m.id); }); }
```

Why a registry instead of searching: `Object3D.getObjectByName` returns the first match in a full
traversal, and `getObjectsByProperty(name, value)` compares a direct property only, not nested
`userData` fields. Use ids like `page.03.diagram.heat`, `light.lamp`, `fx.bloom`, `flow.lamp-to-page`
and tags like `diagram`, `ink`, `glow`, `interactive`, `castsShadow`.

## 3. Scene graph dump

```ts
import type { Mesh, Material } from 'three';
export function dump(root: Object3D, depth = 0, out: string[] = []): string {
  const m = root as Mesh;
  const geo = m.geometry ? ` v=${m.geometry.getAttribute('position')?.count ?? 0}` : '';
  const mat = m.material ? ` mat=${(Array.isArray(m.material) ? m.material : [m.material]).map((x: Material) => x.type).join('+')}` : '';
  const p = root.position;
  out.push(`${'  '.repeat(depth)}${root.type} "${root.name}"${root.visible ? '' : ' (hidden)'}` +
    ` pos=(${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}) layers=${root.layers.mask}${geo}${mat}` +
    `${root.castShadow ? ' cast' : ''}${root.receiveShadow ? ' recv' : ''}`);
  for (const c of root.children) dump(c, depth + 1, out);
  return out.join('\n');
}
```

Ask the agent to print `__inkleaf.dump()` before guessing where something went: hidden parents,
wrong layers, zero scale and missing `castShadow` show up immediately.

## 4. Capturing shaders

Three ways, from cheapest:

1. Compile errors: three reports them by default (`renderer.debug.checkShaderErrors = true`). For a
   custom report, assign `renderer.debug.onShaderError = (gl, program, vs, fs) => { ... }`; it
   receives the GL context, the program and both `WebGLShader`s. Read `gl.getShaderInfoLog(fs)` and
   `gl.getShaderSource(fs)`, print the numbered lines around the error. Setting the callback disables
   the default report. In production builds `checkShaderErrors = false` saves a synchronous status
   query per program.
2. Final sources of compiled programs: `renderer.info.programs` holds `WebGLProgram` objects with
   `name`, `cacheKey`, `vertexShader` and `fragmentShader` (`WebGLShader` handles). The source includes
   the `#version` line, all prefixes and resolved includes:
   ```ts
   export function shaderSources(renderer: WebGLRenderer, filter = '') {
     const gl = renderer.getContext();
     return (renderer.info.programs ?? []).filter((p) => p.name.includes(filter)).map((p) => ({
       name: p.name, cacheKey: p.cacheKey,
       vertex: gl.getShaderSource(p.vertexShader) ?? '', fragment: gl.getShaderSource(p.fragmentShader) ?? '',
     }));
   }
   ```
   Give materials a `name` so `p.name` (the shader name) is searchable.
3. Everything that ever compiles, including effect passes: wrap `shaderSource` on the context right
   after creating the renderer, before anything compiles:
   ```ts
   const gl = renderer.getContext();
   const captured: string[] = [];
   const original = gl.shaderSource.bind(gl);
   gl.shaderSource = (shader: WebGLShader, source: string) => { captured.push(source); original(shader, source); };
   ```
   Dev only; it keeps every source string in memory.

For patch debugging, log inside `onBeforeCompile` which anchors matched (the `inject` helper in
`materials-and-shader-patching.md` throws on a missing anchor).

## 5. Visual debugging switches

| Question | Switch |
|---|---|
| Is the shadow camera fitted? | `scene.add(new CameraHelper(light.shadow.camera))` |
| What does the shadow map contain? | `ShadowMapViewer` from `three/addons/utils/ShadowMapViewer.js` (`new ShadowMapViewer(light)`, `size.set`, `position.set`, `render(renderer)`) |
| Is AO right? | `ao.setDisplayMode('AO')` or `'Split AO'` (N8AO) |
| What blooms? | temporarily set bloom `intensity` high and tone mapping `LINEAR`, or lower the threshold and watch which pixels light |
| Geometry density? | `renderPass.overrideMaterial = new MeshNormalMaterial({ wireframe: true })` (pmndrs `RenderPass` override) |
| Normals wrong? | override with `MeshNormalMaterial()`; flat-looking pages mean normals not updated |
| Bounding boxes | `Box3Helper(new Box3().setFromObject(obj))` |
| Light directions | `DirectionalLightHelper`, `SpotLightHelper` (call `update()` after moving) |

Keep helpers on a debug layer (`helper.layers.set(31)`; `camera.layers.enable(31)` to show them),
so screenshots for tests can exclude them by disabling the layer.

## 6. Playwright: software and GPU runs

The product's `playwright.config.ts` switches with `E2E_GPU=1`:
- default: SwiftShader through ANGLE, args `['--enable-unsafe-swiftshader', '--use-angle=swiftshader']`.
  Recent Chromium no longer falls back to SwiftShader for WebGL without the unsafe flag.
  Deterministic across machines, slow (AO and bloom at 1600x900 can take seconds per frame).
- `E2E_GPU=1`: real GPU via ANGLE Direct3D 11 on Windows, args `['--use-angle=d3d11', '--ignore-gpu-blocklist']`.
  Fast and representative; pixels differ between GPUs and drivers.

Confirm which renderer you got before trusting a result:

```ts
const info = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return 'no webgl2';
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
});
test.info().annotations.push({ type: 'renderer', description: info });   // "SwiftShader" in the software run
```

A typical test:

```ts
import { test, expect } from '@playwright/test';

test('diagram peels up and casts a shadow', async ({ page }) => {
  await page.goto('/index.html?debug&seed=1&quality=2');
  await page.waitForFunction(() => window.__inkleaf?.state().ready === true, null, { timeout: 60_000 });
  await page.evaluate(() => { const d = window.__inkleaf!; d.freeze(); d.step(1 / 60, 1); });
  await page.mouse.click(800, 470);                          // a known on-screen diagram position
  await page.evaluate(() => window.__inkleaf!.step(1 / 60, 90));
  const st = await page.evaluate(() => window.__inkleaf!.state());
  expect(st['diagram.heat']).toBe('popped');
  await expect(page.locator('canvas')).toHaveScreenshot('heat-popped.png', { maxDiffPixelRatio: 0.004 });
});
```

Prefer clicking through the debug API's projection helper (`__inkleaf.screenPointOf(id)`) over
hard-coded pixels, so layout changes do not break tests.

## 7. Deterministic frames

Sources of nondeterminism and their fixes:

| Source | Fix |
|---|---|
| Wall-clock time in updates or effects | `freeze()` + `step(fixedDt)`; pass the same `dt` to `composer.render` |
| `Math.random` in content | seeded RNG (`mulberry32(seed)`) passed via URL |
| Fonts loading late | wait for `document.fonts.ready` before the ready flag |
| Shader compile timing | `compileAsync` + warm-up frame before ready |
| N8AO temporal noise and accumulation | `accumulate = false`; render the same frame count from load; or turn AO off for strict goldens |
| Film grain or boil keyed on `time` | `dt = 0` or freeze uniforms |
| Adaptive quality | force a level via URL (`quality=2`) |
| Device pixel ratio | fix `deviceScaleFactor` in the project, and cap DPR in the app |
| Canvas readback | read right after a render in the same task, or use `page.screenshot` (compositor output) |

`page.screenshot` and `toHaveScreenshot` read the composited page, so they work without
`preserveDrawingBuffer`. In-page readback via `canvas.toDataURL()` needs either
`preserveDrawingBuffer: true` or a call in the same task as the render. For render targets use
`renderer.readRenderTargetPixels(target, x, y, w, h, buffer)` or the async variant.

## 8. Pixel assertions that survive GPU differences

Full-image diffs need per-project baselines (Playwright's default snapshot path includes the project
name) and a tolerance (`maxDiffPixelRatio` around 0.002 to 0.01, `threshold` 0.1 to 0.2). Add
semantic checks that hold on any GPU:

```ts
const px = await page.evaluate(([x, y]) => {
  const c = document.querySelector('canvas')!;
  const g = document.createElement('canvas'); g.width = c.width; g.height = c.height;
  const k = g.getContext('2d')!; k.drawImage(c, 0, 0);   // works when called right after a step()
  return Array.from(k.getImageData(x!, y!, 1, 1).data);
}, [820, 460]);
expect(px[0]! + px[1]! + px[2]!).toBeGreaterThan(600);   // paper under the lamp stays near white
```

Good invariants: lamp pool brighter than the page corner; ink pixels darker than 25 percent;
glow pixels more saturated than paper; no pure black outside ink; shadow region darker than lit
region by a margin; magnifier interior differs from the unmagnified crop.

## 9. Unit tests without WebGL (Vitest + happy-dom)

happy-dom has no WebGL or Web Audio. Test the math and the bookkeeping:
- page bend keeps arc length: sum of segment lengths along a row equals the page width within 1e-4
  for any `turn`, `lag`, `gutterLift`;
- springs and damping give the same value at t = 1 s whether stepped at 1/30, 1/60 or 1/144;
- easing functions hit 0 and 1 at the ends; `outBack` overshoots by the expected amount;
- the diagram state machine rejects invalid events and reverses mid-flight;
- the registry rejects duplicate ids; every interactive object has a proxy and a label;
- shader patch anchors exist: import `ShaderLib` from `three` and assert
  `ShaderLib.lambert.fragmentShader.includes('#include <opaque_fragment>')`, so a three upgrade fails
  in unit tests instead of at runtime.

```ts
import { describe, it, expect } from 'vitest';
import { springUnder } from '../src/motion/springs';

describe('springUnder is frame-rate independent', () => {
  it('matches at 30, 60 and 144 Hz', () => {
    const run = (hz: number) => { const s = { x: 0, v: 0 }; for (let i = 0; i < hz; i++) springUnder(s, 1, 54, 7.2, 1 / hz); return s.x; };
    expect(Math.abs(run(30) - run(144))).toBeLessThan(1e-3);
    expect(Math.abs(run(60) - run(144))).toBeLessThan(1e-3);
  });
});
```

## Do

- Ship the debug handle behind a flag; make `step` the only way tests advance time.
- Tag every object at creation; dump before guessing.
- Run SwiftShader for determinism and the GPU project for performance and realism.
- Assert semantics, then images with per-project baselines.

## Don't

- Don't wait with `page.waitForTimeout` for animations; step them.
- Don't compare SwiftShader screenshots against GPU baselines.
- Don't leave `shaderSource` hooks or helpers in production.

## Pitfalls

- Test passes locally, fails in CI: fonts or DPR differ; fix both in the project config.
- Screenshot blank: captured from an in-page canvas copy in a later task without
  `preserveDrawingBuffer`.
- Program list empty: `renderer.info.programs` read before the first render.
- Clicks miss: canvas CSS size differs from the viewport assumption; use the projection helper.

## Self-check (APIs used, verified)

- `renderer.debug.checkShaderErrors`, `debug.onShaderError(gl, program, glVertexShader, glFragmentShader)`: three r187 `src/renderers/WebGLRenderer.js` (lines 162 to 197), call site `src/renderers/webgl/WebGLProgram.js` (lines 825 to 844)
- `WebGLProgram.name`, `cacheKey`, `vertexShader`, `fragmentShader`, `program`: `src/renderers/webgl/WebGLProgram.js` (lines 981 to 988)
- `renderer.info.programs`, `getContext`, `readRenderTargetPixels`, `readRenderTargetPixelsAsync`: `src/renderers/WebGLRenderer.js`
- `Object3D.getObjectByName`, `getObjectsByProperty` (direct property comparison), `layers`, `userData`: `src/core/Object3D.js`; `Layers.mask`, `set`, `enable`: `src/core/Layers.js`
- `CameraHelper`, `Box3Helper`, `DirectionalLightHelper`, `SpotLightHelper`: `src/helpers/`; `ShadowMapViewer(light)`, `size`, `position`, `render`: `examples/jsm/utils/ShadowMapViewer.js`
- `ShaderLib.lambert.fragmentShader`: `src/renderers/shaders/ShaderLib.js`
- pmndrs `RenderPass.overrideMaterial`: postprocessing 6.39.6 d.ts (line 3592 onward); N8AO `setDisplayMode`: `n8ao/README.md`
- Playwright launch args and the `E2E_GPU` switch: the product's `playwright.config.ts`; `toHaveScreenshot` options: playwright.dev test-snapshots (checked 2026-11-22)
