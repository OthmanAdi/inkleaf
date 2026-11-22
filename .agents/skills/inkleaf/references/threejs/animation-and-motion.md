# Animation and motion: damping, springs, easing, timelines, state machines, camera rigs

Everything here is frame-rate independent: the same input produces the same motion at 30, 60, 120
and 144 Hz. Time comes from `THREE.Timer` (see `renderer-color-tone.md`), clamped to at most 50 ms
per frame.

## 1. Exponential damping (the workhorse)

```ts
/** Moves x toward target; tau = time constant in seconds (63 percent of the way after tau). */
export const damp = (x: number, target: number, tau: number, dt: number) =>
  x + (target - x) * (1 - Math.exp(-dt / tau));
```

- Half-life form: `tau = halfLife / Math.LN2`. A 90 ms half-life feels snappy, 250 ms feels heavy.
- 90 percent settle time is `2.3 * tau`; 99 percent is `4.6 * tau`.
- three has the same idea as `MathUtils.damp(x, y, lambda, dt) = lerp(x, y, 1 - exp(-lambda * dt))`,
  with `lambda = 1 / tau`.
- The classic `x += (target - x) * 0.1` per frame is frame-rate dependent: at 120 Hz it is twice as
  fast as at 60 Hz. Convert it: `tau = -frameDt / ln(1 - 0.1)`, so 0.1 per frame at 60 Hz is
  `tau = 0.158 s`.
- `OrbitControls` damping in r187 is per update call (`_sphericalDelta.theta *= 1 - dampingFactor`),
  so it is frame-rate dependent; its `update(deltaTime)` argument only scales auto-rotation.

Vectors, colours and rotations use the same factor:

```ts
import type { Vector3, Quaternion, Color } from 'three';
export function dampVec(v: Vector3, target: Vector3, tau: number, dt: number) { v.lerp(target, 1 - Math.exp(-dt / tau)); }
export function dampQuat(q: Quaternion, target: Quaternion, tau: number, dt: number) { q.slerp(target, 1 - Math.exp(-dt / tau)); }
export function dampColor(c: Color, target: Color, tau: number, dt: number) { c.lerp(target, 1 - Math.exp(-dt / tau)); }
/** Angles: damp along the shortest arc. */
export function dampAngle(a: number, target: number, tau: number, dt: number) {
  const d = Math.atan2(Math.sin(target - a), Math.cos(target - a));
  return a + d * (1 - Math.exp(-dt / tau));
}
```

Colour lerp happens in linear working space, which is what light mixing should do.

## 2. Springs

### Critically damped (no overshoot, exact, unconditionally stable)

```ts
export interface Spring1 { x: number; v: number }
/** omega in rad/s; settle (2 percent) is about 5.8 / omega. */
export function springCritical(s: Spring1, target: number, omega: number, dt: number): void {
  const y = s.x - target, e = Math.exp(-omega * dt), j = (s.v + omega * y) * dt;
  s.x = target + (y + j) * e;
  s.v = (s.v - omega * j) * e;
}
```

Derived from the closed form `x(t) = target + (y0 + (v0 + omega y0) t) e^(-omega t)`; exact for any
`dt`. Use it for camera follow, hover lift without bounce, cursor follow. It keeps velocity, so a
retarget mid-flight bends smoothly instead of restarting (exponential damping restarts from zero
velocity, which reads as a jolt on retarget).

### Under-damped (deliberate overshoot for pop-ups)

Parameters by feel: frequency `f` (Hz) and damping ratio `zeta`.
`omega = 2 PI f`, stiffness `k = omega^2`, damping `c = 2 zeta omega`.
Overshoot `= exp(-zeta PI / sqrt(1 - zeta^2))`: zeta 0.5 gives 16 percent, 0.7 gives 4.6 percent.
Settle time is about `4 / (zeta omega)`. Example: `k = 54, c = 7.2` means omega 7.35 rad/s, zeta 0.49,
about 17 percent overshoot, settled in about 1.1 s: a lively hover lift.

```ts
export function springUnder(s: Spring1, target: number, k: number, c: number, dt: number): void {
  const h = 1 / 240;                                 // fixed substep: stable and rate independent
  let t = dt;
  while (t > 1e-6) {
    const step = Math.min(h, t);
    s.v += (k * (target - s.x) - c * s.v) * step;     // semi-implicit Euler
    s.x += s.v * step;
    t -= step;
  }
}
```

A fixed substep gives identical curves at every display rate (a variable step of 1/30 shifts the
peak by a few percent). Stop simulating when `|x - target| < 1e-4` and `|v| < 1e-3`, and snap.

## 3. Easing functions (input and output in 0..1)

```ts
export const ease = {
  linear: (t: number) => t,
  smoothstep: (t: number) => t * t * (3 - 2 * t),
  smootherstep: (t: number) => t * t * t * (t * (6 * t - 15) + 10),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outQuart: (t: number) => 1 - (1 - t) ** 4,
  inOutQuart: (t: number) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2),
  outQuint: (t: number) => 1 - (1 - t) ** 5,
  outExpo: (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  outBack: (t: number, s = 1.70158) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2,
  inBack: (t: number, s = 1.70158) => (s + 1) * t ** 3 - s * t * t,
} as const;
```

Where they belong in a pop-up book:
- Page turn by click: `inOutCubic` over 0.7 to 0.9 s (cubic in-out gives weight at both ends).
- Peel-up: `outBack` on the hinge rotation only (overshoot about 10 percent with `s = 1.70158`),
  `outCubic` on depth inflation, staggered.
- Fold back to print: `inOutSine`, shorter (0.45 s); leaving should be quicker than arriving.
- Fade or colour changes: `smoothstep`.
- Entrance of many items: `outQuint` (1.2 to 1.4 s) with a 60 to 100 ms stagger.
- `MathUtils.smoothstep(x, min, max)` and `smootherstep` exist in three when you need the
  ranged form.

## 4. A minimal timeline with stagger and interruption

```ts
type Ease = (t: number) => number;
interface Track { start: number; dur: number; from: number; to: number; ease: Ease; set: (v: number) => void; done?: () => void }

export class Timeline {
  private t = 0;
  private tracks: Track[] = [];
  get busy() { return this.tracks.length > 0; }

  to(get: () => number, set: (v: number) => void, to: number, dur: number, ease: Ease, delay = 0, done?: () => void) {
    // interruption: start from the current value, never jump
    this.tracks.push({ start: this.t + delay, dur: Math.max(1e-4, dur), from: get(), to, ease, set, done });
    return this;
  }
  stagger<T>(items: readonly T[], key: (it: T) => number, each: number,
    make: (it: T, delay: number) => void) {
    [...items].sort((a, b) => key(a) - key(b)).forEach((it, i) => make(it, i * each)); // spatial order
    return this;
  }
  cancel(set: (v: number) => void) { this.tracks = this.tracks.filter((k) => k.set !== set); }
  update(dt: number): boolean {
    this.t += dt;
    this.tracks = this.tracks.filter((k) => {
      if (this.t < k.start) return true;
      const u = Math.min(1, (this.t - k.start) / k.dur);
      k.set(k.from + (k.to - k.from) * k.ease(u));
      if (u >= 1) { k.done?.(); return false; }
      return true;
    });
    return this.busy;                         // feed into the render-on-demand loop
  }
}
```

Interruption rule: cancel the old track for a property before adding a new one, and start from the
current value. If the property has momentum (a dragged page), hand over to a spring instead of a
tween so velocity carries. A tween's `from` is captured when the delay starts in this minimal
version; capture it at actual start if delays are long and values change meanwhile.

Spatial stagger beats index stagger: sort diagram parts by height above the page, distance from the
spine or reading order, so motion flows across the object.

## 5. State machines for interactive objects

```ts
export type DiagramState = 'printed' | 'peeling' | 'popped' | 'folding';
type DiagramEvent = 'open' | 'close' | 'peeled' | 'folded';

const next: Record<DiagramState, Partial<Record<DiagramEvent, DiagramState>>> = {
  printed: { open: 'peeling' },
  peeling: { peeled: 'popped', close: 'folding' },   // reversible mid-flight
  popped: { close: 'folding' },
  folding: { folded: 'printed', open: 'peeling' },
};

export class Diagram {
  state: DiagramState = 'printed';
  peel = 0;                                           // 0 printed .. 1 popped, continuous
  private vel = 0;
  send(e: DiagramEvent): boolean {
    const to = next[this.state][e];
    if (!to) return false;                            // ignored, never throws: UI can spam events
    this.state = to;
    return true;
  }
  update(dt: number, reduced: boolean): boolean {
    const target = this.state === 'peeling' || this.state === 'popped' ? 1 : 0;
    if (reduced) { this.peel = target; this.vel = 0; }
    else { const s = { x: this.peel, v: this.vel }; springUnder(s, target, 90, 13, dt); this.peel = s.x; this.vel = s.v; }
    if (this.state === 'peeling' && Math.abs(1 - this.peel) < 1e-3 && Math.abs(this.vel) < 1e-2) this.send('peeled');
    if (this.state === 'folding' && Math.abs(this.peel) < 1e-3 && Math.abs(this.vel) < 1e-2) { this.peel = 0; this.send('folded'); }
    return this.state === 'peeling' || this.state === 'folding';
  }
}
```

Keep the continuous value (`peel`) separate from the discrete state. Rendering reads only `peel`;
UI and sound read state changes. Every transition must be valid from the middle of the previous one.
Clamp the peel used for geometry to `[0, 1.12]` so overshoot never inverts the print. Expose
`state` and `peel` in the debug handle so tests can wait for `popped`.

## 6. Camera rig with look target, limits and spring-back

Build the rig from nested objects so each motion has its own transform:

```
rig (position = focus point, damped)
  yaw (rotation.y)
    pitch (rotation.x)
      dolly (position.z = distance)
        camera
```

```ts
import { Object3D, Vector3, type PerspectiveCamera } from 'three';

export class BookCameraRig {
  readonly root = new Object3D(); readonly yaw = new Object3D(); readonly pitch = new Object3D(); readonly dolly = new Object3D();
  focus = new Vector3(); goalFocus = new Vector3();
  az = 0; el = -0.95; dist = 0.62;                 // current
  goalAz = 0; goalEl = -0.95; goalDist = 0.62;     // targets set by input or by "frame this"
  limits = { az: [-0.6, 0.6] as const, el: [-1.35, -0.35] as const, dist: [0.25, 1.1] as const };
  private vAz = 0; private vEl = 0;

  constructor(camera: PerspectiveCamera) {           // then scene.add(rig.root)
    this.root.add(this.yaw); this.yaw.add(this.pitch); this.pitch.add(this.dolly); this.dolly.add(camera);
    camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0);
  }
  /** Drag input in radians; beyond a limit, resistance grows (rubber band). */
  drag(dAz: number, dEl: number): void {
    this.goalAz = rubber(this.goalAz + dAz, this.limits.az[0], this.limits.az[1]);
    this.goalEl = rubber(this.goalEl + dEl, this.limits.el[0], this.limits.el[1]);
  }
  release(): void {                                 // spring back inside the limits
    this.goalAz = clamp(this.goalAz, this.limits.az[0], this.limits.az[1]);
    this.goalEl = clamp(this.goalEl, this.limits.el[0], this.limits.el[1]);
  }
  update(dt: number): boolean {
    const a = { x: this.az, v: this.vAz }; springCritical(a, this.goalAz, 9, dt); this.az = a.x; this.vAz = a.v;
    const e = { x: this.el, v: this.vEl }; springCritical(e, this.goalEl, 9, dt); this.el = e.x; this.vEl = e.v;
    this.dist = damp(this.dist, clamp(this.goalDist, this.limits.dist[0], this.limits.dist[1]), 0.12, dt);
    this.focus.lerp(this.goalFocus, 1 - Math.exp(-dt / 0.15));
    this.root.position.copy(this.focus);
    this.yaw.rotation.y = this.az; this.pitch.rotation.x = this.el; this.dolly.position.z = this.dist;
    return Math.abs(this.az - this.goalAz) + Math.abs(this.el - this.goalEl) + Math.abs(this.dist - this.goalDist) > 1e-4
      || this.focus.distanceToSquared(this.goalFocus) > 1e-8;
  }
}
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
function rubber(x: number, lo: number, hi: number, k = 0.18): number {
  if (x < lo) { const o = lo - x; return lo - o / (1 + o / k); }
  if (x > hi) { const o = x - hi; return hi + o / (1 + o / k); }
  return x;
}
```

The camera always looks at the rig origin because it sits on the dolly axis; no `lookAt` per frame,
no gimbal surprises. Inside the rig `camera.position` is local (zero): use
`camera.getWorldPosition(v)` for distances and copy `camera.matrixWorld` when cloning the view. "Frame this diagram" sets `goalFocus` to the diagram's box centre and
`goalDist` from its size (see `geometry-and-deformation.md` section 8). Pointer parallax: add
`yaw` and `pitch` offsets of at most 0.03 rad from the pointer, damped with tau 0.2 s; disable it
under reduced motion.

## 7. Reduced motion

```ts
const mq = matchMedia('(prefers-reduced-motion: reduce)');
export const motion = { reduced: mq.matches, scale: mq.matches ? 0 : 1 };
mq.addEventListener('change', (e) => { motion.reduced = e.matches; motion.scale = e.matches ? 0 : 1; });
```

What changes under `reduced`:
- Page turns and peel-ups complete instantly or crossfade in at most 150 ms.
- No camera drift, parallax, idle bob or line boil (freeze `uInkBoil` at 0).
- Flow beads still convey direction but move slower, or show static arrows.
- Sounds tied to motion still play once (they confirm the action), at lower level.
- Provide a visible toggle as well; not every user sets the OS preference.

## Do

- Use time constants and spring parameters, never per-frame factors.
- Keep velocity across retargets (springs) for anything the user drags.
- Return "still moving" from every updater and render on demand.
- Stagger by spatial order; make every state reversible mid-flight.

## Don't

- Don't `lookAt` a moving target with a separately damped camera position; damp the target and
  derive the camera from the rig.
- Don't run springs with variable large steps.
- Don't trust `OrbitControls.dampingFactor` for rate independence.

## Pitfalls

- Motion feels different on a 120 Hz laptop: a per-frame lerp factor is hiding somewhere.
- Pop-up jitters at rest: spring never snaps; add the rest threshold.
- Retarget jolts: exponential damping where a spring was needed.
- Tween fights a drag: the old track was not cancelled.

## Self-check (APIs used, verified in three r187 source)

- `MathUtils.damp(x, y, lambda, dt)`, `smoothstep(x, min, max)`, `smootherstep`, `lerp`, `clamp`: `src/math/MathUtils.js`
- `OrbitControls` damping implementation and `update(deltaTime)` scope: `examples/jsm/controls/OrbitControls.js` (lines 695 to 802)
- `Timer` for dt: `src/core/Timer.js`
- `Vector3.lerp`, `distanceToSquared`, `Quaternion.slerp`, `Color.lerp`: `src/math/Vector3.js`, `Quaternion.js`, `Color.js`
- `Object3D.add`, `rotation`, `position`: `src/core/Object3D.js`
- `matchMedia('(prefers-reduced-motion: reduce)')`: MDN prefers-reduced-motion (checked 2026-11-22)
