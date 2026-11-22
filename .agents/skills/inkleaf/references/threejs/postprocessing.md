# Post-processing with pmndrs postprocessing 6.39.6 and N8AO 2.1.0

Verified against `node_modules/postprocessing/build/types/index.d.ts` and `build/index.js`
(6.39.6), `node_modules/n8ao/src/N8AOPostPass.js` and its README (2.1.0), three r187.

## 1. The inkleaf chain and why it is ordered this way

```
RenderPass(scene, camera)                   HDR linear colour + depth, HalfFloat buffers
  -> N8AOPostPass                           AO multiplies lit colour (needs the depth of the scene render)
  -> EffectPass(camera, bloom, toneMapping) glow added in HDR, then one tone curve for everything
  -> EffectPass(camera, smaa)               anti-aliasing on display-referred colour
  -> EffectPass(camera, lens, vignette)     magnifier samples already anti-aliased pixels; vignette last
```

Rules behind it:
- An `EffectPass` merges its effects into one shader. At most one effect with
  `EffectAttribute.CONVOLUTION` per pass, and convolution effects cannot share a pass with effects
  that implement `mainUv`. `SMAAEffect` is `CONVOLUTION | DEPTH`, `ChromaticAberrationEffect` is
  `CONVOLUTION`; a lens that samples the input at several offsets is `CONVOLUTION` too. Hence
  separate passes.
- AO before bloom: AO should darken lit paper, not the glow halo.
- Tone mapping after bloom, before SMAA: SMAA's colour edge detection works best on final colours.
- The composer marks the last enabled pass `renderToScreen` automatically (`autoRenderToScreen`).
  That pass encodes to `renderer.outputColorSpace`.

```ts
import { HalfFloatType, Color, LinearSRGBColorSpace, type WebGLRenderer, type Scene, type PerspectiveCamera } from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode,
  SMAAEffect, SMAAPreset, EdgeDetectionMode, VignetteEffect, BlendFunction,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export function buildComposer(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, w: number, h: number) {
  const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: 0 });
  const render = new RenderPass(scene, camera);
  composer.addPass(render);

  const ao = new N8AOPostPass(scene, camera, w, h);
  ao.configuration.aoRadius = 0.04;          // metres: about the thickness of a closed book cover
  ao.configuration.distanceFalloff = 1.0;
  ao.configuration.intensity = 2.5;
  // N8AO runs convertSRGBToLinear() on the components it receives, so store raw sRGB numbers:
  ao.configuration.color = new Color().setHex(0x2a1d14, LinearSRGBColorSpace); // warm dark brown
  ao.setQualityMode('Medium');
  composer.addPass(ao);

  const bloom = new BloomEffect({
    blendFunction: BlendFunction.ADD,        // default SCREEN misbehaves with HDR values above 1
    mipmapBlur: true,
    luminanceThreshold: 1.6,                 // above lit paper (about 0.8 to 1.2 linear)
    luminanceSmoothing: 0.2,
    intensity: 0.9,
    radius: 0.7,
    levels: 7,
  });
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });
  composer.addPass(new EffectPass(camera, bloom, tone));

  composer.addPass(new EffectPass(camera, new SMAAEffect({
    preset: SMAAPreset.HIGH, edgeDetectionMode: EdgeDetectionMode.COLOR,
  })));

  const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.42 });
  composer.addPass(new EffectPass(camera, vignette));   // add the lens effect here too (glass-ui-and-lens.md)
  return { composer, render, ao, bloom, tone, vignette };
}
```

N8AO ships no TypeScript declarations. Add a small shim (keep it honest: only what you use):

```ts
// src/types/n8ao.d.ts
declare module 'n8ao' {
  import type { Camera, Color, Scene } from 'three';
  import type { Pass } from 'postprocessing';
  export interface N8AOConfiguration {
    aoSamples: number; aoRadius: number; aoTones: number; denoiseSamples: number; denoiseRadius: number;
    distanceFalloff: number; intensity: number; denoiseIterations: number; renderMode: 0 | 1 | 2 | 3 | 4;
    biasOffset: number; biasMultiplier: number; color: Color; gammaCorrection: boolean;
    screenSpaceRadius: boolean; halfRes: boolean; colorMultiply: boolean; transparencyAware: boolean;
    accumulate: boolean; neuralDenoise: boolean;
  }
  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: N8AOConfiguration;
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'
      | 'Neural-Performance' | 'Neural-Low' | 'Neural-Medium' | 'Neural-High'): void;
    setDisplayMode(mode: 'Combined' | 'AO' | 'No AO' | 'Split' | 'Split AO'): void;
    enableDebugMode(): void; disableDebugMode(): void; lastTime?: number;
    readonly effectiveConfiguration: Record<string, unknown>;
  }
}
```

## 2. N8AO settings that matter for a book on a desk

- `aoRadius` is world units: 0.02 to 0.06 for a book scene in metres (README: one to two orders of
  magnitude below scene size). `screenSpaceRadius: true` switches it to pixels (16 to 64).
- `distanceFalloff` 1.0 is safe; lower reduces haloes but can erase AO.
- `intensity` is `pow(ao, intensity)`: 2 subtle, 5 (default) heavy.
- `color` is treated as sRGB: the pass calls `convertSRGBToLinear()` on the `Color`'s stored
  components (`N8AOPostPass.js`). A `Color` built from hex is already linear in three, so
  `new Color(0x2a1d14)` gets converted twice and turns too dark. Use
  `new Color().setHex(hex, LinearSRGBColorSpace)` to store the raw sRGB numbers. A warm dark tone
  avoids grey dirt on cream paper.
- Quality modes: `Performance`, `Low`, `Medium` (default), `High`, `Ultra`, and four `Neural-*`
  modes. Changing samples or modes recompiles the AO shaders; do it once at start or on tier change.
- `halfRes = true` roughly halves to quarters the cost (depth-aware upsampling always on in 2.1).
- `accumulate = true` refines AO while the camera is still; moving objects smear. Leave it off
  during page turns.
- `gammaCorrection` is set automatically from the pass position (false unless last). Washed out:
  force false. Too dark: force true.
- Transparent objects with `depthWrite: false` (glows, light pools) do not occlude AO, which is
  what you want. `mesh.userData.treatAsOpaque = true` forces a transparent mesh to count as opaque;
  `mesh.userData.cannotReceiveAO = true` excludes a receiver (renders it twice).
- Hardware MSAA does not work with AO (README); keep `multisampling: 0` and use SMAA.
- Debug: `ao.setDisplayMode('AO')`, `ao.enableDebugMode()` then read `ao.lastTime` (needs
  `EXT_disjoint_timer_query_webgl2`).

## 3. Bloom and selective glow

`BloomEffect` options (6.39.6): `blendFunction` (default `SCREEN`), `luminanceThreshold` (default
1.0), `luminanceSmoothing` (0.03), `mipmapBlur` (default true), `intensity` (1), `radius` (0.85,
mipmap blur only), `levels` (8). `kernelSize`, `resolutionScale`, `width`, `height` are deprecated
in favour of `mipmapBlur`. Runtime knobs: `bloom.intensity`, `bloom.luminanceMaterial.threshold`,
`bloom.luminanceMaterial.smoothing`, `bloom.mipmapBlurPass.radius`, `bloom.mipmapBlurPass.levels`.

Three ways to make only energy flows glow:
1. Threshold (cheapest, recommended): HalfFloat buffers keep values above 1. Lit paper stays near
   1; glow materials output 3 to 20 (`emissive` with `emissiveIntensity`, or a `MeshBasicMaterial`
   colour scaled above 1 via `color.multiplyScalar(8)`). Set `luminanceThreshold` between.
   Remember the window patch on white paper can exceed 1.5 if lights are hot: measure.
2. `SelectiveBloomEffect(scene, camera, options)`: `effect.selection.add(mesh)`; renders the
   selection again into its own target (extra draw calls). Has `inverted` and `ignoreBackground`.
   Use when glow colours are dim (dark red embers) and cannot exceed the paper.
3. Layers: render glow objects alone into a target and composite with `TextureEffect`. Most control,
   most code; only for special looks.

Glow materials: `toneMapped` is irrelevant under the composer (the whole frame is tone mapped).
Make glow cores `depthWrite: false` only if they must not occlude; beads usually should write depth.

## 4. SMAA, vignette, tone mapping effect details

- `SMAAEffect({ preset, edgeDetectionMode, predicationMode })`: default `SMAAPreset.MEDIUM`,
  `EdgeDetectionMode.COLOR`, blend `SRC`. `HIGH` is a good default on desktop, `LOW` on the low tier.
- `VignetteEffect({ technique, offset, darkness })`: defaults `VignetteTechnique.DEFAULT`, 0.5, 0.5.
  On a warm desk scene keep darkness under 0.5; a vignette that reaches the book reads as dirt.
- `ToneMappingEffect({ mode })` modes: `LINEAR, REINHARD, REINHARD2, REINHARD2_ADAPTIVE, UNCHARTED2,
  OPTIMIZED_CINEON, CINEON, ACES_FILMIC, AGX, NEUTRAL`. Exposure comes from
  `renderer.toneMappingExposure` (see `renderer-color-tone.md`).

## 5. Writing a custom Effect

Fragment entry points (pmndrs wiki, confirmed in the effect template of 6.39.6):
```glsl
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor);
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor); // needs EffectAttribute.DEPTH
void mainUv(inout vec2 uv);
```
Available everywhere: `uniform vec2 resolution; uniform vec2 texelSize; uniform float cameraNear;
uniform float cameraFar; uniform float aspect; uniform float time;` and `varying vec2 vUv`; in the
fragment also `inputBuffer`, `depthBuffer`, `readDepth(uv)`, `getViewZ(depth)`, and three's
`common` and `packing` chunks. `PERSPECTIVE_CAMERA` and `FRAMEBUFFER_PRECISION_HIGH` macros are set
when applicable. Do not declare global non-uniform variables or constants (effects are merged).

The constructor default blend is `BlendFunction.SCREEN`. An effect that outputs a full colour must
pass `BlendFunction.NORMAL` (or `SRC`), or it will brighten everything.

```ts
import { Uniform, Color } from 'three';
import { Effect, BlendFunction } from 'postprocessing';

const paperFrag = /* glsl */ `
uniform vec3 uTint; uniform float uGrain; uniform float uTintMix;
float paperHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float n = paperHash(floor(uv * resolution) + floor(time * 12.0)) - 0.5;   // 12 Hz grain, film-like
  vec3 c = mix(inputColor.rgb, inputColor.rgb * uTint, uTintMix);
  outputColor = vec4(c + n * uGrain, inputColor.a);
}`;

export class PaperGrainEffect extends Effect {
  constructor(tint = new Color(1.0, 0.97, 0.92), grain = 0.012) {
    super('PaperGrainEffect', paperFrag, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uTint', new Uniform(tint)], ['uGrain', new Uniform(grain)], ['uTintMix', new Uniform(0.35)],
      ]),
    });
  }
  set grain(v: number) { const u = this.uniforms.get('uGrain'); if (u) u.value = v; }
}
```

Grain runs after tone mapping in display space, so `uGrain` around 0.01 is visible but quiet.
With deterministic tests, freeze `time` by passing a constant `deltaTime` of 0 to `composer.render`.

Per-frame CPU work goes into `update(renderer, inputBuffer, deltaTime)` (override it); size-dependent
resources into `setSize(width, height)`; one-time GPU setup into `initialize(renderer, alpha,
frameBufferType)`. Changing `defines` or adding uniforms after construction needs the protected
`setChanged()` from inside the subclass.

Turning effects on and off: `pass.enabled = false` skips a whole pass for free. Setting an effect's
`blendMode.blendFunction` to `BlendFunction.SKIP` removes it from the merged shader, which rebuilds
the pass program. For animated fades use `effect.blendMode.opacity.value`.

## 6. Depth-based ink edges (secondary outlines)

```ts
import { Uniform, type Color } from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';

const edgeFrag = /* glsl */ `
uniform vec3 uInk; uniform float uThreshold; uniform float uStep; uniform float uStrength;
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec2 o = texelSize * uStep;
  float z = getViewZ(depth);
  float lap = getViewZ(readDepth(uv - vec2(o.x, 0.0))) + getViewZ(readDepth(uv + vec2(o.x, 0.0)))
            + getViewZ(readDepth(uv - vec2(0.0, o.y))) + getViewZ(readDepth(uv + vec2(0.0, o.y))) - 4.0 * z;
  float edge = smoothstep(uThreshold, 2.0 * uThreshold, abs(lap) / max(abs(z), 1e-3));
  outputColor = vec4(mix(inputColor.rgb, uInk, edge * uStrength), inputColor.a);
}`;

export class DepthInkEdgeEffect extends Effect {
  constructor(ink: Color, threshold = 0.015, step = 1, strength = 0.6) {
    super('DepthInkEdgeEffect', edgeFrag, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uInk', new Uniform(ink)], ['uThreshold', new Uniform(threshold)],
        ['uStep', new Uniform(step)], ['uStrength', new Uniform(strength)],
      ]),
    });
  }
}
```

It reads depth through `readDepth`, not extra input colour samples, so it is not a convolution
effect and can share a pass with bloom and tone mapping. Put it before tone mapping in that pass if
the ink colour is linear.

## 7. Render targets: MSAA, depth textures, render-to-texture

`WebGLRenderTarget(width, height, options)` options in r187 include `type`, `format`, `colorSpace`,
`minFilter`, `magFilter`, `generateMipmaps` (default false), `depthBuffer` (true), `stencilBuffer`
(false), `depthTexture` (null), `samples` (0), `count` (1, MRT), `resolveDepthBuffer` (true).

```ts
import {
  WebGLRenderTarget, DepthTexture, HalfFloatType, UnsignedIntType, DepthFormat, LinearFilter,
  MeshBasicMaterial, type WebGLRenderer, type Scene, type Camera,
} from 'three';

export function makeInsetTarget(w: number, h: number) {
  const depth = new DepthTexture(w, h, UnsignedIntType);
  depth.format = DepthFormat;
  return new WebGLRenderTarget(w, h, {
    type: HalfFloatType, samples: 4, depthTexture: depth, minFilter: LinearFilter, generateMipmaps: false,
  });
}

/** Render a second scene (for example a tiny world inside a page window) into a texture. */
export function renderInset(renderer: WebGLRenderer, target: WebGLRenderTarget, scene: Scene, camera: Camera) {
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(prev);
}
// mesh.material = new MeshBasicMaterial({ map: target.texture, toneMapped: false });
```

Colour facts: rendering into a target uses the working colour space (linear) and no renderer tone
mapping (`WebGLPrograms.js`). The target texture is `NoColorSpace` by default, which means "already
linear" when used as a `map`, so the inset looks right inside the main scene and gets the global tone
curve once, at the end. Do not tone map the inset separately.

Multisampled targets resolve automatically before their texture is sampled. Render insets before
`composer.render()`, every frame only while their content moves.

To overlay a texture on the final frame (a title card, a debug view), use pmndrs
`TextureEffect({ texture, blendFunction })` in an effect pass.

## Do

- HalfFloat composer buffers, `multisampling: 0`, SMAA, renderer `NoToneMapping`.
- One `ToneMappingEffect`, placed after bloom.
- Glow above threshold by design: write the threshold next to the glow intensity constants.
- Keep convolution effects in separate passes.

## Don't

- Don't leave bloom on `BlendFunction.SCREEN` with HDR buffers.
- Don't place N8AO after tone mapping (it would darken LDR colour and break gamma detection).
- Don't change N8AO quality per frame.
- Don't animate effect presence by switching to `SKIP`.

## Pitfalls

- Everything blooms: lights are hot enough that paper exceeds the threshold. Lower exposure or raise
  the threshold, never both blindly; sample the page's linear value first.
- Picture is washed out: N8AO `gammaCorrection` true while not last, or a texture tagged sRGB twice.
- `EffectPass` warns about incompatible effects: two convolution effects in one pass.
- Black frame after resize: a custom effect ignored `setSize` for its own targets.
- AO halo around ink hull outlines: lower `aoRadius` or exclude the hull from AO by moving it to
  a separate draw after AO (only if visible).

## Self-check (APIs used, verified)

- `EffectComposer` constructor options, `addPass`, `setSize`, `render(deltaTime)`, `autoRenderToScreen`, `multisampling`: postprocessing 6.39.6 `build/types/index.d.ts` line 4787 onward, `build/index.js` (`setSize`, `render`)
- `RenderPass(scene, camera, overrideMaterial)`, `EffectPass(camera, ...effects)`, `Pass.enabled`, `renderToScreen`: same d.ts (lines 3592, 4349, 2766)
- `Effect` constructor options and default `SCREEN`, `update`, `setSize`, `initialize`, `setChanged`, `blendMode`: d.ts lines 4029 to 4309
- `EffectAttribute.CONVOLUTION, DEPTH`; `BlendFunction` members (`ADD, NORMAL, SRC, SKIP, SCREEN`): d.ts lines 4322, 3921
- `BloomEffect` options and defaults, `luminanceMaterial.threshold/smoothing`, `mipmapBlurPass.radius/levels`: d.ts 5283, `build/index.js` `BloomEffect` constructor
- `SelectiveBloomEffect(scene, camera, options)`, `selection`, `inverted`, `ignoreBackground`: d.ts 7588
- `SMAAEffect` options and `CONVOLUTION | DEPTH` attributes, `SMAAPreset`, `EdgeDetectionMode`: d.ts 7931, 8095, 897; `build/index.js`
- `VignetteEffect`, `VignetteTechnique`, `ToneMappingEffect`, `ToneMappingMode`: d.ts 8694 to 8740, 8493 to 8560
- effect shader uniforms, `readDepth`, `getViewZ`, `mainImage` signatures: `build/index.js` (`effect_default`), pmndrs wiki Custom Effects (fetched 2026-11-22)
- `TextureEffect`: d.ts 8376
- `N8AOPostPass(scene, camera, width, height)`, `configuration` keys and defaults, `setQualityMode`, `setDisplayMode`, `enableDebugMode`, `setSize`, `effectiveConfiguration`, `color` passed through `convertSRGBToLinear()` (around line 845): `n8ao/src/N8AOPostPass.js`, `n8ao/README.md` (2.1.0)
- `Color.setHex(hex, colorSpace = SRGBColorSpace)`, `convertSRGBToLinear`, `LinearSRGBColorSpace`: three r187 `src/math/Color.js`, `src/constants.js`
- `WebGLRenderTarget` options, `DepthTexture(width, height, type)`, `DepthFormat`, `UnsignedIntType`, `HalfFloatType`, `setRenderTarget`, `getRenderTarget`, `clear`: three r187 `src/core/RenderTarget.js`, `src/textures/DepthTexture.js`, `src/constants.js`, `src/renderers/WebGLRenderer.js`
- render target colour space and tone mapping rules: `src/renderers/webgl/WebGLPrograms.js`
