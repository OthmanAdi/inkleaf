# Interaction and picking (r187)

Pointer events in, intent out: hover, click, drag a page, peel a diagram, read a term with the
magnifier. One input module owns all listeners on the canvas; objects never add DOM listeners.

## 1. Pointer plumbing

```css
canvas.inkleaf { touch-action: none; user-select: none; -webkit-user-select: none; display: block; }
```

```ts
import { Vector2 } from 'three';

export interface PointerState { ndc: Vector2; css: Vector2; buttons: number; id: number; type: string; moved: boolean }

export function attachPointer(canvas: HTMLCanvasElement, onMove: (p: PointerState) => void,
  onDown: (p: PointerState, e: PointerEvent) => void, onUp: (p: PointerState, e: PointerEvent) => void) {
  const state: PointerState = { ndc: new Vector2(2, 2), css: new Vector2(), buttons: 0, id: -1, type: 'mouse', moved: false };
  let rect = canvas.getBoundingClientRect();
  const refreshRect = () => { rect = canvas.getBoundingClientRect(); };
  new ResizeObserver(refreshRect).observe(canvas);
  addEventListener('scroll', refreshRect, { passive: true });
  const toState = (e: PointerEvent) => {
    state.css.set(e.clientX - rect.left, e.clientY - rect.top);
    state.ndc.set((state.css.x / rect.width) * 2 - 1, -(state.css.y / rect.height) * 2 + 1);
    state.buttons = e.buttons; state.type = e.pointerType;
  };
  let downAt = new Vector2();
  canvas.addEventListener('pointerdown', (e) => {
    toState(e); state.id = e.pointerId; state.moved = false; downAt = state.css.clone();
    canvas.setPointerCapture(e.pointerId);            // keep receiving moves outside the canvas
    onDown(state, e);
  });
  canvas.addEventListener('pointermove', (e) => {
    toState(e);
    if (state.id === e.pointerId && downAt.distanceTo(state.css) > 6) state.moved = true; // tap vs drag
    onMove(state);                                     // store; pick once per frame, not per event
  });
  const end = (e: PointerEvent) => {
    toState(e);
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    onUp(state, e); state.id = -1;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);       // OS gestures, palm rejection: treat as release
  canvas.addEventListener('pointerleave', () => { if (state.id < 0) state.ndc.set(2, 2); }); // no hover off-canvas
  return state;
}
```

Pick in the frame loop with the latest pointer position. A fast mouse fires 120 to 1000 move events
per second; raycasting each one wastes CPU and can stall the frame.

## 2. Raycaster essentials

```ts
import { Raycaster, type Camera, type Object3D, type Intersection } from 'three';

const ray = new Raycaster();
ray.params.Line2 = { threshold: 4 };          // fat lines: extra pixels around linewidth
const hits: Intersection[] = [];

export function pick(ndc: Vector2, camera: Camera, targets: readonly Object3D[], layer = 0): Intersection | null {
  ray.setFromCamera(ndc, camera);             // also sets ray.camera (needed by LineSegments2 and Sprites)
  ray.layers.set(layer);                      // only objects with this layer enabled are tested
  hits.length = 0;
  ray.intersectObjects(targets as Object3D[], true, hits);   // sorted by distance
  return hits[0] ?? null;
}
```

Intersection fields in r187 (`Mesh.js`): `distance, point, object, face, faceIndex, uv, uv1, normal,
barycoord`, plus `instanceId` for `InstancedMesh`. `normal` is the interpolated vertex normal in
object space; transform with `normal.transformDirection(object.matrixWorld)` for world use.

Rules from the source:
- `Raycaster` does not check `visible`. Hidden meshes still get hit. Filter by layer, or skip hits
  whose object or ancestors are invisible.
- Single-sided materials are tested single-sided (`FrontSide` culls back faces in the ray test,
  `BackSide` tests only back faces). A page seen from below with `FrontSide` is not pickable from
  below.
- Raycasts use CPU positions. Shader displacement, skinning in shaders and the `onBeforeCompile`
  page bend are invisible to it. Deform interactive geometry on the CPU.
- Bounding spheres are computed once when `null`; update them after moving vertices.

## 3. Hit proxies

Pick against cheap stand-ins instead of detailed meshes:
- A box per diagram part (bigger than the part by a finger's margin on touch: about 8 mm on screen).
- One flat quad per page region (headings, terms, figure areas).
- A capsule along each energy flow.

```ts
import { Mesh, BoxGeometry, MeshBasicMaterial } from 'three';
const proxyMat = new MeshBasicMaterial();          // never rendered
export function addProxy(owner: Object3D, w: number, h: number, d: number, id: string): Mesh {
  const m = new Mesh(new BoxGeometry(w, h, d), proxyMat);
  m.visible = false;                               // not drawn, still raycast
  m.layers.set(1);                                 // pick layer; the camera keeps rendering layer 0
  m.userData.pickId = id;
  owner.add(m);                                    // follows the owner's transform and peel matrix
  return m;
}
```

Map hits back with `hit.object.userData.pickId`. Proxies parented to a peeling group inherit its
affine matrix, so a printed diagram is picked flat and a popped one in 3D, without extra code (keep
the peel matrix invertible: `minDepth > 0`).

## 4. UV hit-testing on a canvas texture

Use the hit's `uv` and the texture's own transform. `Texture.transformUv(uv)` applies `offset`,
`repeat`, `rotation`, the wrap mode and `flipY`, returning image-space coordinates (origin top-left).

```ts
import { Vector2, type CanvasTexture } from 'three';

export interface Region { id: string; x: number; y: number; w: number; h: number }  // canvas px

export function regionAt(hitUv: Vector2, tex: CanvasTexture, regions: readonly Region[]): Region | null {
  const uv = tex.transformUv(hitUv.clone());     // clone: transformUv mutates its argument
  const W = tex.image.width as number, H = tex.image.height as number;
  const px = uv.x * W, py = uv.y * H;
  for (const r of regions) if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return r;
  return null;
}
```

Register regions while drawing the canvas (the same code that draws a term records its rectangle),
so layout and hit areas never drift apart. For curved pages this still works because the UVs come
from the deformed CPU mesh.

## 5. Dragging in a plane

Drag objects across the desk, or drive a page turn from the pointer.

```ts
import { Plane, Vector3, type Ray } from 'three';

const deskPlane = new Plane(new Vector3(0, 1, 0), 0);      // y = 0
const _hit = new Vector3();

/** Page turn from the pointer: the free edge follows the pointer's x over the book. */
export function turnFromPointer(r: Ray, spineX: number, pageWidth: number): number | null {
  if (!r.intersectPlane(deskPlane, _hit)) return null;        // returns null when parallel or behind
  const x = (_hit.x - spineX) / pageWidth;                    // +1 at the right fore-edge, -1 at the left
  return Math.acos(Math.min(1, Math.max(-1, x)));             // 0 (flat right) .. PI (flat left)
}
```

For a generic drag, create the plane at pointer down through the hit point, either facing the camera
(`plane.setFromNormalAndCoplanarPoint(cameraDir.negate(), hit.point)`) or the surface (desk normal),
and apply the delta between successive `intersectPlane` results. Keep the offset between the grab
point and the object's origin so the object does not jump under the cursor.

On release, hand the current velocity to a spring or let `turn` settle to 0 or PI depending on
position and flick speed (for example: settle to PI when `turn > PI / 2` or when the angular velocity
exceeds 4 rad/s towards PI).

## 6. Wheel and trackpad

```ts
let zoomGoal = 0.62;
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();                                   // requires passive: false
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;  // lines, pages, pixels
  const dy = e.deltaY * unit;
  const k = e.ctrlKey ? 0.01 : 0.0015;                  // Chromium reports trackpad pinch as ctrl+wheel
  zoomGoal = Math.min(1.1, Math.max(0.25, zoomGoal * Math.exp(dy * k)));
  rig.goalDist = zoomGoal;                              // the rig damps toward it
  invalidate();
}, { passive: false });
```

Accumulate into a goal and damp; never apply wheel deltas directly to the camera. Multiplicative
zoom (`exp`) feels uniform at all distances. Mouse wheels send large discrete steps; trackpads send
many small ones; the damping hides the difference.

## 7. Touch: tap, long press, pinch

```ts
const touches = new Map<number, Vector2>();
let pinchStart = 0, distStart = 0, pressTimer = 0;

canvas.addEventListener('pointerdown', (e) => {
  touches.set(e.pointerId, new Vector2(e.clientX, e.clientY));
  if (touches.size === 1) pressTimer = window.setTimeout(() => onLongPress(e), 450);
  if (touches.size === 2) { const [a, b] = [...touches.values()]; pinchStart = a!.distanceTo(b!); distStart = rig.goalDist; clearTimeout(pressTimer); }
});
canvas.addEventListener('pointermove', (e) => {
  const p = touches.get(e.pointerId); if (!p) return;
  if (p.distanceTo(new Vector2(e.clientX, e.clientY)) > 8) clearTimeout(pressTimer);   // moved: not a press
  p.set(e.clientX, e.clientY);
  if (touches.size === 2 && pinchStart > 0) {
    const [a, b] = [...touches.values()];
    rig.goalDist = Math.min(1.1, Math.max(0.25, distStart * (pinchStart / a!.distanceTo(b!))));
  }
});
const lift = (e: PointerEvent) => { touches.delete(e.pointerId); clearTimeout(pressTimer); if (touches.size < 2) pinchStart = 0; };
canvas.addEventListener('pointerup', lift);
canvas.addEventListener('pointercancel', lift);
```

Long press opens the magnifier or a definition on touch where hover does not exist. Make touch
targets at least 44 CSS px (proxies can be larger than visuals).

## 8. Cursor feedback

```ts
let lastCursor = '';
export function setCursor(canvas: HTMLCanvasElement, c: 'default' | 'pointer' | 'grab' | 'grabbing' | 'zoom-in') {
  if (c !== lastCursor) { canvas.style.cursor = c; lastCursor = c; }   // style writes are not free
}
```

`pointer` over clickable terms and diagrams, `grab` over a page corner, `grabbing` while dragging,
`zoom-in` over magnifiable text. Give hover a visual answer too (a slight lift, ink darkening) and
delay hover-off by about 80 ms to avoid flicker on edges.

## 9. DOM overlays aligned to 3D

Labels, tooltips and the magnifier frame are DOM. Project world points each frame:

```ts
import { Vector3, type PerspectiveCamera } from 'three';
const _v = new Vector3();
export function placeLabel(el: HTMLElement, world: Vector3, camera: PerspectiveCamera, cssW: number, cssH: number) {
  _v.copy(world).project(camera);                       // NDC
  const visible = _v.z > -1 && _v.z < 1 && Math.abs(_v.x) <= 1.1 && Math.abs(_v.y) <= 1.1;
  el.style.opacity = visible ? '1' : '0';
  const x = (_v.x * 0.5 + 0.5) * cssW, y = (-_v.y * 0.5 + 0.5) * cssH;
  el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
}
```

Write all overlay styles in one batch after rendering, read nothing from the DOM in between
(reading layout after writing forces a synchronous reflow). For occlusion, raycast from the camera
to the label point once every few frames and fade the label when something is closer.
`CSS2DRenderer` (`three/addons/renderers/CSS2DRenderer.js`) automates this for `CSS2DObject`
children: `new CSS2DRenderer()`, `setSize(w, h)`, `render(scene, camera)`, and `object.center`
for the anchor; it does not occlude either.

## 10. Keyboard and assistive access

Every canvas interaction needs a DOM twin: a focusable button list (next page, previous page, open
diagram N, read term) with `aria-label`s that call the same intent functions. Arrow keys turn pages,
Enter opens the focused diagram, Escape closes the magnifier. Announce state changes in an
`aria-live="polite"` region ("Diagram 2 opened: heat flow from the lamp").

## Do

- Pick once per frame from the latest pointer state.
- Use proxies on a pick layer; keep them as children of what they stand for.
- Use `transformUv` for canvas hit-tests.
- Capture the pointer on drag start; handle `pointercancel`.

## Don't

- Don't rely on `visible = false` to exclude objects from raycasts.
- Don't raycast against high-poly visuals or merged scenery.
- Don't apply wheel deltas directly to the camera.
- Don't attach listeners per object.

## Pitfalls

- Clicks hit the wrong page after a turn: shader-bent geometry or stale bounding sphere.
- Drag stops at the canvas edge: missing `setPointerCapture`.
- Pinch also scrolls the page: missing `touch-action: none` or `passive: false` on wheel.
- Label jitters by a pixel: rounding mismatch; keep one decimal and use `translate3d`.

## Self-check (APIs used, verified in three r187 source)

- `Raycaster.setFromCamera`, `intersectObjects(objects, recursive, intersects)`, `layers`, `params.Line2`, `camera`; no `visible` test: `src/core/Raycaster.js`
- intersection fields `uv, uv1, normal, barycoord, face, faceIndex`; side handling; bounding sphere early-out: `src/objects/Mesh.js`
- `instanceId` on instanced hits: `src/objects/InstancedMesh.js`
- `params.Line2.threshold` and screen-space test: `examples/jsm/lines/LineSegments2.js`
- `Texture.transformUv` (matrix, wrapping, flipY): `src/textures/Texture.js`
- `Plane(normal, constant)`, `setFromNormalAndCoplanarPoint`, `Ray.intersectPlane(plane, target)` returning null: `src/math/Plane.js`, `src/math/Ray.js`
- `Vector3.project`, `transformDirection`, `Vector2.distanceTo`: `src/math/Vector3.js`, `Vector2.js`
- `Layers.set`, `Object3D.layers`, `userData`, `visible`: `src/core/Layers.js`, `src/core/Object3D.js`
- `CSS2DRenderer`, `CSS2DObject.center`: `examples/jsm/renderers/CSS2DRenderer.js`
- Pointer capture: MDN `Element.setPointerCapture` (checked 2026-11-22)
