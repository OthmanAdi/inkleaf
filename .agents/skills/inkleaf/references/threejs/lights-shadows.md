# Lights and shadows (r187)

Scene unit for inkleaf: 1 unit = 1 metre. An open book is about 0.42 x 0.28; the desk lamp sits
0.4 to 0.7 above the page. All numbers below assume metres. If you change units, light intensities
change with the square of the scale (see the anchor formulas).

## 1. Physically based intensities: the anchor formulas

Since the legacy light mode was removed, intensities are physical. The shaders compute
(verified in `ShaderChunk/lights_pars_begin`, `lights_lambert_pars_fragment`, `common`):

- punctual attenuation: `1 / max(d^decay, 0.01)`, times a smooth window when `distance > 0`
- Lambert diffuse: `radiance = irradiance * albedo / PI` (`BRDF_Lambert = RECIPROCAL_PI * diffuseColor`)
- directional irradiance: `dot(N, L) * color * intensity`
- point and spot irradiance: `dot(N, L) * color * intensity / d^2` (decay 2), spot also multiplied by
  `smoothstep(cos(angle), cos(angle * (1 - penumbra)), cosTheta)`
- ambient irradiance: `color * intensity`; hemisphere: `mix(ground, sky, 0.5 * dot(N, up) + 0.5) * intensity`

So, to make a surface of albedo `a` show linear radiance `E` before tone mapping:

| Light | Intensity needed |
|---|---|
| Directional, facing | `PI * E / a` |
| Spot or point at distance `d`, facing | `PI * E * d^2 / a` |
| Ambient or hemisphere | `PI * E / a` |

Worked example: paper albedo 0.85, target radiance 0.9 under the lamp at 0.55 m:
`I = PI * 0.9 * 0.3025 / 0.85 = 1.0` candela. Tutorials that use 50 or 500 assume centimetre or
larger scenes. Light properties: `SpotLight.power` and `PointLight.power` are lumens
(`power = intensity * PI` for a spot, `intensity * 4 * PI` for a point, from `SpotLight.js` and
`PointLight.js`).

Keep `decay = 2` and `distance = 0` (defaults) unless you need a hard range cut for performance.

## 2. Light types and their cost

| Type | Constructor (r187) | Shadow | Cost notes |
|---|---|---|---|
| `DirectionalLight` | `(color, intensity)` | ortho camera, one map | cheapest shadowing light |
| `SpotLight` | `(color, intensity, distance = 0, angle = PI/3, penumbra = 0, decay = 2)` | perspective camera, one map | supports `map` (cookie) |
| `PointLight` | `(color, intensity, distance = 0, decay = 2)` | cube map, 6 renders | avoid shadows; fine without |
| `HemisphereLight` | `(skyColor, groundColor, intensity)` | none | best cheap fill for paper |
| `AmbientLight` | `(color, intensity)` | none | flat; prefer hemisphere |
| `RectAreaLight` | needs `RectAreaLightUniformsLib.init()` | none | Standard/Physical only |

Direction lights point from `position` to `target.position`. Move the target and add it to the
scene (or call `light.target.updateMatrixWorld()`), otherwise the old direction stays.

## 3. The inkleaf desk rig (starting point)

```ts
import {
  SpotLight, HemisphereLight, Color, Object3D, type Scene,
} from 'three';

export function addDeskRig(scene: Scene, shadowSize: number) {
  // Window: a far, narrow spot reads as near-parallel daylight and can carry a cookie.
  const windowLight = new SpotLight(new Color(0xfff3e0), 0, 0, 0.16, 0.35, 2);
  windowLight.name = 'light.window';
  windowLight.position.set(-2.6, 3.0, -1.4);
  const d = windowLight.position.length();
  windowLight.intensity = Math.PI * 0.75 * d * d / 0.85;  // facing radiance about 0.75 on paper
  windowLight.castShadow = true;
  windowLight.shadow.mapSize.set(shadowSize, shadowSize);
  windowLight.shadow.camera.near = d - 1.0;              // tight depth range around the desk
  windowLight.shadow.camera.far = d + 1.0;
  windowLight.shadow.camera.updateProjectionMatrix();
  windowLight.shadow.bias = -0.0002;
  windowLight.shadow.normalBias = 0.004;                  // about 1.5 texels, see section 5
  windowLight.shadow.radius = 3;                          // PCF softness in texels
  windowLight.target.position.set(0, 0, 0);
  scene.add(windowLight, windowLight.target);

  // Desk lamp: warm, close, soft cone edge.
  const lamp = new SpotLight(new Color(0xffd6a0), 0, 0, 0.62, 0.8, 2);
  lamp.name = 'light.lamp';
  lamp.position.set(0.35, 0.55, 0.2);
  const dl = lamp.position.length();
  lamp.intensity = Math.PI * 0.55 * dl * dl / 0.85;
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(shadowSize / 2, shadowSize / 2);
  lamp.shadow.camera.near = 0.05;                         // default near is 0.5: too far for a desk lamp
  lamp.shadow.camera.updateProjectionMatrix();
  lamp.shadow.intensity = 0.6;                            // lamp shadows lighter than window shadows
  lamp.target = new Object3D();
  scene.add(lamp, lamp.target);

  // Fill: sky slightly cool, ground bounce warm from the desk.
  const fill = new HemisphereLight(0xdfe7ff, 0x7a5a3c, Math.PI * 0.18);
  fill.name = 'light.fill';
  scene.add(fill);
  return { windowLight, lamp, fill };
}
```

Spot `shadow.camera` fov, aspect and far are derived each frame in `SpotLightShadow.updateMatrices`
(`fov = 2 * angle * focus`, `far = light.distance || camera.far`); `near` is yours to set, default 0.5.

## 4. Shadow map types in r187

| `renderer.shadowMap.type` | What it does now | Softness control |
|---|---|---|
| `BasicShadowMap` | single nearest compare, hard and aliased | none |
| `PCFShadowMap` (default) | depth texture with hardware compare, 5 Vogel-disk taps rotated by interleaved gradient noise | `shadow.radius` in texels |
| `PCFSoftShadowMap` | deprecated since r186; replaced by `PCFShadowMap` at render time with a warning | n/a |
| `VSMShadowMap` | moments blurred in two passes; every receiver also casts | `shadow.radius`, `shadow.blurSamples` |

Consequences:
- Old advice "use PCFSoftShadowMap for soft shadows" is obsolete. Use PCF and raise `radius`
  (2 to 5 with a 2048 map). Too high a radius shows the noise pattern; raise `mapSize` first.
- The PCF noise is per pixel and stable (keyed on `gl_FragCoord`), so a still frame has a fixed
  fine grain on penumbras. SMAA does not remove it; AO blur does not touch it. If it shows, lower
  radius or switch the window light to VSM.
- VSM gives the softest window shadows (radius 6 to 12, blurSamples 12 to 16) but leaks light where
  occluders overlap and makes every receiver a caster. VSM does not support point lights.
- Changing `shadowMap.type` at runtime disposes and recreates all maps (`typeChanged` path).

## 5. Map size, texel size and bias

World size of one shadow texel:
- Directional: `(camera.right - camera.left) / mapSize.x`
- Spot at distance `d`: `2 * d * tan(angle * focus) / mapSize.x`

Rules that hold up:
- `normalBias` (world units, pushes the lookup along the surface normal): 1 to 2 texels.
- `bias` (normalized depth, added to the compare): start at `-0.0001` to `-0.0005`, adjust only after
  `normalBias` is set.
- Acne (banded self shadow) means too little bias. Peter-panning (shadow detached from the
  contact) means too much, usually `normalBias`.

Fitting a directional shadow camera tightly around what matters:

```ts
import { Box3, Vector3, Matrix4, type DirectionalLight, type Object3D } from 'three';

const _box = new Box3(), _corner = new Vector3(), _toLight = new Matrix4();

export function fitDirectionalShadow(light: DirectionalLight, focus: Object3D, pad = 0.02) {
  light.updateMatrixWorld();
  light.target.updateMatrixWorld();
  _box.setFromObject(focus);
  const cam = light.shadow.camera;
  cam.position.copy(light.position);
  cam.lookAt(light.target.position);
  cam.updateMatrixWorld();
  _toLight.copy(cam.matrixWorldInverse);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < 8; i++) {
    _corner.set(i & 1 ? _box.max.x : _box.min.x, i & 2 ? _box.max.y : _box.min.y, i & 4 ? _box.max.z : _box.min.z)
      .applyMatrix4(_toLight);
    minX = Math.min(minX, _corner.x); maxX = Math.max(maxX, _corner.x);
    minY = Math.min(minY, _corner.y); maxY = Math.max(maxY, _corner.y);
    minZ = Math.min(minZ, _corner.z); maxZ = Math.max(maxZ, _corner.z);
  }
  cam.left = minX - pad; cam.right = maxX + pad;
  cam.bottom = minY - pad; cam.top = maxY + pad;
  cam.near = Math.max(0.01, -maxZ - pad); cam.far = -minZ + pad;
  cam.updateProjectionMatrix();
}
```

Debug: `scene.add(new CameraHelper(light.shadow.camera))` and look for the frustum hugging the book.
`ShadowMapViewer` in `three/addons/utils/ShadowMapViewer.js` draws the map in a corner.

## 6. Thin sheets: pages, cards, paper cut-outs

The shadow pass flips culling for single-sided materials: `FrontSide` materials render with
`BackSide` into the shadow map (`WebGLShadowMap.js`, `shadowSide` table). A page lying flat and lit
from above shows its front face to the light, so its back face is culled and the page casts no
shadow at all. Fix:

```ts
pageMaterial.shadowSide = DoubleSide;   // or FrontSide; keeps the sheet in the shadow map
pageMesh.castShadow = true;
pageMesh.receiveShadow = true;
```

With `DoubleSide` shadows on a sheet, keep `normalBias` small (about 1 texel), because the receiver
and caster are the same surface. A turning page is the classic acne case; check it mid-turn.

## 7. Shadow intensity, receivers and casters

- `light.shadow.intensity` (0..1, default 1) lightens a light's shadow without adding ambient light;
  the shader does `mix(1.0, shadow, shadowIntensity)`.
- `mesh.castShadow`, `mesh.receiveShadow` default false. Set them per object; glow tubes and beads
  should not cast.
- Toggling `castShadow`, adding or removing a light, or changing `visible` on a light changes the
  light counts that are part of every lit program's key. The first time each combination appears,
  every lit material compiles a new program (a visible hitch); later repeats reuse cached programs.
  To switch a light off at runtime, set `intensity = 0` and keep it in the scene.

## 8. Update shadows only when needed

```ts
renderer.shadowMap.autoUpdate = false;     // global switch
renderer.shadowMap.needsUpdate = true;     // one update on the next render

// per light, finer grained (both exist on LightShadow in r187)
windowLight.shadow.autoUpdate = false;
windowLight.shadow.needsUpdate = true;
```

Raise `needsUpdate` while a page turns, a model peels up, or a light moves; leave it off on a
static spread. With `autoUpdate = false` on the renderer, nothing updates until you raise the flag,
including after a resize, so flag it in your resize path too.

## 9. Window light cookie (gobo) with `SpotLight.map`

Facts from the r187 source (`SpotLight.js`, `lights_fragment_begin`):
- `map` only works while `castShadow` is true (the light's shadow matrix provides the projection).
- The texture is sampled with the raw projected coordinate: `texture2D(spotLightMap, coord.xy)`.
  `texture.offset`, `repeat` and `rotation` are ignored. To animate, redraw the canvas or move the light.
- The light colour is multiplied by the texture RGB inside the frustum and left unchanged outside it.
  The frustum is the shadow camera, `fov = 2 * angle * focus`. Keep `shadow.focus = 1` or the edge of
  the cone is not masked.
- RGB multiply means coloured glass works: paint tinted panes.

```ts
import { CanvasTexture, SRGBColorSpace, LinearFilter, type SpotLight } from 'three';

export function windowCookie(light: SpotLight, size = 512, blurPx = 6): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) throw new Error('2d context unavailable');
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  g.filter = `blur(${blurPx}px)`;                 // soft mullion edges = soft shadow edges
  g.fillStyle = '#fff';
  const pane = size * 0.2, gap = size * 0.035, x0 = size * 0.28, y0 = size * 0.22;
  for (let r = 0; r < 2; r++) for (let k = 0; k < 2; k++)
    g.fillRect(x0 + k * (pane + gap), y0 + r * (pane * 1.3 + gap), pane, pane * 1.3);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = LinearFilter;
  light.map = tex;
  light.castShadow = true;
  light.shadow.focus = 1;
  return tex;
}
```

Skew the panes into a parallelogram to suggest a low sun, and keep the cookie mostly dark so the
window patch is the only bright area on the desk.

## 10. Contact shadows

Options from cheapest to richest:
1. Blob decal: a plane with a radial gradient texture under a popped model, `transparent: true,
   depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1`, opacity and scale driven by the
   model's height above the page (`opacity = 0.35 * (1 - h / hMax)`).
2. N8AO: gives contact darkening wherever geometry meets the page, no setup. Tune `aoRadius` to
   about 0.02 to 0.05 in metres for a book scene.
3. Depth-from-below: the official `webgl_shadow_contact` example renders depth from under the
   object into a target and blurs it. Use it only if the object hovers over a surface with no lights
   that shadow it.
4. `ShadowMaterial` on a helper plane receives only shadows (`color`, `opacity`). Useful when the
   desk is an image and not lit geometry.

## 11. Coloured light spilling onto the page

Real `PointLight`s along an energy flow look right but each one adds per-fragment cost to every lit
material, and a shadowed point light renders the scene six times. For glow spill, prefer an
analytic term in the page material:

```ts
// uniforms shared by the page material (see materials-and-shader-patching.md for the patch helper)
export const spill = {
  uSpillCount: { value: 0 },
  uSpillPos: { value: Array.from({ length: 8 }, () => new Vector3()) },   // world space
  uSpillColor: { value: Array.from({ length: 8 }, () => new Color(0, 0, 0)) }, // linear, premultiplied by strength
  uSpillRadius: { value: new Float32Array(8).fill(0.08) },
};
```

```glsl
// fragment, after lights, before <opaque_fragment>; vWorldPos supplied by your vertex patch
uniform int uSpillCount;
uniform vec3 uSpillPos[8];
uniform vec3 uSpillColor[8];
uniform float uSpillRadius[8];
// ...
for (int i = 0; i < 8; i++) {
  if (i >= uSpillCount) break;
  float r = distance(vWorldPos, uSpillPos[i]) / uSpillRadius[i];
  float fall = exp(-r * r * 2.0);
  outgoingLight += diffuseColor.rgb * uSpillColor[i] * fall;   // tinted by the paper albedo
}
```

This costs one loop in one material, never recompiles, and colours the page like light rather than
like an overlay. Animate `uSpillColor` with the flow's energy.

## Do

- Derive intensities from the anchor table; write the target radiance next to each light.
- Fit shadow cameras tightly; one 2048 map that covers the book beats a 4096 map that covers the room.
- Use `shadowSide` on sheets and check a mid-turn page.
- Turn shadow updates off on static spreads.

## Don't

- Don't use `PCFSoftShadowMap` (removed behaviour, warning spam).
- Don't add or remove lights during interaction; animate intensity.
- Don't put shadows on point lights in this scene.
- Don't expect `map.offset` to move a cookie.

## Pitfalls

- No shadows at all: `renderer.shadowMap.enabled` false, `castShadow` missing on the light or mesh,
  `receiveShadow` missing on the desk, or the caster is outside the shadow camera.
- Shadow appears only after moving the camera: `shadowMap.autoUpdate = false` without `needsUpdate`.
- Lamp shadow clipped near the bulb: spot `shadow.camera.near` still 0.5.
- A page's shadow disappears when it lies flat: thin sheet culled, set `shadowSide`.
- Cookie edge unmasked: `shadow.focus` below 1.

## Self-check (APIs used, verified in three r187 source)

- `SpotLight` constructor, `map`, `power`, `target`: `src/lights/SpotLight.js`
- `PointLight` constructor and `power`: `src/lights/PointLight.js`
- `DirectionalLight` constructor and `target`: `src/lights/DirectionalLight.js`
- `HemisphereLight` constructor: `src/lights/HemisphereLight.js`
- `LightShadow.intensity, bias, normalBias, radius, blurSamples, mapSize, autoUpdate, needsUpdate, camera`: `src/lights/LightShadow.js`
- `SpotLightShadow.focus` and `updateMatrices` fov/far logic: `src/lights/SpotLightShadow.js`
- default shadow cameras: `src/lights/DirectionalLightShadow.js`, `SpotLightShadow.js`, `PointLightShadow.js`
- shadow map types, PCF depth compare, VSM point light limitation, `shadowSide` flip, custom depth materials, `autoUpdate`/`needsUpdate`: `src/renderers/webgl/WebGLShadowMap.js`
- PCF Vogel disk and interleaved gradient noise, `shadowIntensity` mix: `src/renderers/shaders/ShaderChunk/shadowmap_pars_fragment.glsl.js`
- spot cookie sampling and colour multiply: `src/renderers/shaders/ShaderChunk/lights_fragment_begin.glsl.js`
- attenuation and spot cone: `src/renderers/shaders/ShaderChunk/lights_pars_begin.glsl.js`
- `BRDF_Lambert`: `src/renderers/shaders/ShaderChunk/common.glsl.js`
- `PCFSoftShadowMap` deprecation, `DoubleSide`, `SRGBColorSpace`, `LinearFilter`: `src/constants.js`
- `CameraHelper`: `src/helpers/CameraHelper.js`; `ShadowMapViewer`: `examples/jsm/utils/ShadowMapViewer.js`
- `CanvasTexture`: `src/textures/CanvasTexture.js`; `Box3.setFromObject`, `Matrix4`, `Vector3.applyMatrix4`: `src/math/`
