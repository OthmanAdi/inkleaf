# three.js knowledge pack for inkleaf

Practical, source-verified notes for writing the inkleaf world in three.js: an open hardcover book on
a lit desk, diagrams printed on the page that peel up into hand-inked 3D models, energy shown as
glowing flows with travelling beads, a glass magnifier, page turns, soft window-light shadows, AO,
bloom, SMAA, vignette, tone mapping, procedural textures and procedural sound.

## Pinned stack

| Package | Version | Notes |
|---|---|---|
| three | 0.187.0 (r187) | WebGL2 only; `three/addons/*` maps to `examples/jsm/*` |
| @types/three | 0.187.0 | matches the runtime |
| postprocessing (pmndrs) | 6.39.6 | `EffectComposer`, `EffectPass`, `BloomEffect` (mipmap blur), `SMAAEffect`, `VignetteEffect`, `ToneMappingEffect`, custom `Effect` |
| n8ao | 2.1.0 | `N8AOPostPass` for pmndrs; ships no TypeScript types (shim in `postprocessing.md`) |
| vite | 8 | dev server and build |
| typescript | strict, `verbatimModuleSyntax`, `noUncheckedIndexedAccess` | snippets use `import type` and `!` where indexes are proven |

Every API name, constructor signature and constant in this pack was checked against the installed
sources of these exact versions. Each file ends with a self-check listing the source files.

## Which file answers which question

| Question | File |
|---|---|
| How do I create the renderer, pick tone mapping (Neutral vs AgX), set exposure, cap pixel ratio, resize, survive context loss? | [renderer-color-tone.md](renderer-color-tone.md) |
| Which light type, what intensity in metres and physical units, which shadow type in r187, how to fix acne, fit the shadow camera, make window cookies, contact shadows, coloured spill? | [lights-shadows.md](lights-shadows.md) |
| Which material, what forces recompiles, how to write a ShaderMaterial that tone maps, how to patch built-ins safely with `onBeforeCompile`, how to keep shadows in sync with vertex changes? | [materials-and-shader-patching.md](materials-and-shader-patching.md) |
| How do I draw constant-width ink lines, silhouettes, creases, cross-hatching from lighting, wobble, draw-on, and the printed-to-3D peel? | [npr-ink-hatching.md](npr-ink-hatching.md) |
| How is the post chain ordered, how do I configure N8AO, bloom only the glow, write a custom Effect, use MSAA targets and render-to-texture? | [postprocessing.md](postprocessing.md) |
| How do I generate page canvases with fonts, wood, linoleum, paper fibre, normal and roughness maps, with the right colour spaces and mipmaps? | [procedural-textures.md](procedural-textures.md) |
| How do I build geometry from arrays, deform a page (bend and turn) correctly, lathe props, run tubes and beads along curves, merge and bound geometry? | [geometry-and-deformation.md](geometry-and-deformation.md) |
| How do I animate without frame-rate dependence: damping, springs, easing, timelines, state machines, camera rigs, reduced motion? | [animation-and-motion.md](animation-and-motion.md) |
| How do I pick objects, hit-test canvas regions by UV, drag in a plane, handle wheel and touch, show cursors and place DOM labels? | [interaction-picking.md](interaction-picking.md) |
| How do I build the magnifier (refraction, chromatic aberration, frosted, sharp re-render) and CSS glass toolbars? | [glass-ui-and-lens.md](glass-ui-and-lens.md) |
| How do I synthesise page turns, pen scratch, thuds and clicks, unlock audio and mute? | [audio-webaudio.md](audio-webaudio.md) |
| How do I keep draw calls low, warm shaders, adapt quality from frame time, update shadows on demand, dispose? | [performance-and-quality.md](performance-and-quality.md) |
| How do I expose a debug handle, inspect tagged objects, dump the scene, capture shaders, run Playwright on SwiftShader and on the GPU, and make screenshots deterministic? | [debugging-and-testing.md](debugging-and-testing.md) |
| Where are the official docs, examples, library docs and curated references? | [resources.md](resources.md) |

## Ten rules that prevent most bugs in this project

1. One tone mapping, in one place. With the pmndrs composer: renderer `NoToneMapping`,
   `ToneMappingEffect` after bloom, exposure via `renderer.toneMappingExposure`. Neutral keeps paper
   white; AgX is kinder to strong glow.
2. Colour textures `SRGBColorSpace`, data textures `NoColorSpace`, colours picked in sRGB.
3. Units are metres; light intensities follow `I = PI * E * d^2 / albedo` for point and spot lights.
4. `PCFShadowMap` with `radius` for soft shadows (`PCFSoftShadowMap` is deprecated since r186);
   thin sheets need `shadowSide`; fit shadow cameras tightly; update shadows only when needed.
5. Patch built-in materials with guarded anchors and a `customProgramCacheKey`; mirror vertex
   changes into `customDepthMaterial`; per-object uniforms need per-object material instances.
6. Interactive deformation on the CPU (raycasts see it); decorative deformation in shaders.
7. Every motion uses `dt` with time constants or springs; nothing uses per-frame lerp factors.
8. Render on demand; the frame loop returns early when nothing moves.
9. Warm every shader variant behind the loading cover; never change light counts, `castShadow`,
   defines or N8AO quality during interaction.
10. Every object gets an id, label and tags; the debug handle can find, dump, step and screenshot it.

## r187 facts that contradict older tutorials

- `PCFSoftShadowMap` is deprecated since r186 and replaced at render time by `PCFShadowMap`, which
  now uses hardware depth compare with 5 Vogel-disk taps rotated by interleaved gradient noise;
  softness comes from `shadow.radius` (texels).
- `Clock` is deprecated since r183; use `Timer` (`timer.connect(document)`, `timer.update(t)`,
  `getDelta()`).
- `WebGLRenderer` has `outputBufferType` and `setEffects()` for three's own post chain; do not mix it
  with the pmndrs composer.
- `SpotLight.map` multiplies the light colour by the texture RGB, needs `castShadow = true`, and
  ignores `texture.offset/repeat` (raw projected coordinates).
- Legacy lighting is gone: ambient and hemisphere lights need intensities around `PI` times what
  old examples used to reach the same brightness.
- Renderer tone mapping applies only when rendering to the screen (null render target).
- `onBeforeCompile` runs per material per program variant; the default cache key is the callback's
  source text.
- `MeshLambertMaterial` shades per fragment and supports normal and bump maps, so it is a good
  paper material.

## Conventions used in snippets

- Scene scale: 1 unit = 1 m. Book about 0.42 x 0.28 open, page 0.21 x 0.28, lamp about 0.55 m from
  the page, camera about 0.6 m from the spread.
- Page coordinates: spine on the local z axis, a resting right page extends to +x, page up is +y.
- Ids: `page.03.diagram.heat`, `light.lamp`, `flow.lamp-to-page`, `fx.bloom`. Tags: `diagram`,
  `ink`, `glow`, `interactive`, `castsShadow`.
- Colours in sRGB hex in code, converted once (`new Color(0x1d1b22)`); arrays of bytes in textures
  are sRGB for colour maps.
- Imports: values from `'three'`, addons from `'three/addons/...'`, types with `import type`.

## One frame of an inkleaf world, in order

```ts
renderer.setAnimationLoop((t: number) => {
  timer.update(t);
  const dt = Math.min(timer.getDelta(), 1 / 20);       // animation-and-motion.md
  size.apply();                                         // renderer-color-tone.md (resize inside the frame)
  const p = pickOncePerFrame();                         // interaction-picking.md (proxies, UV regions)
  let moving = input.update(p, dt);                     // drags, wheel, lens goal
  moving = pages.update(dt) || moving;                  // geometry-and-deformation.md (CPU page bend)
  moving = diagrams.update(dt, motion.reduced) || moving; // npr-ink-hatching.md (peel matrix, draw-on)
  moving = flows.update(dt) || moving;                  // beads, spill uniforms (lights-shadows.md)
  moving = rig.update(dt) || moving;                    // camera rig
  moving = updateLens(dt, lens, ring, w, h, dpr) || moving; // glass-ui-and-lens.md
  if (moving) renderer.shadowMap.needsUpdate = true;    // lights-shadows.md (on-demand shadows)
  if (!moving && !dirty) return;                        // render on demand
  dirty = false;
  composer.render(dt);                                  // postprocessing.md
  quality.sample(dt, !input.busy);                      // performance-and-quality.md
});
```

Sound is triggered from state transitions inside those updaters (`audio-webaudio.md`), and the
debug handle's `step(dt)` runs the same body with a fixed `dt` (`debugging-and-testing.md`).

## How to verify an API before you use it

```sh
# in the product folder
grep -n "setViewOffset" node_modules/three/src/cameras/PerspectiveCamera.js
grep -n "export class BloomEffect" -A 20 node_modules/postprocessing/build/types/index.d.ts
grep -n "configuration = new Proxy" -A 25 node_modules/n8ao/src/N8AOPostPass.js
```

If a tutorial or a model's memory disagrees with these files, the files win. When you upgrade any
pinned package, re-run these checks for every API listed in the self-check sections and update the
files that changed; the unit test for shader anchors in `debugging-and-testing.md` catches the
riskiest breakage (moved `#include` anchors) automatically.

## Glossary

| Term | Meaning here |
|---|---|
| peel | continuous 0..1 value from printed (flat, oblique) to popped (3D) |
| print / printed | the flat oblique drawing of a model on the page |
| ink | dark line and hatch colour, screen-constant width |
| spill | coloured light from a glowing flow tinting the paper |
| proxy | invisible simplified mesh used only for picking |
| tier | device quality class (low, mid, high) chosen at start and refined by frame time |
| boil | stepped re-randomisation of line wobble at a few steps per second |
| cookie (gobo) | texture projected by a spot light, here a window frame |

## Self-check (APIs named in this index, verified in installed sources)

- `NoToneMapping`, `NeutralToneMapping`, `AgXToneMapping`, `PCFShadowMap`, `PCFSoftShadowMap` (deprecated r186), `SRGBColorSpace`, `NoColorSpace`: three r187 `src/constants.js`
- `WebGLRenderer.toneMappingExposure`, `outputBufferType`, `setEffects`, tone mapping only to null target: `src/renderers/WebGLRenderer.js`, `src/renderers/webgl/WebGLPrograms.js`
- PCF Vogel disk and interleaved gradient noise: `src/renderers/shaders/ShaderChunk/shadowmap_pars_fragment.glsl.js`; removal warning: `src/renderers/webgl/WebGLShadowMap.js`
- `Timer`, `Clock` deprecation: `src/core/Timer.js`, `src/core/Clock.js`
- `SpotLight.map` behaviour: `src/lights/SpotLight.js`, `ShaderChunk/lights_fragment_begin.glsl.js`
- `onBeforeCompile` per material, default `customProgramCacheKey`: `src/materials/Material.js`, `src/renderers/WebGLRenderer.js`
- `MeshLambertMaterial` maps: `src/materials/MeshLambertMaterial.js`, `ShaderLib/meshlambert.glsl.js`
- `ToneMappingEffect`, `BloomEffect`, `EffectComposer`: postprocessing 6.39.6 `build/types/index.d.ts`
- `N8AOPostPass` configuration proxy: n8ao 2.1.0 `src/N8AOPostPass.js`
- `PerspectiveCamera.setViewOffset`: `src/cameras/PerspectiveCamera.js`
