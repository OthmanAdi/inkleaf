# Materials and shader patching (r187)

Goal: get the paper, ink, wood and glass looks with built-in materials where possible, and patch
them surgically when you need one extra term. Write a full `ShaderMaterial` only when the lighting
model itself is different.

## 1. Which material

| Need | Material | Why |
|---|---|---|
| Ink lines, glow cores, UI-in-scene | `MeshBasicMaterial` / `LineMaterial` | unlit, cheapest |
| Paper pages, card, matte props | `MeshLambertMaterial` | per-fragment Lambert, shadows, normal/bump maps, cheap |
| Desk wood, book cloth, metal parts | `MeshStandardMaterial` | roughness/metalness, environment reflections |
| Varnished desk, cloth sheen, glass, foil | `MeshPhysicalMaterial` | clearcoat, sheen, transmission, iridescence, anisotropy |
| Banded cartoon shading | `MeshToonMaterial` | `gradientMap` (needs `NearestFilter` on the ramp) |
| Shadow only on an invisible plane | `ShadowMaterial` | `color`, `opacity`, transparent by default |
| Fully custom lighting | `ShaderMaterial` | three adds uniforms, attributes, `#version 300 es` |
| Nothing added at all | `RawShaderMaterial` | you write every declaration |

`MeshPhysicalMaterial.transmission > 0` triggers an extra opaque render into a transmission target
every frame. Scale it with `renderer.transmissionResolutionScale` (0.5 is usually fine) or use the
post-pass lens from `glass-ui-and-lens.md` for a magnifier instead.

## 2. Property names that exist (r187)

- Common (`Material`): `side, transparent, opacity, depthTest, depthWrite, blending, alphaTest,
  alphaHash, alphaToCoverage, polygonOffset, polygonOffsetFactor, polygonOffsetUnits, dithering,
  toneMapped, vertexColors, shadowSide, forceSinglePass, premultipliedAlpha, colorWrite, visible,
  userData, needsUpdate (setter)`.
- `MeshLambertMaterial`: `color, map, lightMap, aoMap, aoMapIntensity, emissive, emissiveIntensity,
  emissiveMap, bumpMap, bumpScale, normalMap, normalMapType, normalScale, displacementMap,
  specularMap, alphaMap, envMap, reflectivity, flatShading, fog, wireframe`.
- `MeshStandardMaterial`: Lambert set minus specular/combine, plus `roughness, metalness,
  roughnessMap, metalnessMap, envMapIntensity, envMapRotation`.
- `MeshPhysicalMaterial` adds `clearcoat, clearcoatRoughness, clearcoatNormalMap, sheen, sheenColor,
  sheenRoughness, transmission, thickness, attenuationColor, attenuationDistance, ior, iridescence,
  iridescenceIOR, iridescenceThicknessRange, anisotropy, anisotropyRotation, specularIntensity,
  specularColor, dispersion, diffuseRoughness, retroreflectivity`.

`MeshPhysicalMaterial.anisotropy` is specular stretching (brushed metal). Texture filtering
anisotropy is `texture.anisotropy`. Different things with the same word.

A good paper: `MeshLambertMaterial({ color: PAPER, map: pageCanvasTexture, bumpMap: fibreHeight,
bumpScale: 0.6 })`. A good desk: `MeshPhysicalMaterial({ map: woodColor, roughnessMap: woodRough,
normalMap: woodNormal, roughness: 1, clearcoat: 0.35, clearcoatRoughness: 0.25 })`; maps multiply
the scalar, so leave `roughness: 1` when a roughness map carries the values.

## 3. What forces a recompile

A recompile takes tens to hundreds of milliseconds and stalls the frame. Triggers include: changing
`defines`; setting a map that was `null` (set `material.needsUpdate = true` after); `flatShading`;
`vertexColors`; `side`; `transparent`; `alphaTest` crossing 0; `fog` on the scene; the number of
lights or shadow-casting lights; `shadowMap.type`; renderer tone mapping when rendering to screen.
Plan states so the expensive switches happen once, behind a loading screen, and warm them with
`compileAsync` (see `performance-and-quality.md`).

## 4. ShaderMaterial skeleton that behaves like a built-in

```ts
import { ShaderMaterial, Color, type IUniform } from 'three';

export const sharedTime: IUniform<number> = { value: 0 };     // one object, many materials

export function makeGlowMaterial(color: Color): ShaderMaterial {
  return new ShaderMaterial({
    name: 'ink.glowCore',
    uniforms: { uTime: sharedTime, uColor: { value: color }, uStrength: { value: 6 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec2 vUv;
      void main() {
        float pulse = 0.75 + 0.25 * sin(uTime * 6.0 - vUv.x * 18.0);
        gl_FragColor = vec4(uColor * uStrength * pulse, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    toneMapped: true,
  });
}
```

What three adds to a `ShaderMaterial` (verified in `WebGLProgram.js`): `#version 300 es`, the
attribute and uniform declarations (`position, normal, uv, modelMatrix, modelViewMatrix,
projectionMatrix, viewMatrix, normalMatrix, cameraPosition, isOrthographic`), `attribute`/`varying`/
`texture2D` compatibility defines, and `gl_FragColor` mapped to an `out` variable unless you set
`glslVersion: GLSL3` (then declare your own `out vec4`). `RawShaderMaterial` gets only your defines
and, if `glslVersion` is set, the `#version` line; declare precision and everything else yourself.

Uniform rules:
- Value types map directly: `number`, `Vector2/3/4`, `Color` (vec3), `Matrix3/4`, `Texture`
  (sampler2D), arrays of these, `Float32Array` for float arrays.
- Mutate `.value` in place (`u.value.set(...)`, `u.value = 2`). Replacing the whole uniform object
  after the first compile disconnects it from the program's uniform list.
- Share one uniform object between materials for global values (time, light level, paper colour).
- `defines` changes need `material.needsUpdate = true` and recompile; use them for compile-time
  switches, uniforms for anything animated.

## 5. Patching built-in materials with `onBeforeCompile`

How it works in r187 (`WebGLRenderer.getProgram`): for each material and each program variant
(shadow on/off, fog, light counts, instancing and so on), three clones the material's uniform set,
calls `material.onBeforeCompile(parameters, renderer)` once, then looks up or compiles the program
by cache key. `parameters` has `vertexShader`, `fragmentShader`, `uniforms`, `defines` (the
material's own object) and more. The default `customProgramCacheKey()` returns
`this.onBeforeCompile.toString()`.

Consequences:
1. The callback may run several times per material (once per variant). Make it idempotent and keep
   uniform objects outside it.
2. Two materials whose callbacks have identical source text share programs even if their closures
   capture different strings. Never bake per-material values into the GLSL text; use uniforms, or
   return a distinct `customProgramCacheKey`.
3. Replacing an anchor that is not there is silent. Guard it.

```ts
import type { Material, IUniform } from 'three';

type Stage = 'vertexShader' | 'fragmentShader';
export interface Injection { stage: Stage; anchor: string; code: string; where: 'before' | 'after' | 'replace' }

export function inject(shader: Record<Stage, string>, list: readonly Injection[]): void {
  for (const i of list) {
    const src = shader[i.stage];
    if (!src.includes(i.anchor)) throw new Error(`[patch] anchor "${i.anchor}" missing in ${i.stage}`);
    const out = i.where === 'replace' ? i.code
      : i.where === 'before' ? `${i.code}\n${i.anchor}` : `${i.anchor}\n${i.code}`;
    shader[i.stage] = src.replace(i.anchor, () => out);   // function form: no "$&" surprises
  }
}

export function patchMaterial<M extends Material>(
  material: M, cacheKey: string, uniforms: Record<string, IUniform>, list: readonly Injection[],
): M {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    inject(shader, list);
  };
  material.customProgramCacheKey = () => cacheKey;   // must change whenever `list` changes
  material.needsUpdate = true;
  return material;
}
```

Stable anchors in r187 (present in Lambert, Standard, Physical, Phong, Toon unless noted):
- vertex: `#include <common>` (declarations), `#include <beginnormal_vertex>` (defines
  `objectNormal`), `#include <begin_vertex>` (defines `transformed`), `#include <project_vertex>`
  (defines `mvPosition`, writes `gl_Position`), `#include <worldpos_vertex>`.
- fragment: `#include <common>`, `#include <map_fragment>` (writes `diffuseColor`),
  `#include <emissivemap_fragment>` (writes `totalEmissiveRadiance`), `#include <lights_fragment_end>`
  (lighting done, `reflectedLight` filled), `#include <aomap_fragment>`, `#include <opaque_fragment>`
  (writes `gl_FragColor` from `outgoingLight` and `diffuseColor.a`), `#include <tonemapping_fragment>`,
  `#include <colorspace_fragment>`.

`worldPosition` from `worldpos_vertex` is declared only when env maps, shadow maps, transmission or
spot light maps are active. Compute your own world position so the patch works in every variant.

### Example: world position varying plus a page bend in the vertex stage

```ts
import { MeshLambertMaterial, type IUniform } from 'three';

export const bend: Record<string, IUniform> = {
  uBendAngle: { value: 0 },      // radians the free edge has turned about the spine
  uBendLag: { value: 0.35 },     // how much the free edge trails (0 = rigid)
  uPageWidth: { value: 0.21 },
};

const VERT_DECL = /* glsl */ `
uniform float uBendAngle; uniform float uBendLag; uniform float uPageWidth;
varying vec3 vInkWorld;
vec3 bendPage(vec3 p, out vec3 n) {
  // page lies in the XZ plane, spine on x = 0, page extends to +x; local y is up
  float s = clamp(p.x / uPageWidth, 0.0, 1.0);
  float a = uBendAngle - uBendLag * sin(uBendAngle) * s * s;   // free edge lags mid-turn
  // closed form of the arc for a linearly varying angle would need Fresnel integrals; a small
  // fixed-step integral keeps arc length exact enough for 0.21 m pages
  float x = 0.0, y = 0.0, ds = p.x / 8.0;
  for (int k = 0; k < 8; k++) {
    float sk = (float(k) + 0.5) / 8.0 * s;
    float ak = uBendAngle - uBendLag * sin(uBendAngle) * sk * sk;
    x += cos(ak) * ds; y += sin(ak) * ds;
  }
  n = vec3(-sin(a), cos(a), 0.0);
  return vec3(x, y, p.z) + n * p.y;   // p.y (sheet thickness offset) follows the bent normal
}`;

export function bendingPaper(color: number): MeshLambertMaterial {
  return patchMaterial(new MeshLambertMaterial({ color }), 'paper.bend.v1', bend, [
    { stage: 'vertexShader', anchor: '#include <common>', where: 'after', code: VERT_DECL },
    { stage: 'vertexShader', anchor: '#include <beginnormal_vertex>', where: 'after',
      code: 'vec3 inkBentN; bendPage(position, inkBentN); objectNormal = inkBentN;' },
    { stage: 'vertexShader', anchor: '#include <begin_vertex>', where: 'after',
      code: 'vec3 inkN2; transformed = bendPage(position, inkN2);' },
    { stage: 'vertexShader', anchor: '#include <project_vertex>', where: 'after', code: /* glsl */ `
      vec4 inkW = vec4(transformed, 1.0);
      #ifdef USE_BATCHING
        inkW = batchingMatrix * inkW;
      #endif
      #ifdef USE_INSTANCING
        inkW = instanceMatrix * inkW;
      #endif
      vInkWorld = (modelMatrix * inkW).xyz;` },
    { stage: 'fragmentShader', anchor: '#include <common>', where: 'after', code: 'varying vec3 vInkWorld;' },
  ]);
}
```

GPU bending is fast but the CPU does not see it: raycasts, bounding spheres and CPU-side line
extraction use the undeformed geometry. For interactive pages, prefer the CPU deformation in
`geometry-and-deformation.md` and keep the shader version for decorative pages.

## 6. Custom depth materials (shadows of deformed or cut-out geometry)

The shadow pass draws each caster with a depth material, not with its own material. Vertex changes
made in `onBeforeCompile` are therefore missing from the shadow unless you give the mesh a matching
depth material:

```ts
import { MeshDepthMaterial, MeshDistanceMaterial, type Mesh } from 'three';

export function matchShadowDeformation(mesh: Mesh, uniforms: Record<string, IUniform>, list: readonly Injection[], key: string) {
  const vertexOnly = list.filter((i) => i.stage === 'vertexShader');
  mesh.customDepthMaterial = patchMaterial(new MeshDepthMaterial(), `${key}.depth`, uniforms, vertexOnly);
  mesh.customDistanceMaterial = patchMaterial(new MeshDistanceMaterial(), `${key}.distance`, uniforms, vertexOnly); // point lights only
}
```

Notes from `WebGLShadowMap.js`:
- In r187 PCF and Basic shadows render into a native depth texture, so the depth material's colour
  output and `depthPacking` do not matter. Old snippets with `RGBADepthPacking` still work.
- `customDistanceMaterial` is used for point lights, `customDepthMaterial` for all others.
- The renderer overrides the depth material's `side` from `material.shadowSide` or the flipped
  `side`, and copies `map`, `alphaMap`, `alphaTest`, clipping and `displacementMap` settings for the
  built-in depth material. Cut-out paper with `alphaTest > 0` therefore shadows correctly without a
  custom material.
- If your fragment shader discards pixels (a dissolving print, a torn edge), the depth material must
  discard the same pixels or the shadow keeps the full shape.

N8AO reads the depth buffer of the main render, so vertex deformation shows up in AO automatically.

## 7. Transparency, layering and decals

- Coplanar print on a page (a diagram plane 0.0002 above the paper): use `polygonOffset: true,
  polygonOffsetFactor: -1, polygonOffsetUnits: -1` on the decal instead of a visible gap.
- Glows and light pools: `transparent: true, depthWrite: false, blending: AdditiveBlending`. Additive
  ignores order; normal-blended transparents need `renderOrder` when sorting by distance fails.
- Ink fills behind lines: give fills `polygonOffset: true, polygonOffsetFactor: 1,
  polygonOffsetUnits: 1` so lines drawn on their edges win the depth test.
- `alphaHash: true` gives order-independent stochastic transparency (noisy, pairs with AO and SMAA
  poorly); prefer `alphaTest` for paper cut-outs.
- `dithering: true` on large smooth gradients (desk falloff, vignette-like lighting) hides 8-bit
  banding when the frame is not rendered in half float.

## Do

- Start from a built-in material; patch one term; keep a `customProgramCacheKey` per variant.
- Guard every anchor; fail loudly on upgrades.
- Mirror vertex patches into `customDepthMaterial`.
- Share uniform objects for global animated values.

## Don't

- Don't create uniforms inside `onBeforeCompile` per call if other code holds the old object.
- Don't use `String.replace(anchor, codeString)` with arbitrary code; use the function form.
- Don't animate `defines`.
- Don't rely on `worldPosition` from three's chunks.

## Pitfalls

- Patch works for one mesh, breaks for its clone with another setting: identical callback text,
  shared program, different intent. Fix the cache key.
- Shader compiles, effect missing: the anchor exists twice and the first one was replaced (for
  example `#include <common>` appears once per stage; check you targeted the right stage).
- Shadow of a bent page is flat: no `customDepthMaterial`.
- A patched material's clone renders unpatched: `Material.copy` does not copy `onBeforeCompile`;
  re-apply the patch (and cache key) after `clone()`.
- Per-object uniform values leak between meshes that share one material: the renderer uploads a
  material's uniforms when the material changes between draws, not per object. Use one material
  instance per object (programs are still shared) or, for `ShaderMaterial`, set
  `uniformsNeedUpdate = true` in the object's `onBeforeRender`.
- Material turns black after adding a texture at runtime: `needsUpdate` not set, or the texture is
  not uploaded yet and has no image.

## Self-check (APIs used, verified in three r187 source)

- `Material` properties, `onBeforeCompile`, `customProgramCacheKey` default, `needsUpdate` setter: `src/materials/Material.js`
- material property lists: `src/materials/MeshLambertMaterial.js`, `MeshStandardMaterial.js`, `MeshPhysicalMaterial.js`, `MeshBasicMaterial.js`, `MeshToonMaterial.js`, `ShadowMaterial.js`, `MeshDepthMaterial.js`, `MeshDistanceMaterial.js`
- `ShaderMaterial` fields (`uniforms, defines, glslVersion, uniformsNeedUpdate`): `src/materials/ShaderMaterial.js`; `RawShaderMaterial.js`
- prefix and `#version` handling, `GLSL3`: `src/renderers/webgl/WebGLProgram.js` (lines 396 to 795), `src/constants.js`
- `onBeforeCompile` call site and per-material program map: `src/renderers/WebGLRenderer.js` (around lines 2235 to 2279)
- cache key composition including `customProgramCacheKey`: `src/renderers/webgl/WebGLPrograms.js`
- anchors and variables: `src/renderers/shaders/ShaderLib/meshlambert.glsl.js`, `ShaderChunk/begin_vertex`, `project_vertex`, `worldpos_vertex`, `beginnormal_vertex`, `opaque_fragment`, `tonemapping_fragment`, `colorspace_fragment`
- custom depth/distance material selection and `side` override: `src/renderers/webgl/WebGLShadowMap.js` (`getDepthMaterial`)
- `transmissionResolutionScale`; uniform upload only on material change (`refreshMaterial`) and `uniformsNeedUpdate` for ShaderMaterial (around lines 2582 to 2824): `src/renderers/WebGLRenderer.js`
- `Material.copy` field list (no `onBeforeCompile`): `src/materials/Material.js`
- `AdditiveBlending`, `DoubleSide`: `src/constants.js`; `IUniform` type: `@types/three` 0.187.0
