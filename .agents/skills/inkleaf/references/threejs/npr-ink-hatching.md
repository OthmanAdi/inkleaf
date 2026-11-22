# Non-photorealistic rendering: ink lines, hatching, the printed-to-3D peel

The inkleaf look has four layers, drawn in this order:
1. Paper-white fills (lit just enough to keep window light and lamp warmth readable).
2. Hatching that encodes tone (from lighting, including shadows).
3. Ink lines of constant screen width: silhouettes, creases, boundaries.
4. Optional colour washes and glow (see `postprocessing.md` for bloom).

All snippets target three r187, the `three/addons/*` export path (maps to `examples/jsm/*`), TypeScript strict.

## 1. Constant-width ink lines with `LineSegments2`

`LineMaterial` expands each segment into a screen-space quad. `linewidth` is in CSS pixels while
`worldUnits` is false (default). `LineSegments2.onBeforeRender` copies the renderer viewport into the
`resolution` uniform, so resizes need no code.

```ts
import { EdgesGeometry, type BufferGeometry, type Color } from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

export function inkEdges(geo: BufferGeometry, ink: Color, px = 1.6, creaseDeg = 30): LineSegments2 {
  const edges = new EdgesGeometry(geo, creaseDeg);     // threshold in DEGREES, default 1
  const lineGeo = new LineSegmentsGeometry().fromEdgesGeometry(edges);
  edges.dispose();
  const mat = new LineMaterial({ color: ink, linewidth: px, worldUnits: false });
  const lines = new LineSegments2(lineGeo, mat);
  lines.computeLineDistances();                       // needed for dashes and the draw-on trick
  lines.name = 'ink.edges';
  return lines;
}
```

Facts to rely on:
- `EdgesGeometry(geometry, thresholdAngle)` emits edges whose face angle exceeds the threshold plus
  all boundary edges. It works on positions, so split normals do not matter, but nearly coplanar
  triangulation seams do: raise the threshold to 20 to 35 degrees.
- `LineMaterial`'s `color` setter stores the very `Color` object you pass: one shared `INK` colour
  is a global ink knob; clone it for one-offs.
- `alphaToCoverage: true` smooths edges only on multisampled targets; under the composer at
  `multisampling: 0` rely on SMAA.
- Picking: `raycaster.params.Line2 = { threshold: 4 }` (pixels added to `linewidth`) after
  `raycaster.setFromCamera`, because the test is in screen space.
- Merge all edges of one model into one `LineSegments2` (one draw call).
- Occlusion: lines must hide behind other surfaces but win against the surface they outline. Push
  the fills back: `fillMaterial.polygonOffset = true; polygonOffsetFactor = 1; polygonOffsetUnits = 1`.

## 2. Your own instanced line shader (pressure, arc length, wobble, draw-on)

Use this when you need per-vertex width (pen pressure), a true arc-length attribute, a soft pen tip
while drawing, or wobble that you control. One instance per segment, a 4-vertex quad template.

```ts
import {
  InstancedBufferGeometry, InstancedBufferAttribute, Float32BufferAttribute, Sphere,
  ShaderMaterial, Vector2, type Vector3, type Color,
} from 'three';
// usage: const stroke = new Mesh(buildStrokeGeometry(paths), makeStrokeMaterial(INK));

export function buildStrokeGeometry(strokes: readonly (readonly Vector3[])[], widthPx = 1.6) {
  let n = 0;
  for (const s of strokes) n += Math.max(0, s.length - 1);
  const a = new Float32Array(n * 3), b = new Float32Array(n * 3);
  const arc = new Float32Array(n * 2), wid = new Float32Array(n * 2);
  const all: Vector3[] = [];
  let i = 0;
  for (const s of strokes) {
    let len = 0;
    for (let k = 0; k + 1 < s.length; k++, i++) {
      const p = s[k]!, q = s[k + 1]!;
      a.set([p.x, p.y, p.z], i * 3); b.set([q.x, q.y, q.z], i * 3);
      const d = p.distanceTo(q);
      arc[i * 2] = len; arc[i * 2 + 1] = len + d; len += d;
      wid[i * 2] = widthPx; wid[i * 2 + 1] = widthPx;     // write pressure here if you have it
      all.push(p, q);
    }
  }
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0], 3));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  g.setAttribute('aStart', new InstancedBufferAttribute(a, 3));
  g.setAttribute('aEnd', new InstancedBufferAttribute(b, 3));
  g.setAttribute('aArc', new InstancedBufferAttribute(arc, 2));   // metres along the stroke
  g.setAttribute('aWidth', new InstancedBufferAttribute(wid, 2));
  g.instanceCount = n;
  g.boundingSphere = new Sphere().setFromPoints(all);              // template quad is not the shape
  return g;
}

export function makeStrokeMaterial(ink: Color) {
  return new ShaderMaterial({
    name: 'ink.stroke',
    transparent: true,                       // AA fringe blends; ink is otherwise opaque
    uniforms: {
      uInk: { value: ink }, uRes: { value: new Vector2(1, 1) }, uPxRatio: { value: 1 },
      uDrawn: { value: 1e9 }, uTip: { value: 0.004 },
      uTime: { value: 0 }, uBoil: { value: 8 }, uWobblePx: { value: 0.6 }, uWobbleFreq: { value: 90 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aStart; attribute vec3 aEnd; attribute vec2 aArc; attribute vec2 aWidth;
      uniform vec2 uRes; uniform float uPxRatio; uniform float uTime; uniform float uBoil;
      uniform float uWobblePx; uniform float uWobbleFreq;
      varying float vArc; varying float vSide; varying float vHalf;
      float h1(float n) { return fract(sin(n) * 43758.5453); }
      float vnoise(float x) { float i = floor(x), f = fract(x); return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f)) * 2.0 - 1.0; }
      void main() {
        vec4 c0 = projectionMatrix * modelViewMatrix * vec4(aStart, 1.0);
        vec4 c1 = projectionMatrix * modelViewMatrix * vec4(aEnd, 1.0);
        vec2 s0 = c0.xy / c0.w * 0.5 * uRes, s1 = c1.xy / c1.w * 0.5 * uRes;
        vec2 dir = normalize(s1 - s0 + vec2(1e-6, 0.0));
        vec2 nrm = vec2(-dir.y, dir.x);
        float t = position.x;
        float halfW = 0.5 * mix(aWidth.x, aWidth.y, t) * uPxRatio;
        float arc = mix(aArc.x, aArc.y, t);
        float frame = floor(uTime * uBoil);                        // boiling line: steps, not drift
        float wob = vnoise(arc * uWobbleFreq + frame * 7.31) * uWobblePx * uPxRatio;
        vec2 px = nrm * (position.y * (halfW + 1.0) + wob) + dir * (2.0 * t - 1.0) * halfW;
        vec4 c = mix(c0, c1, t);
        c.xy += px / (0.5 * uRes) * c.w;
        gl_Position = c;
        vArc = arc; vSide = position.y; vHalf = halfW;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uInk; uniform float uDrawn; uniform float uTip;
      varying float vArc; varying float vSide; varying float vHalf;
      void main() {
        if (vArc > uDrawn) discard;
        float d = abs(vSide) * (vHalf + 1.0);                       // px from the centre line
        float cover = clamp(vHalf + 0.5 - d, 0.0, 1.0);
        float tip = smoothstep(uDrawn, uDrawn - uTip, vArc);        // tapered, wet pen tip
        gl_FragColor = vec4(uInk, cover * mix(0.55, 1.0, tip));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
// per frame: mat.uniforms.uRes.value = renderer.getDrawingBufferSize(v); mat.uniforms.uPxRatio.value = renderer.getPixelRatio();
```

Limits: segments are independent quads overlapping by half a width at joints (fine for opaque
ink; a translucent ink darkens joints). An endpoint behind the camera (`w < 0`) flips; keep ink
models in front of the near plane, which is always true for a book on a desk.

## 3. Silhouettes

Creases are static; silhouettes depend on the view. Three ways, in order of preference for inkleaf:

### 3a. Inverted hull with constant pixel width

Draw the mesh again with `side: BackSide`, pushed outward in clip space along a smoothed normal.

```ts
import { ShaderMaterial, BackSide, BufferAttribute, BufferGeometry, Vector2, type Color } from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export function addSmoothNormals(geo: BufferGeometry): void {
  const tmp = new BufferGeometry();
  tmp.setAttribute('position', geo.getAttribute('position').clone());
  if (geo.index) tmp.setIndex(geo.index.clone());
  const welded = mergeVertices(tmp, 1e-4);        // position-only, so splits by normal/uv vanish
  welded.computeVertexNormals();
  const key = (x: number, y: number, z: number) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
  const wp = welded.getAttribute('position'), wn = welded.getAttribute('normal');
  const map = new Map<string, [number, number, number]>();
  for (let i = 0; i < wp.count; i++) map.set(key(wp.getX(i), wp.getY(i), wp.getZ(i)), [wn.getX(i), wn.getY(i), wn.getZ(i)]);
  const p = geo.getAttribute('position'), out = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) out.set(map.get(key(p.getX(i), p.getY(i), p.getZ(i))) ?? [0, 1, 0], i * 3);
  geo.setAttribute('aSmoothNormal', new BufferAttribute(out, 3));
  tmp.dispose(); welded.dispose();
}

export function makeHullMaterial(ink: Color, widthPx: number) {
  return new ShaderMaterial({
    name: 'ink.hull', side: BackSide,
    uniforms: { uInk: { value: ink }, uWidthPx: { value: widthPx }, uRes: { value: new Vector2(1, 1) } },
    vertexShader: /* glsl */ `
      attribute vec3 aSmoothNormal; uniform float uWidthPx; uniform vec2 uRes;
      void main() {
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        vec2 n = (projectionMatrix * vec4(normalize(normalMatrix * aSmoothNormal), 0.0)).xy;
        float l = length(n);
        if (l > 1e-5) clip.xy += (n / l) * (2.0 * uWidthPx / uRes) * clip.w;
        gl_Position = clip;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uInk;
      void main() { gl_FragColor = vec4(uInk, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
// uWidthPx in drawing-buffer pixels = CSS px * renderer.getPixelRatio(); uRes = drawing buffer size
```

Strengths: one extra draw, follows deformation if you mirror the vertex patch, works with AO.
Weaknesses: no inner silhouettes where the object overlaps itself without a depth gap; thin parts
(less than the line width) get swallowed. Pair it with crease lines from section 1.
`OutlineEffect` in `three/addons/effects/OutlineEffect.js` implements a similar hull but renders
through its own `render()` call, which does not compose with the pmndrs pipeline.

### 3b. CPU silhouette edges (exact, view dependent)

For low-poly diagram models (under about 5k triangles) find edges whose two faces disagree on
facing. Recompute only when the camera or the object rotates.

```ts
import { Vector3, type BufferGeometry, type Camera, type Object3D, type InterleavedBufferAttribute } from 'three';
import type { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

interface Adj { a: number; b: number; f0: number; f1: number }   // f1 = -1 on boundaries

export function buildAdjacency(geo: BufferGeometry) {           // geo: welded + indexed
  const idx = geo.index!.array, pos = geo.getAttribute('position');
  const faces = idx.length / 3, nrm = new Float32Array(faces * 3), ctr = new Float32Array(faces * 3);
  const A = new Vector3(), B = new Vector3(), C = new Vector3(), e = new Map<string, Adj>();
  for (let f = 0; f < faces; f++) {
    const i0 = idx[f * 3]!, i1 = idx[f * 3 + 1]!, i2 = idx[f * 3 + 2]!;
    A.fromBufferAttribute(pos, i0); B.fromBufferAttribute(pos, i1); C.fromBufferAttribute(pos, i2);
    const n = B.clone().sub(A).cross(C.clone().sub(A)).normalize();
    nrm.set([n.x, n.y, n.z], f * 3);
    ctr.set([(A.x + B.x + C.x) / 3, (A.y + B.y + C.y) / 3, (A.z + B.z + C.z) / 3], f * 3);
    for (const [u, v] of [[i0, i1], [i1, i2], [i2, i0]] as const) {
      const k = u < v ? `${u}_${v}` : `${v}_${u}`;
      const hit = e.get(k);
      if (hit) hit.f1 = f; else e.set(k, { a: u, b: v, f0: f, f1: -1 });
    }
  }
  return { edges: [...e.values()], nrm, ctr };
}

const _eye = new Vector3();
export function writeSilhouette(adj: ReturnType<typeof buildAdjacency>, geo: BufferGeometry,
  obj: Object3D, cam: Camera, lines: LineSegmentsGeometry): void {
  obj.worldToLocal(cam.getWorldPosition(_eye));
  const start = lines.getAttribute('instanceStart') as InterleavedBufferAttribute;
  const buf = start.data.array as Float32Array, pos = geo.getAttribute('position');
  const facing = (f: number) => {
    const o = f * 3;
    return adj.nrm[o]! * (_eye.x - adj.ctr[o]!) + adj.nrm[o + 1]! * (_eye.y - adj.ctr[o + 1]!) + adj.nrm[o + 2]! * (_eye.z - adj.ctr[o + 2]!) > 0;
  };
  let n = 0;
  for (const ed of adj.edges) {
    if (ed.f1 >= 0 && facing(ed.f0) === facing(ed.f1)) continue;
    if ((n + 1) * 6 > buf.length) break;
    buf.set([pos.getX(ed.a), pos.getY(ed.a), pos.getZ(ed.a), pos.getX(ed.b), pos.getY(ed.b), pos.getZ(ed.b)], n * 6);
    n++;
  }
  start.data.needsUpdate = true;
  lines.instanceCount = n;
}
// allocate once: lineGeo.setPositions(new Float32Array(maxEdges * 6)); line.frustumCulled = false
```

`instanceStart` and `instanceEnd` share one `InstancedInterleavedBuffer` (stride 6), so writing the
shared array updates both. Dashes and draw-on need `computeLineDistances()` again after a change.

### 3c. Screen-space edges from depth (post effect)

Cheap, catches everything including intersections, but width and style are uniform and it also
outlines the page against the desk. See `postprocessing.md` section 6 for a depth-Laplacian
`Effect`. Use it as a faint secondary line, not as the main ink.

## 4. Hatching from lighting

Tone comes from the lit result, so hatching follows shadows, the window cookie and the lamp.
Patch the paper material just before `#include <opaque_fragment>`, where `reflectedLight`,
`diffuseColor` and `outgoingLight` exist (Lambert and Standard both).

```glsl
// declarations (after #include <common> in the fragment shader)
uniform vec3 uInk; uniform float uLightRef; uniform float uHatch; uniform float uKeepLight;
uniform vec2 uHatchAnchor; uniform float uHatchPeriodPx;
float inkLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hatchLine(vec2 p, float angle, float halfWidth) {
  float t = dot(p, vec2(cos(angle), sin(angle)));
  float dist = abs(fract(t + 0.5) - 0.5);                // 0 on a line, 0.5 between lines
  float aa = fwidth(t);
  return 1.0 - smoothstep(halfWidth - aa, halfWidth + aa, dist);
}
```

```glsl
// injected before #include <opaque_fragment>
vec3 inkIrr = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
float level = PI * inkLuma(inkIrr) / max(inkLuma(diffuseColor.rgb), 1e-4) / uLightRef; // 1 = reference light
float tone = clamp(1.0 - level, 0.0, 1.0);
vec2 hp = (gl_FragCoord.xy - uHatchAnchor) / uHatchPeriodPx;
float ink = hatchLine(hp, 0.7854, clamp((tone - 0.18) * 0.8, 0.0, 0.3));
ink = max(ink, hatchLine(hp, -0.7854, clamp((tone - 0.45) * 0.8, 0.0, 0.3)));
ink = max(ink, hatchLine(hp * 1.7, 0.0, clamp((tone - 0.72) * 0.8, 0.0, 0.3)));
vec3 fill = mix(diffuseColor.rgb, outgoingLight, uKeepLight);   // 0 = flat paper, 1 = fully lit
outgoingLight = mix(fill, uInk, ink * uHatch);
```

Why it works: Lambert's direct and indirect terms are `irradiance * albedo / PI`, so dividing by
albedo and multiplying by `PI` recovers irradiance including shadow attenuation. `uLightRef` is the
irradiance you consider "fully lit, no ink" (for a facing light, its intensity; see
`lights-shadows.md`). `fwidth` keeps lines anti-aliased at any zoom.

Screen-space hatch lines slide over a moving object (the "shower door"). Anchor them to the object:

```ts
import { Vector3, type Mesh, type PerspectiveCamera, type Vector2 } from 'three';
const _p = new Vector3(), _c = new Vector3();
export function anchorHatch(mesh: Mesh, cam: PerspectiveCamera, u: { uHatchAnchor: { value: Vector2 }; uHatchPeriodPx: { value: number } },
  bufW: number, bufH: number, periodCssPx: number, pxRatio: number, refDist: number): void {
  mesh.getWorldPosition(_p);
  const dist = _p.distanceTo(cam.getWorldPosition(_c));   // world position: the camera sits in a rig
  _p.project(cam);                                         // NDC; gl_FragCoord origin is bottom-left
  u.uHatchAnchor.value.set((_p.x * 0.5 + 0.5) * bufW, (_p.y * 0.5 + 0.5) * bufH);
  u.uHatchPeriodPx.value = periodCssPx * pxRatio * (refDist / dist);  // hatch scales with the object
}
```

Per-object uniforms need per-object material instances. The renderer re-uploads a built-in
material's uniforms only when the material changes between draws (`refreshMaterial` in
`WebGLRenderer.js`), so two meshes sharing one patched material would both get the second value.
Instances share the compiled program, so this costs almost nothing. `material.clone()` does not copy
`onBeforeCompile`; re-apply the patch to each clone.

Object-space alternative (no sliding, but lines distort on curved surfaces):
`vec2 hp = vInkLocal.xz * uDensity;` with `vInkLocal` passed from `position`; triplanar blending by
the local normal removes stretching on boxes.

Paper-white fills that still feel lit: `uKeepLight` 0.25 to 0.45 keeps the window patch and lamp
pool visible while the model reads as printed; under `ToneMappingMode.NEUTRAL` an albedo of 0.92
displays almost as picked (AgX greys it); a faint fibre bump map (`procedural-textures.md`) makes
hatching look printed on paper rather than overlaid on a screen.

## 5. Hand-drawn wobble and boil for `LineMaterial`

Patch the fat-line vertex shader. Endpoints shared by neighbouring segments get identical offsets,
so strokes stay connected. Perspective cameras only (uses `projectionMatrix[1][1]`).

```ts
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
export const inkWobble = { uInkTime: { value: 0 }, uInkBoil: { value: 8 }, uInkWobblePx: { value: 0.7 } };

export function addWobble(m: LineMaterial): void {
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, inkWobble);
    const A = 'vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );';
    if (!s.vertexShader.includes(A) || !s.vertexShader.includes('#include <common>')) throw new Error('[ink] LineMaterial anchors moved');
    s.vertexShader = s.vertexShader
      .replace('#include <common>', () => `#include <common>
        uniform float uInkTime; uniform float uInkBoil; uniform float uInkWobblePx;
        vec2 inkJit(vec3 p) { return fract(sin(vec2(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)))) * 43758.5453) * 2.0 - 1.0; }`)
      .replace(A, () => `${A}
        float inkF = floor(uInkTime * uInkBoil);
        start.xy += inkJit(instanceStart + inkF) * uInkWobblePx * 2.0 * -start.z / (projectionMatrix[1][1] * resolution.y);
        end.xy += inkJit(instanceEnd + inkF) * uInkWobblePx * 2.0 * -end.z / (projectionMatrix[1][1] * resolution.y);`);
  };
  m.customProgramCacheKey = () => 'ink.line.wobble.v1';
  m.needsUpdate = true;
}
```

Boil rate 6 to 10 steps per second reads as hand animation; continuous noise reads as vibration.
With reduced motion, set `uInkBoil` to 0 (frozen wobble).

## 6. Draw-on animation

Fat lines (`LineSegments2`): the dash test is `mod(vLineDistance + dashOffset, dashSize + gapSize) >
dashSize` (from `LineMaterial`), with cumulative distances in segment order from
`computeLineDistances()`. A single dash that grows is a draw-on:

```ts
import type { InterleavedBufferAttribute } from 'three';
export function prepareDrawOn(lines: LineSegments2): number {
  lines.computeLineDistances();
  const d = lines.geometry.getAttribute('instanceDistanceEnd') as InterleavedBufferAttribute;
  const total = d.getX(d.count - 1);
  lines.material.dashed = true;           // toggles a define: set once, not per frame
  lines.material.dashScale = 1;
  lines.material.gapSize = total * 1.01;  // period longer than the whole path: one dash only
  lines.material.dashSize = 1e-6;
  return total;
}
// per frame: lines.material.dashSize = Math.max(1e-6, total * eased(progress));
```

Segment order is draw order. Order edges into chains that a hand would draw (outline first, then
details) before building the geometry. The custom stroke shader in section 2 uses `uDrawn` in metres
per stroke and adds a soft tip.

## 7. Printed flat, then peeled up into 3D

On the page the model is drawn in oblique "cabinet" projection: depth recedes at half scale along
a 45 degree axis. Peeling up is one affine matrix per frame on the model's group, so meshes, fat
lines, shadows and raycasting all follow without shader changes.

Model space: x right, y up (height when popped), z towards the reader. Page: the XZ plane of the
page group, page "up" is -z. Printed point: `(x + k z cos a, 0, -(y + k z sin a))`. That equals
`Rx(-90 deg) * Shear(k, a) * Scale(1, 1, 0)`. Interpolate the rotation angle, the shear and the depth:

```ts
import { Matrix4, type Object3D } from 'three';
const _r = new Matrix4(), _s = new Matrix4();

/** t = 0 printed flat, t = 1 standing 3D. `base` places the model on the page. */
export function setPeel(group: Object3D, base: Matrix4, t: number, k = 0.5, obliqueDeg = 45, minDepth = 0.02): void {
  const u = 1 - t, a = obliqueDeg * Math.PI / 180;
  const depth = minDepth + (1 - minDepth) * t;            // never exactly 0: keeps the matrix invertible
  _s.set(
    1, 0, k * u * Math.cos(a), 0,
    0, 1, k * u * Math.sin(a), 0,
    0, 0, depth,               0,
    0, 0, 0,                   1);
  _r.makeRotationX(-u * Math.PI / 2);
  group.matrixAutoUpdate = false;
  group.matrix.multiplyMatrices(base, _r).multiply(_s);
  group.matrixWorldNeedsUpdate = true;
}
```

Staging that sells it: stagger child parts by height (low parts lift first, offsets of 40 to 80 ms),
ease with a slight overshoot on the rotation only, fade hatching in over the last 40 percent
(`uHatch`), keep `castShadow` off until `t > 0.05` so a flattened model never self-shadows on the
paper, and raise `renderer.shadowMap.needsUpdate` each frame of the peel. With `minDepth` near 0 the
normal matrix is extreme; since the printed state is unlit ink on paper, also lerp `uKeepLight`
towards 0 at `t = 0`.

## Do / Don't / Pitfalls

- Do combine hull silhouettes, `EdgesGeometry` creases and lighting-driven hatching; keep widths
  in CSS px (scale by pixel ratio in custom shaders); anchor hatching per object; peel with a matrix.
- Don't use `LineBasicMaterial.linewidth` for ink (WebGL2 draws 1 px lines); don't recompute
  silhouettes when nothing rotates; don't hatch in a post pass; don't let `minDepth` reach 0.
- Pitfalls: lines flicker on their surface (fills lack `polygonOffset`); hull gaps at hard edges
  (no `aSmoothNormal`); hatching swims (unanchored); all objects share one anchor (shared material
  instance); draw-on jumps between parts (segments not chained).

## Self-check (APIs used, verified in three r187 source)

- `LineSegments2` (`computeLineDistances`, `onBeforeRender` resolution, `raycast` with `params.Line2`): `examples/jsm/lines/LineSegments2.js`
- `LineMaterial` (`color`, `linewidth`, `worldUnits`, `dashed`, `dashScale`, `dashSize`, `gapSize`, `dashOffset`, `alphaToCoverage`, `resolution`, vertex anchors at lines 101 to 102, dash discard at line 348): `examples/jsm/lines/LineMaterial.js`
- `LineSegmentsGeometry.fromEdgesGeometry`, `setPositions`, shared interleaved buffer: `examples/jsm/lines/LineSegmentsGeometry.js`
- `EdgesGeometry(geometry, thresholdAngle)` degrees and boundary edges: `src/geometries/EdgesGeometry.js`
- `mergeVertices`: `examples/jsm/utils/BufferGeometryUtils.js`; `OutlineEffect`: `examples/jsm/effects/OutlineEffect.js`
- `InstancedBufferGeometry.instanceCount`, `InstancedBufferAttribute(array, itemSize, normalized, meshPerAttribute)`, `InterleavedBuffer.needsUpdate`: `src/core/`
- `Sphere.setFromPoints`, `Matrix4.set` (row-major), `makeRotationX`, `multiplyMatrices`, `Vector3.project`: `src/math/`
- `Object3D.matrixAutoUpdate`, `matrixWorldNeedsUpdate`, `worldToLocal`, `getWorldPosition`: `src/core/Object3D.js`
- material uniform refresh only on material change, `uniformsNeedUpdate` for ShaderMaterial: `src/renderers/WebGLRenderer.js` (around lines 2582 to 2824)
- `Material.copy` does not copy `onBeforeCompile`: `src/materials/Material.js`
- `reflectedLight`, `diffuseColor`, `outgoingLight`, `opaque_fragment`: `src/renderers/shaders/ShaderLib/meshlambert.glsl.js`, `ShaderChunk/opaque_fragment.glsl.js`
- `BackSide`: `src/constants.js`; `three/addons/*` export map: `three/package.json`
