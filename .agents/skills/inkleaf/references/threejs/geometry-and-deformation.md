# Geometry and deformation (r187)

Pages bend, flows run along curves, beads ride them, props are lathed. This file gives the exact
APIs and the math. Units are metres.

## 1. BufferGeometry from scratch

```ts
import { BufferGeometry, BufferAttribute, Float32BufferAttribute } from 'three';

export function quadStrip(points: readonly [number, number][], width: number): BufferGeometry {
  const n = points.length;
  const pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2), idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const [x, z] = points[i]!;
    pos.set([x, 0, z - width / 2, x, 0, z + width / 2], i * 6);
    uv.set([i / (n - 1), 0, i / (n - 1), 1], i * 4);
    if (i < n - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(idx);                    // number[] becomes Uint16 or Uint32 automatically
  g.computeVertexNormals();
  g.computeBoundingSphere();          // culling and raycasting rely on it
  return g;
}
```

Winding: counter-clockwise seen from the front is the front face. With `a, a+1, a+2` and the layout
above, the strip faces +y. If a surface is invisible from above, swap two indices per triangle
rather than switching to `DoubleSide`.

Methods that exist on `BufferGeometry` in r187: `setAttribute, getAttribute, deleteAttribute,
hasAttribute, setIndex, getIndex, addGroup, clearGroups, setDrawRange, applyMatrix4, rotateX/Y/Z,
translate, scale, lookAt, center, setFromPoints, computeBoundingBox, computeBoundingSphere,
computeTangents, computeVertexNormals, normalizeNormals, toNonIndexed, clone, copy, dispose`.

## 2. Updating attributes every frame

```ts
import { DynamicDrawUsage, type BufferAttribute } from 'three';
pos.setUsage(DynamicDrawUsage);         // hint before the first upload
// ... write pos.array ...
pos.needsUpdate = true;                 // full re-upload next render
pos.clearUpdateRanges();
pos.addUpdateRange(start * 3, count * 3);   // optional: upload only a slice (in array elements)
```

After moving vertices on the CPU:
- `geometry.computeBoundingSphere()` (or keep a conservative sphere, see the page bender). Both
  frustum culling and `Mesh.raycast` early-out use a bounding sphere that three computes only once
  when it is `null` (`Mesh.js`, `Frustum.intersectsObject`). A stale sphere makes the page vanish
  near screen edges and ignore clicks.
- Normals: write analytic normals when you know them; `computeVertexNormals()` costs a pass over all
  triangles (fine for a 40 by 12 page, not for 50k vertices per frame).
- `setDrawRange(start, count)` hides the tail of a buffer without reallocating (growing strokes).

## 3. Page bend and turn on the CPU (raycast-correct)

Model: the page is inextensible across its width. Each row of the grid is a planar curve in the
plane perpendicular to the spine, described by its tangent angle `alpha(s)` along arc length `s`.
Integrating `(cos alpha, sin alpha)` keeps the arc length exact, so the paper never stretches.

```
alpha(sn) = turn                                  rigid rotation about the spine, 0..PI
          + gutter(sn) * cos(turn)                rest curvature into the gutter, mirrored when turned
          - lag * sin(turn) * sn^2                free edge trails mid-turn, flat at both ends
gutter(sn) = gutterLift * max(0, 1 - sn / g)^2    g about 0.15: only near the spine
sn = s / width
```

```ts
import { BufferGeometry, BufferAttribute, DynamicDrawUsage, Sphere, Vector3 } from 'three';

export interface PageShape { turn: number; lag: number; gutterLift: number; cornerLead: number }

export class PageBender {
  readonly geometry = new BufferGeometry();
  private readonly pos: BufferAttribute;
  private readonly nrm: BufferAttribute;

  constructor(readonly width = 0.21, readonly height = 0.28, readonly nx = 40, readonly ny = 12) {
    const count = (nx + 1) * (ny + 1);
    this.pos = new BufferAttribute(new Float32Array(count * 3), 3).setUsage(DynamicDrawUsage);
    this.nrm = new BufferAttribute(new Float32Array(count * 3), 3).setUsage(DynamicDrawUsage);
    const uv = new Float32Array(count * 2), idx: number[] = [];
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      const k = j * (nx + 1) + i;
      uv[k * 2] = i / nx; uv[k * 2 + 1] = 1 - j / ny;          // u from spine to fore-edge, v = 1 at the head
      if (i < nx && j < ny) { const c = k + nx + 1; idx.push(k, c, k + 1, k + 1, c, c + 1); } // faces +y when flat
    }
    this.geometry.setAttribute('position', this.pos);
    this.geometry.setAttribute('normal', this.nrm);
    this.geometry.setAttribute('uv', new BufferAttribute(uv, 2));
    this.geometry.setIndex(idx);
    // every point stays within `width` of the spine axis and |z| <= height/2: one sphere fits all poses
    this.geometry.boundingSphere = new Sphere(new Vector3(0, 0, 0), Math.hypot(width, height / 2));
    this.update({ turn: 0, lag: 0, gutterLift: 0.25, cornerLead: 0 });
  }

  update(p: PageShape): void {
    const { nx, ny, width, height } = this;
    const P = this.pos.array as Float32Array, N = this.nrm.array as Float32Array;
    const ds = width / nx, g = 0.15;
    for (let j = 0; j <= ny; j++) {
      const tn = j / ny;
      const turn = Math.min(Math.PI, Math.max(0, p.turn + p.cornerLead * (tn - 0.5) * Math.sin(p.turn))); // lower corner leads
      const z = tn * height - height / 2;
      let x = 0, y = 0;
      for (let i = 0; i <= nx; i++) {
        const sn = i / nx;
        const gut = p.gutterLift * Math.max(0, 1 - sn / g) ** 2;
        const a = turn + gut * Math.cos(turn) - p.lag * Math.sin(turn) * sn * sn;
        const k = (j * (nx + 1) + i) * 3;
        P[k] = x; P[k + 1] = y; P[k + 2] = z;
        N[k] = -Math.sin(a); N[k + 1] = Math.cos(a); N[k + 2] = 0;
        // midpoint rule for the next segment
        const snm = (i + 0.5) / nx;
        const gm = p.gutterLift * Math.max(0, 1 - snm / g) ** 2;
        const am = turn + gm * Math.cos(turn) - p.lag * Math.sin(turn) * snm * snm;
        x += Math.cos(am) * ds; y += Math.sin(am) * ds;
      }
    }
    this.pos.needsUpdate = true;
    this.nrm.needsUpdate = true;
    if (p.cornerLead !== 0) this.geometry.computeVertexNormals(); // rows differ: analytic normals ignore the twist
  }
}
```

Two-sided paper without z-fighting: share the geometry between two meshes.

```ts
const front = new Mesh(bender.geometry, frontMat);            // side: FrontSide (default)
const back = new Mesh(bender.geometry, backMat);              // backMat.side = BackSide
backMat.map = backCanvasTex;                                  // mirror u for the back print:
backCanvasTex.wrapS = RepeatWrapping; backCanvasTex.repeat.x = -1; backCanvasTex.offset.x = 1;
frontMat.shadowSide = DoubleSide;                              // a flat page still casts (lights-shadows.md)
front.castShadow = front.receiveShadow = back.receiveShadow = true;
```

Turn drivers: `turn` from a damped value following the pointer (drag) or an eased timeline
(click); `lag` from the turn speed, for example `lag = clamp(0.15 + 0.08 * |dTurn/dt|, 0, 0.6)`
damped with a 60 ms time constant, so a fast flick bends more and a slow drag stays stiff. Grid size:
40 columns hide polygon edges in the curl; 12 rows suffice unless `cornerLead` is large.

Stacks: give each resting page a vertical offset of about 0.0003 m (paper is about 0.1 mm thick;
exaggerate a little) and the turning page the larger of the two stack heights at the spine, so it
never cuts through its neighbours. Fan angle at the spine grows with stack height.

The same profile works in a vertex shader (see `materials-and-shader-patching.md`) for decorative
riffles where raycasting does not matter.

## 4. Lathe for round props

```ts
import { LatheGeometry, Vector2 } from 'three';
// ink bottle profile: (radius, height) pairs from bottom centre to the neck
const profile = [[0, 0], [0.022, 0], [0.024, 0.004], [0.024, 0.04], [0.012, 0.052], [0.008, 0.058], [0.008, 0.066], [0, 0.066]]
  .map(([r, y]) => new Vector2(r, y));
const bottle = new LatheGeometry(profile, 48);   // (points, segments = 12, phiStart = 0, phiLength = 2*PI)
```

UVs: `u = i / segments` around, `v = j / (points.length - 1)` along the profile. Profile points must
have `x >= 0`. Repeat a point to get a hard crease (the normal splits only where vertices duplicate);
then `EdgesGeometry` finds the crease for ink lines.

## 5. Tubes along curves (energy flows)

```ts
import { CatmullRomCurve3, TubeGeometry, Vector3 } from 'three';
const path = new CatmullRomCurve3(
  [new Vector3(-0.08, 0.002, 0.03), new Vector3(-0.02, 0.03, 0.0), new Vector3(0.05, 0.012, -0.02)],
  false, 'centripetal', 0.5);                      // (points, closed, curveType, tension)
const tube = new TubeGeometry(path, 96, 0.0025, 10, false); // (path, tubularSegments, radius, radialSegments, closed)
```

TubeGeometry samples `path.getPointAt(i / tubularSegments)` (arc-length uniform) and stores
`uv.x = i / tubularSegments`, `uv.y = j / radialSegments`. So `uv.x` is normalized arc length:
a flow shader can move dashes at real speed with `fract(vUv.x * len / dashLen - time * speed / dashLen)`,
where `len = path.getLength()`. Frames come from `computeFrenetFrames`, which can twist on nearly
straight runs; the twist is invisible on round tubes but visible on flat ribbons (build ribbons
yourself with a fixed up vector).

When curve control points move: set `path.needsUpdate = true` or call `path.updateArcLengths()`
before `getPointAt`, then rebuild the tube (dispose the old geometry) or, for frequent changes, keep
the tube static and animate only beads and shader flow. `centripetal` avoids loops and cusps that
`catmullrom` can produce with uneven point spacing.

## 6. InstancedMesh for beads and bubbles

```ts
import {
  InstancedMesh, SphereGeometry, MeshBasicMaterial, Matrix4, Vector3, Quaternion, Color, DynamicDrawUsage,
  type CatmullRomCurve3,
} from 'three';

export function makeBeads(max: number, color: Color) {
  const beads = new InstancedMesh(new SphereGeometry(1, 12, 8), new MeshBasicMaterial({ color }), max);
  beads.instanceMatrix.setUsage(DynamicDrawUsage);
  for (let i = 0; i < max; i++) beads.setColorAt(i, color);  // create instanceColor BEFORE first render
  beads.count = 0;
  beads.frustumCulled = false;            // or computeBoundingSphere() after each update
  beads.name = 'flow.beads';
  return beads;
}

const _m = new Matrix4(), _p = new Vector3(), _q = new Quaternion(), _s = new Vector3();
export function layoutBeads(beads: InstancedMesh, path: CatmullRomCurve3, n: number, time: number,
  speed: number, radius: number): void {
  const len = path.getLength();
  for (let i = 0; i < n; i++) {
    const u = (i / n + (time * speed) / len) % 1;
    path.getPointAt(u, _p);
    const swell = 0.6 + 0.4 * Math.sin(Math.PI * u);          // grow in, shrink out at the ends
    _m.compose(_p, _q, _s.setScalar(radius * swell));
    beads.setMatrixAt(i, _m);
  }
  beads.count = n;                        // must not exceed the constructor count
  beads.instanceMatrix.needsUpdate = true;
}
```

Facts (`InstancedMesh.js`): `setColorAt` lazily creates `instanceColor` filled with white; creating
it after the first render adds the instancing-colour define and recompiles. After colour changes set
`beads.instanceColor!.needsUpdate = true`. `InstancedMesh` keeps its own `boundingSphere`
(computed once when null) for culling and raycasting; raycast hits report `instanceId`.

## 7. Merging and cleaning

```ts
import { mergeGeometries, mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
const merged = mergeGeometries([a, b, c], true);   // useGroups: one group per input (multi-material)
if (!merged) throw new Error('mergeGeometries: inputs have different attributes or index usage');
```

`mergeGeometries` returns `null` and logs an error when inputs differ in attribute names, item
sizes, index presence or morph setup. Convert first (`toNonIndexed()`, delete stray `uv1`/`color`).
Apply each part's transform with `geometry.applyMatrix4(mesh.matrixWorld)` before merging.
`mergeVertices(geo, tolerance)` welds identical vertices (all attributes must match, so strip
normals and UVs first if you want position-only welding). `toCreasedNormals(geo, creaseAngle)` gives
smooth shading with hard edges above the angle (radians, default PI/3).

## 8. Bounding boxes and fitting

- `geometry.computeBoundingBox()` / `computeBoundingSphere()` work in object space.
- `new Box3().setFromObject(obj, precise)` is world space; `precise = true` walks vertices (slower,
  tight for rotated objects).
- `box.getCenter(v)`, `box.getSize(v)`, `box.expandByObject(obj)`, `box.union(other)`.
- `Box3Helper(box)` draws it for debugging.
- Fit a camera to a pop-up model: distance `d = (size / 2) / tan(fov / 2)` along the view direction,
  with `size` the larger of the box height and width divided by aspect.

## Do

- Deform interactive pages on the CPU; set a conservative bounding sphere once.
- Write analytic normals when the math gives them.
- Allocate instance and attribute buffers once at maximum size; use `count` and `setDrawRange`.
- Use arc-length parameterization (`getPointAt`) for anything that moves at a speed.

## Don't

- Don't call `computeBoundingSphere` in a hot loop on large meshes when a conservative sphere works.
- Don't rebuild `TubeGeometry` per frame.
- Don't add `instanceColor` mid-session.
- Don't merge geometries with different attribute sets and ignore the `null`.

## Pitfalls

- Page disappears at the edge of the screen mid-turn: stale bounding sphere.
- Clicks land on the flat page position: the bend runs in a shader.
- Tube ribbon twists: Frenet frames on a straight segment.
- Beads bunch up on long curve sections: `getPoint` (parametric) instead of `getPointAt`.

## Self-check (APIs used, verified in three r187 source)

- `BufferGeometry` methods listed in section 1: `src/core/BufferGeometry.js`
- `BufferAttribute.setUsage`, `needsUpdate`, `addUpdateRange`, `clearUpdateRanges`, `array`: `src/core/BufferAttribute.js`; `DynamicDrawUsage`, `RepeatWrapping`, `DoubleSide`, `BackSide`: `src/constants.js`
- bounding sphere computed once when null: `src/objects/Mesh.js` (raycast), `src/math/Frustum.js` (`intersectsObject`)
- `LatheGeometry(points, segments, phiStart, phiLength)` and its UVs: `src/geometries/LatheGeometry.js`
- `TubeGeometry(path, tubularSegments, radius, radialSegments, closed)`, `getPointAt`, UV layout, Frenet frames: `src/geometries/TubeGeometry.js`
- `CatmullRomCurve3(points, closed, curveType, tension)`: `src/extras/curves/CatmullRomCurve3.js`; `Curve.getPointAt, getLength, updateArcLengths, needsUpdate, arcLengthDivisions, computeFrenetFrames`: `src/extras/core/Curve.js`
- `InstancedMesh(geometry, material, count)`, `setMatrixAt`, `setColorAt` lazy creation, `instanceMatrix`, `count`, `boundingSphere`, `computeBoundingSphere`: `src/objects/InstancedMesh.js`
- `Matrix4.compose`, `Sphere`, `Box3.setFromObject(object, precise)`, `expandByObject`, `getCenter`, `getSize`, `union`: `src/math/`
- `PlaneGeometry` vertex and UV order (for comparison with the custom grid): `src/geometries/PlaneGeometry.js`
- `mergeGeometries(geometries, useGroups)` null on mismatch, `mergeVertices(geometry, tolerance)`, `toCreasedNormals(geometry, creaseAngle)`: `examples/jsm/utils/BufferGeometryUtils.js`
- `Box3Helper`: `src/helpers/Box3Helper.js`
