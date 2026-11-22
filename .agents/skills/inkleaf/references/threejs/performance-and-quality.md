# Performance and quality

Targets for an inkleaf world (one open book, desk, a few popped diagrams, flows, AO, bloom, SMAA):
60 fps on a recent laptop iGPU at 1.5x pixel ratio, 30+ fps on a mid phone at 1x, zero cost when
nothing moves. Verified against three r187, postprocessing 6.39.6, n8ao 2.1.0.

## 1. Budgets

| Item | Budget | Why |
|---|---|---|
| Draw calls (main pass) | under 120 | each call costs CPU and state changes; shadow passes repeat many of them |
| Triangles | under 400k | pages and props are low poly; lines are quads per segment |
| Shadow-casting lights | 2 | each adds a full depth pass of casters when updated |
| Shadow map | 2048 (window), 1024 (lamp) | fit cameras tightly instead of raising size |
| Composer buffers | HalfFloat, 2 colour + depth | `w * h * 8` bytes each at the drawing buffer size |
| Textures | under 150 MB GPU | page canvases dominate; mipmaps add 33 percent |
| Programs | under 40 | each program is a compile; see warm-up |

## 2. Measuring

```ts
renderer.info.autoReset = false;          // the composer renders several times per frame
function frameStats() {
  const { calls, triangles, lines, points } = renderer.info.render;
  const { geometries, textures } = renderer.info.memory;
  const programs = renderer.info.programs?.length ?? 0;
  renderer.info.reset();                  // call once per frame, after reading
  return { calls, triangles, lines, points, geometries, textures, programs };
}
```

`renderer.info` (`WebGLInfo.js`): `render.{frame, calls, triangles, points, lines}`,
`memory.{geometries, textures}`, `programs`, `autoReset`, `reset()`. With `autoReset = true` (default)
each `render()` call resets the counters, so under a composer you only see the last pass.

Frame time: keep an exponential moving average of `dt` from the `Timer`. When the main thread is
idle but frames are slow, you are GPU bound (fill rate: pixel ratio, AO, bloom levels, shadow
radius). When `performance.now()` around your update code is large, you are CPU bound (allocations,
raycasts, CPU deformation, many objects). N8AO's `enableDebugMode()` reports `lastTime` in ms per
frame for AO alone, using `EXT_disjoint_timer_query_webgl2` where available.

## 3. Fewer draw calls

- Beads, bubbles, sparks: one `InstancedMesh` per kind (`geometry-and-deformation.md`).
- Static props that share a material: `mergeGeometries` into one mesh.
- Many different static meshes with one material and per-object transforms or visibility:
  `BatchedMesh(maxInstanceCount, maxVertexCount, maxIndexCount, material)` with `addGeometry`,
  `addInstance`, `setMatrixAt`, `setColorAt`, `setVisibleAt`, `deleteInstance`, `optimize`.
- Ink lines: one `LineSegments2` per diagram (all creases and boundaries merged), one per page for
  printed art. Hull outlines add one call per outlined mesh; outline the merged diagram, not parts.
- Hit proxies are invisible and cost nothing to render.
- Shadow passes draw every caster again per light: set `castShadow = false` on paper decals,
  lines, glows, beads and anything flat on the page.

## 4. Shader warm-up (no hitches on first interaction)

Facts from `WebGLRenderer.compile`/`compileAsync` in r187:
- Lights are gathered with `traverseVisible`; materials with `traverse`, so invisible meshes are
  compiled too, but only for the light setup that is visible at that moment.
- `compileAsync` uses `KHR_parallel_shader_compile` when available and resolves when programs are
  ready.
- Shadow depth materials, pmndrs effect materials and N8AO shaders compile on their first real use.
- `compileAsync(object, camera, targetScene)` prepares an object that is not in the scene yet using
  the target scene's lights: compile a new diagram before you add it.

```ts
export async function warmUp(renderer: WebGLRenderer, scene: Scene, camera: Camera, composer: EffectComposer | null) {
  // 1. Final light setup: same lights, same castShadow flags, same shadow map type as at runtime.
  // 2. Every variant visible once: diagrams popped, lens on, glow on, hull outlines on.
  setEverythingVisibleForWarmup(scene, true);
  await renderer.compileAsync(scene, camera);
  renderer.shadowMap.needsUpdate = true;
  if (composer) composer.render(0); else renderer.render(scene, camera);   // effects, AO, depth materials
  setEverythingVisibleForWarmup(scene, false);
}
```

Do it behind the loading cover. Then avoid run-time recompiles: no light count changes, no
`castShadow` toggles, no `defines` edits, no new maps on materials that had none, no N8AO quality
changes, no effect `SKIP` toggles (see `materials-and-shader-patching.md` section 3).

## 5. Adaptive quality from measured frame time

```ts
export interface QualityKnobs {
  pixelRatio: number; aoHalfRes: boolean; aoMode: 'Performance' | 'Low' | 'Medium' | 'High';
  bloomLevels: number; smaa: 'LOW' | 'MEDIUM' | 'HIGH'; shadowRadius: number; sharpLens: boolean;
}

const LADDER: QualityKnobs[] = [
  { pixelRatio: 2.0, aoHalfRes: false, aoMode: 'High',        bloomLevels: 8, smaa: 'HIGH',   shadowRadius: 4, sharpLens: true },
  { pixelRatio: 1.5, aoHalfRes: false, aoMode: 'Medium',      bloomLevels: 7, smaa: 'HIGH',   shadowRadius: 3, sharpLens: true },
  { pixelRatio: 1.25, aoHalfRes: true, aoMode: 'Medium',      bloomLevels: 6, smaa: 'MEDIUM', shadowRadius: 2, sharpLens: true },
  { pixelRatio: 1.0, aoHalfRes: true,  aoMode: 'Low',         bloomLevels: 5, smaa: 'MEDIUM', shadowRadius: 2, sharpLens: false },
  { pixelRatio: 0.85, aoHalfRes: true, aoMode: 'Performance', bloomLevels: 4, smaa: 'LOW',    shadowRadius: 1, sharpLens: false },
];

export class AdaptiveQuality {
  level: number;
  private ema = 1 / 60; private slowFor = 0; private fastFor = 0;
  constructor(start: number, private readonly budget = 1 / 55, private readonly apply: (k: QualityKnobs) => void) {
    this.level = start; this.apply(LADDER[start]!);
  }
  /** Call only for frames that actually rendered and while the scene is in motion. */
  sample(dt: number, calm: boolean): void {
    this.ema += (dt - this.ema) * 0.1;
    if (this.ema > this.budget * 1.15) { this.slowFor += dt; this.fastFor = 0; }
    else if (this.ema < this.budget * 0.7) { this.fastFor += dt; this.slowFor = 0; }
    else { this.slowFor = 0; this.fastFor = 0; }
    if (!calm) return;                                     // switch only between interactions
    if (this.slowFor > 2 && this.level < LADDER.length - 1) this.set(this.level + 1);
    else if (this.fastFor > 6 && this.level > 0) this.set(this.level - 1);
  }
  private set(l: number) { this.level = l; this.slowFor = this.fastFor = 0; this.apply(LADDER[l]!); }
}
```

Rules: measure only rendered frames (render-on-demand idles would look fast); use hysteresis
(downgrade after 2 s slow, upgrade after 6 s comfortably fast); apply changes when nothing is
animating, because a pixel ratio change or an AO recompile is visible. Persist the chosen level per
device in `localStorage` and start there next time. Pixel ratio changes need `renderer.setPixelRatio`
then `composer.setSize` (`renderer-color-tone.md`).

## 6. Render and update on demand

- The loop renders only when `invalidate()` was called or an updater reports motion
  (`animation-and-motion.md`). A static spread costs no GPU time.
- Shadows: `renderer.shadowMap.autoUpdate = false`; set `needsUpdate = true` while casters or lights
  move (`lights-shadows.md`).
- Canvas textures: redraw and re-upload only when their content changes; batch draws into one upload
  per frame.
- Insets and the sharp lens re-render: only while visible and moving.
- N8AO `accumulate` improves still frames but needs extra frames after motion stops; if you use it,
  keep rendering until it settles (about `1024 / aoSamples` frames), then stop.

## 7. CPU hygiene

- No allocations in per-frame code: module-level scratch `Vector3`, `Matrix4`, `Quaternion`.
- Static objects: `object.matrixAutoUpdate = false` and call `updateMatrix()` once; for large static
  subtrees also `matrixWorldAutoUpdate = false` after a final `updateMatrixWorld(true)`.
- Pick once per frame, against proxies.
- CPU page deformation: only for the page that is turning; resting pages keep their last pose.
- Silhouette extraction: only when the view direction relative to the model changed.

## 8. Disposal and memory

```ts
import type { Object3D, Material, Texture, Mesh } from 'three';

export function disposeTree(root: Object3D): void {
  const textures = new Set<Texture>();
  root.traverse((o) => {
    const m = o as Mesh;
    if (m.geometry) m.geometry.dispose();
    const mats = (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) as Material[];
    for (const mat of mats) {
      for (const v of Object.values(mat)) if ((v as Texture | null)?.isTexture) textures.add(v as Texture);
      const u = (mat as Material & { uniforms?: Record<string, { value: unknown }> }).uniforms;
      if (u) for (const k of Object.values(u)) if ((k.value as Texture | null)?.isTexture) textures.add(k.value as Texture);
      mat.dispose();
    }
  });
  for (const t of textures) t.dispose();
  root.removeFromParent();
}
```

- `material.dispose()` does not dispose its textures; `geometry.dispose()` frees GPU buffers only.
- Shared textures (paper fibre, noise) must be reference-counted or kept for the session; do not
  dispose them with one diagram.
- Render targets: `target.dispose()` frees colour attachments and destroys a depth texture only if
  that target owns it (`depthTexture.renderTarget === target`, `WebGLTextures.deallocateRenderTarget`);
  a depth texture shared between targets needs its own `dispose()`. Composer: `composer.dispose()`
  disposes passes and buffers.
- After disposing, `renderer.info.memory.geometries` and `.textures` should drop; check it in a
  test that opens and closes chapters repeatedly.
- `ImageBitmap.close()` for bitmaps you created; revoke object URLs.

## 9. Quality checklist before calling it done

- Pixel ratio capped; first frame after load has no compile stall (record a performance profile).
- No `PCFSoftShadowMap` warnings, no shader warnings in the console.
- Shadow acne and peter-panning checked on a turning page.
- Text on pages sharp at default zoom (texel to pixel ratio about 1 to 1.3) and readable in the lens.
- Bloom only on energy; paper whites never bloom.
- Idle: GPU usage near zero in the browser's task manager.
- Lost context recovers (`renderer.forceContextLoss()` test).
- Reduced motion path tested.

## Do

- Measure with `info` and frame-time EMA before optimizing.
- Merge lines and props, instance repeated things, batch heterogeneous statics.
- Warm up every variant behind the loading cover.
- Adapt quality with hysteresis, between interactions.

## Don't

- Don't trust `renderer.info` with `autoReset` under a composer.
- Don't change quality knobs mid-animation.
- Don't let every paper decal cast shadows.
- Don't dispose shared textures with a single owner's tree.

## Pitfalls

- 30 ms hitch on first peel-up: the popped state's shadow depth material or a new light variant
  compiled on demand.
- Memory climbs per chapter: canvases and render targets never disposed.
- Quality oscillates: no hysteresis or measuring idle frames.
- Lines cost more than meshes: thousands of tiny segments; simplify polylines (merge collinear
  segments) before building line geometry.

## Self-check (APIs used, verified in three r187 source)

- `renderer.info.render.*`, `memory.*`, `programs`, `autoReset`, `reset()`: `src/renderers/webgl/WebGLInfo.js`, `src/renderers/WebGLRenderer.js`
- `compile` light gathering with `traverseVisible`, material gathering with `traverse`, `targetScene`; `compileAsync` with `KHR_parallel_shader_compile`: `src/renderers/WebGLRenderer.js` (lines 1400 to 1611)
- `BatchedMesh(maxInstanceCount, maxVertexCount, maxIndexCount, material)` and `addGeometry`, `addInstance`, `setMatrixAt`, `setColorAt`, `setVisibleAt`, `deleteInstance`, `optimize`: `src/objects/BatchedMesh.js`
- `InstancedMesh`: `src/objects/InstancedMesh.js`; `mergeGeometries`: `examples/jsm/utils/BufferGeometryUtils.js`
- `shadowMap.autoUpdate`, `needsUpdate`: `src/renderers/webgl/WebGLShadowMap.js`
- `Object3D.matrixAutoUpdate`, `matrixWorldAutoUpdate`, `updateMatrix`, `updateMatrixWorld`, `removeFromParent`, `traverse`: `src/core/Object3D.js`
- `BufferGeometry.dispose`, `Material.dispose`, `Texture.dispose`, `RenderTarget.dispose`: `src/core/BufferGeometry.js`, `src/materials/Material.js`, `src/textures/Texture.js`, `src/core/RenderTarget.js`; owned depth texture destruction: `src/renderers/webgl/WebGLTextures.js` (`deallocateRenderTarget`)
- `setPixelRatio`, `forceContextLoss`: `src/renderers/WebGLRenderer.js`
- pmndrs `EffectComposer.render(deltaTime)`, `dispose`, `setSize`: postprocessing 6.39.6 `build/types/index.d.ts`
- N8AO `enableDebugMode`, `lastTime`, quality modes, `accumulate` frame count (1024 samples): `n8ao/README.md`, `n8ao/src/N8AOPostPass.js` (2.1.0)
