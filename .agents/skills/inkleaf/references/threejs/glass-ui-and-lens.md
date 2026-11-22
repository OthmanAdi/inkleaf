# Glass UI and the magnifier lens

Two different glass problems:
1. A magnifier that reads terms on the page: a post-processing effect that resamples the rendered
   frame inside a circle (optionally from a sharper re-render), with rim refraction, chromatic
   aberration and an optional frosted mode.
2. Glass capsule toolbars over the canvas: plain CSS `backdrop-filter`, no WebGL.

Stack: pmndrs postprocessing 6.39.6 `Effect`, three r187.

## 1. Lens as a pmndrs Effect

The effect samples `inputBuffer` at displaced coordinates several times, so it is a
`EffectAttribute.CONVOLUTION` effect and needs its own `EffectPass`, after the SMAA pass (SMAA is
also convolution). Vignette can share the lens pass.

Coordinates: `uv` is 0..1 with origin bottom-left; `resolution` is the composer buffer size in
device pixels. Keep the lens centre and radius in device pixels so the circle stays round at any
aspect ratio.

```ts
import { Uniform, Vector2, type Texture } from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';

const lensFrag = /* glsl */ `
#include <tonemapping_pars_fragment>
uniform vec2 uCenter;      // device px, bottom-left origin
uniform float uRadius;     // device px
uniform float uZoom;       // 1 = no zoom
uniform float uRim;        // rim refraction strength 0..1
uniform float uCA;         // chromatic aberration 0..1
uniform float uFrost;      // 0 clear .. 1 frosted
uniform float uOpacity;    // 0 hidden .. 1 shown
uniform float uUseSharp;   // 1 = sample uSharp (re-rendered zoom), 0 = resample the frame
uniform sampler2D uSharp;

vec3 lensFetch(vec2 q) {   // q: offset from centre in device px, already divided by zoom
  if (uUseSharp > 0.5) {
    vec2 st = q * uZoom / (2.0 * uRadius) + 0.5;
    return NeutralToneMapping(texture2D(uSharp, st).rgb);   // match the main pipeline's curve
  }
  return texture2D(inputBuffer, (uCenter + q) / resolution).rgb;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 p = uv * resolution - uCenter;
  float d = length(p);
  float r = d / uRadius;
  if (r >= 1.0 || uOpacity <= 0.0) { outputColor = inputColor; return; }
  vec2 dir = p / max(d, 1e-4);
  float edge = smoothstep(0.70, 1.0, r);
  vec2 q = p / uZoom * (1.0 - 0.35 * uRim * edge * edge);   // thick rim bends rays toward the centre
  vec2 ca = dir * (uCA * edge * edge * 0.02 * uRadius);
  vec3 col = vec3(lensFetch(q + ca).r, lensFetch(q).g, lensFetch(q - ca).b);
  if (uFrost > 0.0) {                                        // 8-tap golden-angle disc
    vec3 acc = col;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 2.39996 + 0.5;
      float rr = sqrt((float(i) + 0.5) / 8.0) * uFrost * 7.0;
      acc += lensFetch(q + vec2(cos(a), sin(a)) * rr);
    }
    col = acc / 9.0;
  }
  float highlight = smoothstep(0.80, 0.97, r) * max(0.0, dot(dir, vec2(-0.6, 0.8)));
  col += highlight * 0.22;                                   // sky reflection on the upper left rim
  col *= mix(1.0, 0.8, smoothstep(0.93, 1.0, r));            // darker glass edge
  float inside = 1.0 - smoothstep(1.0 - 1.5 / uRadius, 1.0, r);   // 1.5 px anti-aliased border
  outputColor = vec4(mix(inputColor.rgb, col, inside * uOpacity), inputColor.a);
}`;

export class LensEffect extends Effect {
  constructor() {
    super('LensEffect', lensFrag, {
      attributes: EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uCenter', new Uniform(new Vector2())], ['uRadius', new Uniform(100)], ['uZoom', new Uniform(2.2)],
        ['uRim', new Uniform(0.8)], ['uCA', new Uniform(0.35)], ['uFrost', new Uniform(0)],
        ['uOpacity', new Uniform(0)], ['uUseSharp', new Uniform(0)], ['uSharp', new Uniform(null)],
      ]),
    });
  }
  private u(name: string): Uniform { const x = this.uniforms.get(name); if (!x) throw new Error(name); return x; }
  /** cssX/cssY: lens centre relative to the canvas top-left; dpr: renderer pixel ratio. */
  place(cssX: number, cssY: number, cssRadius: number, cssHeight: number, dpr: number): void {
    (this.u('uCenter').value as Vector2).set(cssX * dpr, (cssHeight - cssY) * dpr);
    this.u('uRadius').value = cssRadius * dpr;
  }
  set opacity(v: number) { this.u('uOpacity').value = v; }
  set zoom(v: number) { this.u('uZoom').value = v; }
  set frost(v: number) { this.u('uFrost').value = v; }
  set sharp(t: Texture | null) { this.u('uSharp').value = t; this.u('uUseSharp').value = t ? 1 : 0; }
}
```

Including `<tonemapping_pars_fragment>` declares three's curves (`NeutralToneMapping`,
`AgXToneMapping`, ...) and the `toneMappingExposure` uniform, which the renderer fills from
`renderer.toneMappingExposure`. Do not put the lens in the same `EffectPass` as `ToneMappingEffect`,
which includes the same chunk.

### Same-frame sync with the DOM frame

The glass ring (border, shadow, handle) is a DOM element; the optics are in the shader. Drive both
from the same JavaScript value in the same frame, never from `getBoundingClientRect` after a CSS
transition, or the image lags the ring by a frame.

```ts
const lensPos = { x: 0, y: 0, goalX: 0, goalY: 0, r: 90, show: 0, goalShow: 0 };
export function updateLens(dt: number, effect: LensEffect, ring: HTMLElement, cssW: number, cssH: number, dpr: number): boolean {
  const k = 1 - Math.exp(-dt / 0.06);
  lensPos.x += (lensPos.goalX - lensPos.x) * k;
  lensPos.y += (lensPos.goalY - lensPos.y) * k;
  lensPos.show += (lensPos.goalShow - lensPos.show) * (1 - Math.exp(-dt / 0.09));
  effect.place(lensPos.x, lensPos.y, lensPos.r, cssH, dpr);
  effect.opacity = lensPos.show;
  ring.style.transform = `translate3d(${(lensPos.x - lensPos.r).toFixed(1)}px, ${(lensPos.y - lensPos.r).toFixed(1)}px, 0) scale(${(0.9 + 0.1 * lensPos.show).toFixed(3)})`;
  ring.style.opacity = lensPos.show.toFixed(3);
  return Math.abs(lensPos.goalX - lensPos.x) + Math.abs(lensPos.goalY - lensPos.y) + Math.abs(lensPos.goalShow - lensPos.show) > 0.01;
}
```

Offset the lens above the finger on touch (for example 70 CSS px up) so the finger does not cover
what is being magnified.

## 2. Sharp magnification: re-render the region

Resampling the final frame at 2.2x shows soft text and fat pixels. For reading, render the region
again at full detail with an off-axis sub-frustum of the main camera:

```ts
import { PerspectiveCamera, WebGLRenderTarget, HalfFloatType, type WebGLRenderer, type Scene } from 'three';

const lensCam = new PerspectiveCamera();
const lensTarget = new WebGLRenderTarget(512, 512, { type: HalfFloatType, samples: 4 });

export function renderSharpLens(renderer: WebGLRenderer, scene: Scene, main: PerspectiveCamera,
  cssW: number, cssH: number, cx: number, cy: number, cssRadius: number, zoom: number, dpr: number) {
  lensCam.copy(main, false);                             // fov, aspect, near, far; false = do not clone children
  main.updateMatrixWorld();
  main.matrixWorld.decompose(lensCam.position, lensCam.quaternion, lensCam.scale); // world pose: main sits in a rig
  const D = cssRadius * 2;
  lensCam.setViewOffset(cssW * zoom, cssH * zoom, cx * zoom - D / 2, cy * zoom - D / 2, D, D);
  lensCam.updateProjectionMatrix();
  const px = Math.min(1024, Math.ceil(D * dpr));         // device pixels across the lens
  if (lensTarget.width !== px) lensTarget.setSize(px, px);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(lensTarget);
  renderer.render(scene, lensCam);
  renderer.setRenderTarget(prev);
  return lensTarget.texture;                             // effect.sharp = texture
}
```

`setViewOffset(fullWidth, fullHeight, x, y, width, height)` renders the sub-rectangle `(x, y, w, h)`
(top-left origin) of a frustum `fullWidth x fullHeight`; with the full size scaled by `zoom`, the
sub-rectangle is the magnified lens view at the main camera's exact pose. Notes:
- `Object3D.copy(source, recursive = true)` clones children by default; copying a camera every
  frame without `false` leaks clones. The main camera lives inside the rig with a zero local
  position, so copy its world matrix, not its local transform.
- The re-render has no AO or bloom (it skips the composer). Inside a small lens this is rarely
  noticed; if it is, lower AO intensity for the main frame near the lens instead.
- Fat lines keep their CSS pixel width in the lens view, so they look thinner relative to the
  magnified content. That reads as "ink seen through glass" and is usually fine.
- Render it only while `lensPos.show > 0.01` and only when the lens or the scene moved.
- Rendering into a target uses linear colour and no renderer tone mapping, hence the explicit
  `NeutralToneMapping` call in the effect.

## 3. Choosing clear or frosted

| Mode | Settings | Use |
|---|---|---|
| Clear reading glass | `uZoom 2 to 2.5`, `uRim 0.8`, `uCA 0.3`, `uFrost 0`, sharp re-render on | reading terms |
| Frosted preview | `uZoom 1`, `uFrost 0.6 to 1`, `uRim 0.4` | hover hint, "look here" |
| Thick loupe | `uZoom 3`, `uRim 1`, `uCA 0.6` | showing fibres or tiny parts |

Keep chromatic aberration subtle; above 0.6 it reads as a cheap filter.

## 4. CSS glass capsules over the canvas

```css
.ink-toolbar {
  position: absolute; left: 50%; bottom: 20px; transform: translateX(-50%);
  display: flex; gap: 6px; padding: 6px 8px; border-radius: 999px;
  background: linear-gradient(180deg, rgba(255, 252, 245, 0.42), rgba(255, 248, 236, 0.22));
  border: 1px solid rgba(255, 255, 255, 0.45);
  box-shadow: 0 8px 30px rgba(40, 28, 16, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.6);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
  backdrop-filter: blur(14px) saturate(140%);
  pointer-events: auto;
}
.ink-overlay { position: absolute; inset: 0; pointer-events: none; }   /* container for rings and labels */
.ink-lens-ring {
  position: absolute; left: 0; top: 0; width: 180px; height: 180px; border-radius: 50%;
  box-shadow: 0 10px 28px rgba(30, 20, 10, 0.28), inset 0 0 0 2px rgba(255, 255, 255, 0.55),
    inset 0 0 0 5px rgba(40, 30, 20, 0.25);
  pointer-events: none; will-change: transform, opacity;
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .ink-toolbar { background: rgba(250, 246, 238, 0.94); }
}
@media (prefers-reduced-transparency: reduce) {
  .ink-toolbar { background: rgba(250, 246, 238, 0.96); backdrop-filter: none; -webkit-backdrop-filter: none; }
}
```

Facts and costs:
- `backdrop-filter` blurs whatever the compositor drew below, including the WebGL canvas, every
  frame the canvas changes. Keep glass surfaces small; a full-height glass sidebar over a 60 fps
  canvas can cost more than the bloom pass on a laptop GPU.
- The ring element is CSS only: the optical distortion comes from the shader, not from CSS.
- Buttons inside the toolbar receive pointer events, the overlay container does not; the canvas
  underneath still gets drags everywhere else.
- Match the glass tint to the paper and desk (warm), not to a generic cool UI grey.
- `prefers-reduced-transparency` is a Media Queries Level 5 feature; browsers without it ignore
  the block, so the fallback stays opt-in.

## Do

- Put the lens in its own `EffectPass` after SMAA; keep everything in device pixels.
- Drive DOM ring and shader uniforms from one value per frame.
- Use the sharp re-render for reading text; resample only for hints.
- Keep CSS glass small and warm.

## Don't

- Don't combine the lens with another convolution effect in one pass.
- Don't read the lens position back from the DOM.
- Don't tone map the sharp texture twice (the main pass never sees it; the lens effect maps it once).

## Pitfalls

- Oval lens: radius in UV units instead of device pixels.
- Lens image lags the ring: position read from layout after a transition.
- Lens content too bright or too flat: re-rendered texture not tone mapped, or mapped with a
  different curve than the main pipeline.
- Toolbar blocks page drags: `pointer-events: auto` on the overlay container instead of the toolbar.

## Self-check (APIs used, verified)

- pmndrs `Effect` constructor options (`attributes`, `blendFunction`, `uniforms`), `EffectAttribute.CONVOLUTION`, `BlendFunction.NORMAL`, effect uniforms `inputBuffer`, `resolution`, `mainImage` signature: postprocessing 6.39.6 `build/types/index.d.ts` (lines 4029 to 4342), `build/index.js` (`effect_default`)
- SMAA being `CONVOLUTION | DEPTH`: `build/index.js` (`SMAAEffect` constructor)
- `tonemapping_pars_fragment` defining `NeutralToneMapping` and `toneMappingExposure`: three r187 `src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js`; exposure uniform upload: `src/renderers/WebGLRenderer.js`
- `PerspectiveCamera.setViewOffset(fullWidth, fullHeight, x, y, width, height)`, `clearViewOffset`, `updateProjectionMatrix`, `copy(source, recursive)`: `src/cameras/PerspectiveCamera.js`; `Object3D.copy(source, recursive = true)`, `updateMatrixWorld`, `matrixWorld`: `src/core/Object3D.js`; `Matrix4.decompose`: `src/math/Matrix4.js`
- `WebGLRenderTarget` options (`type`, `samples`), `setSize`; `setRenderTarget`, `getRenderTarget`, `render`: `src/core/RenderTarget.js`, `src/renderers/WebGLRenderer.js`
- render target colour and tone mapping rules: `src/renderers/webgl/WebGLPrograms.js`
- `backdrop-filter`: MDN (checked 2026-11-22)
