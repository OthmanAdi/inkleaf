# Renderer, colour management and tone mapping

Pinned stack: three 0.187.0 (r187), postprocessing 6.39.6, n8ao 2.1.0, WebGL2 only.
Everything below was checked against `node_modules/three/src` of r187.

## 1. Two valid setups, pick one

| Setup | When | Canvas flags | Tone mapping lives in |
|---|---|---|---|
| A. Composer (default for inkleaf) | AO, bloom, SMAA, vignette, lens | `antialias: false`, `depth: false`, `stencil: false` | `ToneMappingEffect` (pmndrs), renderer stays `NoToneMapping` |
| B. Plain renderer | tests, thumbnails, low tier fallback | `antialias: true`, `depth: true` | `renderer.toneMapping` |

Why: three applies `renderer.toneMapping` only when the current render target is `null`
(`WebGLPrograms.js`: `if ( currentRenderTarget === null || currentRenderTarget.isXRRenderTarget === true ) toneMapping = renderer.toneMapping`).
A composer renders the scene into its own target, so the renderer setting silently does nothing
for scene materials. The pmndrs README says the same: keep `NoToneMapping`, use high precision
buffers, put `ToneMappingEffect` at the end.

```ts
import {
  WebGLRenderer, SRGBColorSpace, NoToneMapping, NeutralToneMapping, HalfFloatType,
} from 'three';
import { EffectComposer } from 'postprocessing';

export function createRenderer(canvas: HTMLCanvasElement, useComposer: boolean) {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: !useComposer,   // MSAA on the canvas is wasted when a composer owns the frame
    depth: !useComposer,       // the composer's buffers carry depth
    stencil: false,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = SRGBColorSpace;            // default, written out for readers
  renderer.toneMapping = useComposer ? NoToneMapping : NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;                      // type defaults to PCFShadowMap

  const composer = useComposer
    ? new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: 0 })
    : null;
  return { renderer, composer };
}
```

`depth: false` means anything you ever render straight to the screen (a debug view, a
`renderer.render(scene, camera)` fallback) has no depth buffer and will draw in submission order.
If you keep a no-composer fallback in the same renderer, use `depth: true`.

Constructor options that exist in r187: `canvas, context, depth, stencil, alpha, antialias,
premultipliedAlpha, preserveDrawingBuffer, powerPreference, failIfMajorPerformanceCaveat,
reversedDepthBuffer, outputBufferType` (destructured in `WebGLRenderer.js`) plus `precision` and
`logarithmicDepthBuffer`, which are read from the same parameters object by
`webgl/WebGLCapabilities.js`. `logarithmicDepthBuffer` is ignored when the reversed depth buffer is
active. Do not invent other options; check those two files.

## 2. Colour management rules

`ColorManagement.enabled` is `true` and the working space is `LinearSRGBColorSpace`
(`math/ColorManagement.js`). Practical consequences:

1. `new Color(0xf4efe6)`, `'#f4efe6'` and CSS strings are treated as sRGB and converted to linear
   on input. `color.setRGB(r, g, b)` without a colour space argument takes working (linear) values.
   Use `color.setRGB(r, g, b, SRGBColorSpace)` when the numbers come from a design tool.
2. Textures default to `colorSpace = NoColorSpace` (`textures/Texture.js` constructor). Set
   `SRGBColorSpace` on anything that holds visible colour (albedo, emissive, canvas text, cookie
   art). Leave data maps (normal, roughness, AO, height, masks, flow fields) at `NoColorSpace`.
3. Render targets you create hold linear data. Do not tag them sRGB unless you know the consumer
   expects 8-bit sRGB storage.
4. `outputColorSpace = SRGBColorSpace` encodes at the end. In setup A the last pmndrs pass does it
   (the effect shader ends with `#include <colorspace_fragment>` under `ENCODE_OUTPUT`).
5. A custom `ShaderMaterial` takes part in tone mapping and output encoding only if its fragment
   shader ends with:
   ```glsl
   gl_FragColor = vec4( color, alpha );
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
   ```
   Built-in materials already do this. A `RawShaderMaterial` gets no prefix at all.

Paper and ink colours: pick them in sRGB (design space), convert once, keep linear values in uniforms.

```ts
import { Color, SRGBColorSpace } from 'three';
export const PAPER = new Color().setRGB(0.957, 0.937, 0.902, SRGBColorSpace); // stored linear
export const INK = new Color(0x1d1b22);                                          // hex = sRGB
```

## 3. Tone mapping choices (constants from `src/constants.js`)

| Constant | Value | Look | Use in inkleaf |
|---|---|---|---|
| `NoToneMapping` | 0 | clamp at 1 | renderer setting under a composer |
| `LinearToneMapping` | 1 | exposure, then clamp | debug only |
| `ReinhardToneMapping` | 2 | soft, greyish whites | rarely |
| `CineonToneMapping` | 3 | filmic, contrasty | rarely |
| `ACESFilmicToneMapping` | 4 | strong contrast, hue shifts in saturated glows | avoid for paper whites |
| `CustomToneMapping` | 5 | your `CustomToneMapping()` via `ShaderChunk` patch | special looks |
| `AgXToneMapping` | 6 | graceful highlight roll-off, desaturates bright glow | glow-heavy scenes |
| `NeutralToneMapping` | 7 | Khronos PBR Neutral: values below about 0.76 pass almost unchanged | default for printed pages |

Neutral keeps a paper white near the albedo you picked (the shader starts compression at
`0.8 - 0.04`), which matters for a book that must look printed. AgX rolls a lit page down to a
light grey; compensate with exposure or pick Neutral. Bloom colours survive better under AgX.
pmndrs equivalents: `ToneMappingMode.NEUTRAL`, `ToneMappingMode.AGX`, `ToneMappingMode.ACES_FILMIC`.

Exposure: `renderer.toneMappingExposure` multiplies colour before the curve
(`tonemapping_pars_fragment`: `color *= toneMappingExposure`). Under pmndrs this still works:
`ToneMappingEffect` includes three's `tonemapping_pars_fragment`, and the renderer writes the
`toneMappingExposure` uniform from `renderer.toneMappingExposure` for every material it draws
(`WebGLRenderer.js`, `p_uniforms.setValue( _gl, 'toneMappingExposure', ... )`). So keep
`renderer.toneMapping = NoToneMapping` and still use `renderer.toneMappingExposure` as the exposure
knob. `ToneMappingEffect` itself has no exposure option (its options are `blendFunction, adaptive,
mode, resolution, maxLuminance, whitePoint, middleGrey, minLuminance, averageLuminance,
adaptationRate`). Confirm once in your build by toggling exposure and reading a pixel.

`material.toneMapped = false` exempts a built-in material from renderer tone mapping (setup B only).
Under a composer the whole image is tone mapped, so a UI sprite inside the 3D scene must be authored
for that curve or drawn in DOM instead.

Clear colour: the renderer clear does not run a shader, so in setup B the background colour is not
tone mapped while objects are. In setup A it is. Pick the desk colour as a mesh, not a clear colour,
if you switch setups.

## 4. Pixel ratio by device tier

Fill rate is the main cost of AO, bloom and SMAA. Cap the drawing buffer by both a ratio and a pixel
budget.

```ts
export type TierName = 'low' | 'mid' | 'high';
export interface Tier { name: TierName; maxDpr: number; maxPixels: number; shadowSize: number }

export const TIERS: Record<TierName, Tier> = {
  low:  { name: 'low',  maxDpr: 1.0, maxPixels: 1.2e6, shadowSize: 1024 },
  mid:  { name: 'mid',  maxDpr: 1.5, maxPixels: 2.6e6, shadowSize: 2048 },
  high: { name: 'high', maxDpr: 2.0, maxPixels: 4.6e6, shadowSize: 2048 },
};

export function pickPixelRatio(tier: Tier, cssW: number, cssH: number): number {
  const device = window.devicePixelRatio || 1;
  const byRatio = Math.min(device, tier.maxDpr);
  const byBudget = Math.sqrt(tier.maxPixels / Math.max(1, cssW * cssH));
  return Math.max(0.75, Math.min(byRatio, byBudget));
}

export function guessTier(): TierName {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  if (coarse && cores <= 6) return 'low';
  if (coarse || cores <= 4) return 'mid';
  return 'high';
}
```

The guess is only a start. Measure frame time and step down (see `performance-and-quality.md`).
`setPixelRatio` internally calls `setSize` with the current CSS size (`WebGLRenderer.js`), so call it
before you resize the composer.

## 5. Resize correctly

```ts
import type { PerspectiveCamera, WebGLRenderer } from 'three';
import type { EffectComposer } from 'postprocessing';

export function watchSize(
  host: HTMLElement, renderer: WebGLRenderer, camera: PerspectiveCamera,
  composer: EffectComposer | null, tier: () => Tier, invalidate: () => void,
): { apply: () => void; dispose: () => void } {
  let pending: { w: number; h: number } | null = null;
  const ro = new ResizeObserver((entries) => {
    const box = entries[0]?.contentRect;
    if (!box) return;
    pending = { w: Math.max(1, Math.floor(box.width)), h: Math.max(1, Math.floor(box.height)) };
    invalidate();
  });
  ro.observe(host);
  const apply = () => {                      // call at the top of each frame
    if (!pending) return;
    const { w, h } = pending; pending = null;
    renderer.setPixelRatio(pickPixelRatio(tier(), w, h));
    if (composer) composer.setSize(w, h, false); else renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  return { apply, dispose: () => ro.disconnect() };
}
// const size = watchSize(...); call size.apply() first thing in every frame (named applySize below)
```

Details that bite:
- `renderer.setSize(w, h, false)` leaves the CSS size to your stylesheet (`canvas { width: 100%;
  height: 100% }`). Passing `true` writes inline px sizes and can fight a flex layout.
- pmndrs `EffectComposer.setSize(w, h, updateStyle)` calls `renderer.setSize` only when the logical
  size changed, then always resizes its buffers and passes to the drawing buffer size. After a pixel
  ratio change you must still call `composer.setSize`.
- `LineMaterial` reads the viewport in `LineSegments2.onBeforeRender`, so fat lines follow resizes
  without extra code.
- Apply the resize inside the frame, not in the observer callback, so one frame never renders with
  a mismatched camera aspect and buffer size.

## 6. Render loop

Use `Timer` (core, exported from `three`). `Clock` is deprecated since r183 and warns.

```ts
import { Timer } from 'three';

const timer = new Timer();
timer.connect(document);        // Page Visibility: no giant dt after a hidden tab

let dirty = true;
let activeAnimations = 0;
export const invalidate = () => { dirty = true; };

renderer.setAnimationLoop((t: number) => {
  timer.update(t);
  const dt = Math.min(timer.getDelta(), 1 / 20);   // clamp: no tunnelling after a hitch
  applySize();
  const moving = step(dt) || activeAnimations > 0;  // your simulation returns "still moving"
  if (!dirty && !moving) return;                    // render on demand
  dirty = false;
  if (composer) composer.render(dt); else renderer.render(scene, camera);
});
```

Pass `dt` to `composer.render(dt)`. Without an argument the composer advances its own timer, which
breaks deterministic tests. N8AO accumulation and SMAA are fine with skipped frames. If AO
`accumulate` is on, keep rendering a few frames after motion stops so accumulation converges, or
leave it off.

## 7. Context loss

r187 registers `webglcontextlost` (it calls `event.preventDefault()` so a restore is possible) and
`webglcontextrestored` (it rebuilds its GL state and keeps shadow map settings). Three re-uploads
geometries, textures and render targets lazily on the next render because its property caches are
rebuilt. What you own is your problem: raw GL objects, `ImageBitmap`s you closed, pending
`compileAsync` promises.

```ts
const canvas = renderer.domElement;
canvas.addEventListener('webglcontextlost', () => {
  renderer.setAnimationLoop(null);
  showOverlay('Graphics paused. Restoring...');
});
canvas.addEventListener('webglcontextrestored', async () => {
  await renderer.compileAsync(scene, camera);      // re-warm programs before the first frame
  hideOverlay();
  renderer.setAnimationLoop(loop);
  invalidate();
});
// test it: renderer.forceContextLoss(); later renderer.forceContextRestore();
```

`forceContextLoss` and `forceContextRestore` need `WEBGL_lose_context`; both are no-ops without it.

## 8. Things new in r187 that change advice from older tutorials

- `outputBufferType` (constructor) plus `renderer.setEffects(effects)` is three's own built-in post
  chain. It requires `HalfFloatType` or `FloatType` and applies tone mapping and output conversion
  itself. Do not combine it with the pmndrs composer; pick one pipeline. inkleaf uses pmndrs.
- `reversedDepthBuffer: true` (needs `EXT_clip_control`) improves depth precision. A desk scene with
  near 0.05 and far 20 does not need it. N8AO 2.1 reads the renderer depth type and adapts.
- `PCFSoftShadowMap` is deprecated since r186 and replaced by `PCFShadowMap` at render time with a
  warning. See `lights-shadows.md`.
- `Clock` is deprecated (r183); use `Timer`.

## Do

- Decide setup A or B once, write it in the scene manifest, and keep tone mapping in one place.
- Choose all colours in sRGB, convert once, store linear.
- Cap pixel ratio by a pixel budget, not only by `devicePixelRatio`.
- Render on demand; animate only while something moves.

## Don't

- Don't set `renderer.toneMapping` and also add `ToneMappingEffect`. Under a composer the first is
  ignored for scene materials, which hides the double setup until you add a direct render.
- Don't use `preserveDrawingBuffer: true` for screenshots in production; capture right after a
  render in the same task instead (see `debugging-and-testing.md`).
- Don't call `renderer.setSize` with fractional sizes from `getBoundingClientRect`; floor them.

## Pitfalls

- Washed-out image: a texture with colour is still `NoColorSpace`, or an effect encodes sRGB twice
  (N8AO `gammaCorrection` true while not last).
- Dark and muddy: a data map was tagged `SRGBColorSpace`.
- Banding in a dark vignette: 8-bit composer buffers. Use `frameBufferType: HalfFloatType`.
- Whites look grey: AgX on paper. Use Neutral or raise exposure.

## Self-check (APIs used, verified in three r187 source)

- `WebGLRenderer` options, `outputColorSpace`, `toneMapping`, `toneMappingExposure`, `setPixelRatio`,
  `setSize`, `setAnimationLoop`, `compileAsync`, `forceContextLoss`, `forceContextRestore`,
  `setEffects`, `shadowMap.enabled`: `src/renderers/WebGLRenderer.js`
- tone mapping gate on render target: `src/renderers/webgl/WebGLPrograms.js` lines 179 to 189
- tone mapping constants, `SRGBColorSpace`, `LinearSRGBColorSpace`, `NoColorSpace`, `HalfFloatType`,
  `PCFSoftShadowMap` deprecation: `src/constants.js`
- Neutral curve constants and `toneMappingExposure`: `src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js`
- `ColorManagement.enabled`, `workingColorSpace`: `src/math/ColorManagement.js`
- `Texture` default `colorSpace`: `src/textures/Texture.js`
- `Timer.connect`, `update`, `getDelta`; `Clock` deprecation: `src/core/Timer.js`, `src/core/Clock.js`
- context listeners and restore behaviour: `src/renderers/WebGLRenderer.js` (`onContextLost`, `onContextRestore`)
- pmndrs `EffectComposer` options, `setSize`, `render(deltaTime)`: `postprocessing/build/types/index.d.ts` and `build/index.js` (6.39.6)
