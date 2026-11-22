# Resources (curated, link-checked 2026-11-22)

Every URL below answered HTTP 200 to a scripted GET on 2026-11-22 unless marked otherwise.
Manual pages use hash URLs (`/manual/#en/<slug>`); the slugs were checked against
`https://threejs.org/manual/list.json` on the same day. Prefer the installed source over any web
page when they disagree: `node_modules/three/src` and `examples/jsm` are r187 exactly; the website
tracks the latest release.

## If you only open five links

1. https://threejs.org/manual/#en/color-management: the linear workflow every other file assumes.
2. https://github.com/pmndrs/postprocessing/wiki/Custom-Effects: how effects merge and what a
   custom effect may declare.
3. https://github.com/N8python/n8ao: AO radius, falloff, quality modes and the pmndrs pass.
4. https://threejs.org/examples/webgl_lines_fat.html: the fat line classes behind all ink.
5. https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices: autoplay and
   parameter automation rules for the sound layer.

## three.js reference (API pages for classes used in this pack)

| Page | Use it for |
|---|---|
| https://threejs.org/docs/pages/WebGLRenderer.html | renderer options, tone mapping, `compileAsync`, `setEffects` |
| https://threejs.org/docs/pages/LightShadow.html | `bias`, `normalBias`, `radius`, `intensity`, update flags |
| https://threejs.org/docs/pages/SpotLight.html | cone, penumbra, `map` cookie, `power` |
| https://threejs.org/docs/pages/Material.html | `onBeforeCompile`, `customProgramCacheKey`, blending, `shadowSide` |
| https://threejs.org/docs/pages/Raycaster.html | picking, layers, `params` |
| https://threejs.org/docs/pages/InstancedMesh.html | beads and bubbles |
| https://threejs.org/docs/pages/CanvasTexture.html | page art and labels |
| https://threejs.org/docs/pages/DataTexture.html | procedural surfaces |
| https://threejs.org/docs/pages/WebGLRenderTarget.html | insets, lens re-render, MSAA targets |
| https://threejs.org/docs/pages/TubeGeometry.html | energy flow tubes |
| https://threejs.org/docs/pages/EdgesGeometry.html | crease lines |
| https://threejs.org/docs/pages/LineMaterial.html | fat screen-space lines |
| https://threejs.org/docs/pages/MathUtils.html | `damp`, `smoothstep`, `seededRandom` |
| https://threejs.org/docs/pages/Timer.html | frame timing (replaces the deprecated `Clock`) |
| https://threejs.org/docs/pages/OrbitControls.html | if you use it: note its frame-dependent damping |

## three.js manual (concepts)

| Page | Topic |
|---|---|
| https://threejs.org/manual/#en/color-management | linear workflow, colour spaces of textures and colours |
| https://threejs.org/manual/#en/how-to-update-things | when `needsUpdate` is required |
| https://threejs.org/manual/#en/how-to-dispose-of-objects | what `dispose()` frees |
| https://threejs.org/manual/#en/how-to-use-post-processing | three's own composer (inkleaf uses pmndrs instead) |
| https://threejs.org/manual/#en/responsive | canvas sizing and pixel ratio |
| https://threejs.org/manual/#en/shadows | shadow camera fitting with helpers |
| https://threejs.org/manual/#en/rendertargets | render-to-texture |
| https://threejs.org/manual/#en/custom-buffergeometry | building geometry from arrays |
| https://threejs.org/manual/#en/rendering-on-demand | invalidate-driven loops |
| https://threejs.org/manual/#en/debugging-glsl | shader debugging approaches |
| https://threejs.org/manual/#en/tips | screenshots, `preserveDrawingBuffer`, transparent canvas |
| https://threejs.org/manual/#en/optimize-lots-of-objects | merging for draw calls |
| https://threejs.org/manual/#en/picking | GPU and CPU picking |
| https://threejs.org/manual/#en/align-html-elements-to-3d | DOM labels over 3D |
| https://threejs.org/manual/#en/canvas-textures | dynamic canvas textures |
| https://threejs.org/manual/#en/transparency | sorting and transparent objects |
| https://threejs.org/manual/#en/material-table | which material supports which feature |

## three.js examples worth reading for inkleaf

| Example | What to take from it |
|---|---|
| https://threejs.org/examples/webgl_lines_fat.html | `Line2`/`LineMaterial` setup, world vs pixel width |
| https://threejs.org/examples/webgl_lines_fat_raycasting.html | picking fat lines with `params.Line2` |
| https://threejs.org/examples/webgl_lines_dashed.html | dash parameters (basis of the draw-on trick) |
| https://threejs.org/examples/webgl_materials_modified.html | minimal `onBeforeCompile` vertex patch |
| https://threejs.org/examples/webgl_lights_spotlight.html | spot light cone, penumbra and a projected `map` |
| https://threejs.org/examples/webgl_lights_spotlights.html | several animated spot lights and their shadows |
| https://threejs.org/examples/webgl_shadowmap_vsm.html | VSM radius and blur samples |
| https://threejs.org/examples/webgl_shadowmap_pcss.html | soft contact-hardening shadows via shader patching |
| https://threejs.org/examples/webgl_shadow_contact.html | depth-from-below contact shadow |
| https://threejs.org/examples/webgl_tonemapping.html | compare AgX, Neutral, ACES on the same scene |
| https://threejs.org/examples/webgl_materials_toon.html | stepped shading with gradient maps |
| https://threejs.org/examples/webgl_postprocessing_outline.html | three's selection outline pass (for comparison with ink hulls) |
| https://threejs.org/examples/webgl_postprocessing_unreal_bloom_selective.html | selective bloom by layers in three's composer |
| https://threejs.org/examples/webgl_postprocessing_smaa.html | SMAA quality reference |
| https://threejs.org/examples/webgl_postprocessing_sao.html | screen-space AO parameters (compare with N8AO) |
| https://threejs.org/examples/webgl_instancing_performance.html | instancing vs merging vs naive cost |
| https://threejs.org/examples/webgl_buffergeometry_drawrange.html | growing geometry with `setDrawRange` |
| https://threejs.org/examples/webgl_materials_texture_canvas.html | drawing into a canvas texture interactively |
| https://threejs.org/examples/webgl_interactive_cubes.html | basic raycast hover |
| https://threejs.org/examples/css2d_label.html | `CSS2DRenderer` labels |
| https://github.com/mrdoob/three.js/tree/dev/examples/jsm/lines | source of the fat line classes |

## Post-processing and AO

| Link | Use |
|---|---|
| https://github.com/pmndrs/postprocessing | library source, README (colour space and tone mapping rules) |
| https://pmndrs.github.io/postprocessing/public/docs/ | API docs (class pages, for example `Effect`) |
| https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/Effect.js~Effect.html | `Effect` constructor and lifecycle |
| https://pmndrs.github.io/postprocessing/public/demo/ | live demos of every effect, tweakable |
| https://github.com/pmndrs/postprocessing/wiki/Custom-Effects | `mainImage`/`mainUv` signatures, attributes, uniforms |
| https://github.com/N8python/n8ao | N8AO README: configuration, quality modes, pmndrs usage |
| https://github.com/N8python/n8ao/tree/master/example | example source (the hosted example page did not answer the scripted check) |
| https://github.com/KhronosGroup/ToneMapping/tree/main/PBR_Neutral | specification of the Neutral tone curve |

## Web platform

| Link | Use |
|---|---|
| https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API | Web Audio overview and interfaces |
| https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices | autoplay policy, parameter automation |
| https://developer.mozilla.org/en-US/docs/Web/API/AudioParam/exponentialRampToValueAtTime | positive targets only |
| https://developer.mozilla.org/en-US/docs/Web/API/AudioParam/setTargetAtTime | exponential approach for continuous control |
| https://developer.mozilla.org/en-US/docs/Web/API/BiquadFilterNode | filter types for noise shaping |
| https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext | rendering sounds for tests |
| https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices | GPU-side performance rules |
| https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextlost_event | context loss handling |
| https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture | drags that leave the canvas |
| https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/load | waiting for fonts before canvas text |
| https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter | glass toolbars |
| https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion | reduced motion |
| https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-transparency | reduced transparency fallback |
| https://registry.khronos.org/webgl/extensions/KHR_parallel_shader_compile/ | what `compileAsync` relies on |
| https://registry.khronos.org/webgl/extensions/WEBGL_debug_renderer_info/ | identifying SwiftShader vs GPU in tests |
| https://webgl2fundamentals.org/ | WebGL2 fundamentals when three's abstractions leak |
| https://playwright.dev/docs/test-snapshots | `toHaveScreenshot` baselines and tolerances |
| https://playwright.dev/docs/api/class-page#page-screenshot | page screenshot options |

## From Ahmad's saved-resource library (shader, NPR and effect references)

Selected from his saved shader, effect-studio, 3D and UI collections for relevance to an inked
pop-up book. Treat them as references for looks and techniques; check licences before reusing
any code, and check API versions (several target WebGPU, TSL or React Three Fiber, not WebGL2).

| Link | Why it is here |
|---|---|
| https://thebookofshaders.com/ | fragment shader basics: line patterns, shapes, noise; the foundation of hatching and paper grain |
| https://lygia.xyz/ | LYGIA, a large library of reusable shader functions (noise, SDFs, colour, blending) in GLSL and other languages |
| https://github.com/glslify/glslify | module system for GLSL; useful idea for organising shader chunks even when Vite imports raw strings |
| https://shaders.paper.design/ | curated canvas shaders including halftone, dithering, grain and paper-like textures; look reference for print effects |
| https://eng.basement.studio/tools/shader-lab | browser layer editor for shader compositions; quick way to explore post looks before coding them |
| https://docs.shaderpark.com/ | live-coded SDF shapes; prototype pop-up part silhouettes before modelling |
| https://github.com/codrops/RainEffect | WebGL droplet refraction; reference for the lens rim refraction idea |
| https://github.com/scottstts/Threejs-Awesome-Graphics-Agent-Skills | agent skill pack with shader, post-processing and material examples to compare against |
| https://github.com/cloudai-x/threejs-skills | agent skills for three.js and R3F APIs, including a shaders skill; cross-check against r187 |
| https://threeui.com/browse | catalogue of three.js components and shaders; visual reference, licence varies per item |
| https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language | TSL reference, for a future WebGPU port of these techniques (not used with the WebGL2 stack) |
| https://tympanus.net/codrops/2026/04/24/susurrus-crafting-a-cozy-watercolor-world-with-three-js-and-shaders/ | three.js watercolour world with a Kuwahara post shader; painterly NPR adjacent to ink. Returned HTTP 403 to the scripted check (bot protection); open in a browser |

## How this list was checked

- Status codes from `Invoke-WebRequest` GET requests with a browser user agent on 2026-11-22.
- Hash-routed manual pages always return the manual shell; their slugs were confirmed in
  `manual/list.json`.
- A 200 response proves reachability, not content accuracy. API facts in this pack come from the
  installed packages (three 0.187.0, postprocessing 6.39.6, n8ao 2.1.0), not from these pages.

## Self-check

- No three.js API is introduced in this file. Every API named in the tables is defined and verified
  in the topic file that uses it (see their self-check sections).
