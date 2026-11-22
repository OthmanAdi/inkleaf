/**
 * View-dependent outlines of round things, computed in the object's local space for two viewers: the camera (a
 * perspective eye position) and the print (a parallel view direction). These are the exact contour generators of
 * a sphere, a Y-axis cylinder and a Y-axis surface of revolution, so the outline follows the camera when the user
 * orbits. Outputs reuse the caller's arrays: no garbage per frame.
 */
import { Vector3, type Matrix4, type Object3D } from 'three';

/** Either a perspective eye position or a parallel view direction (pointing from the viewer into the scene), local space. */
export interface Viewer {
  eye?: Vector3 | null;
  dir?: Vector3 | null;
}

export type Lines = Vector3[][];

/** Grows `lines` to hold `count` lines and line `i` to hold `n` points; returns line `i`. */
export function slot(lines: Lines, i: number, n: number): Vector3[] {
  while (lines.length <= i) lines.push([]);
  const l = lines[i]!;
  while (l.length < n) l.push(new Vector3());
  l.length = n;
  return l;
}

const _o = new Vector3();
const _e1 = new Vector3();
const _e2 = new Vector3();
const _c = new Vector3();
const DOWN = new Vector3(0, -1, 0);
const XAXIS = new Vector3(1, 0, 0);

/**
 * Sphere of radius `r` at the local origin: one closed loop of `n` points (pass `closed: true` to the line set).
 * Returns the number of lines written to `out` (0 when the eye is inside the sphere).
 */
export function sphereSilhouette(r: number, viewer: Viewer, n: number, out: Lines): number {
  let rad = r;
  if (viewer.eye) {
    const D = viewer.eye.length();
    if (D <= r * 1.0001) {
      out.length = 0;
      return 0;
    }
    _o.copy(viewer.eye).divideScalar(D);
    _c.copy(_o).multiplyScalar((r * r) / D);
    rad = r * Math.sqrt(1 - (r * r) / (D * D));
  } else if (viewer.dir) {
    _o.copy(viewer.dir).negate().normalize();
    _c.set(0, 0, 0);
  } else {
    out.length = 0;
    return 0;
  }
  _e1.copy(DOWN).addScaledVector(_o, -DOWN.dot(_o));
  if (_e1.lengthSq() < 1e-8) _e1.copy(XAXIS).addScaledVector(_o, -XAXIS.dot(_o));
  _e1.normalize();
  _e2.crossVectors(_o, _e1);
  const line = slot(out, 0, n);
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n;
    const cs = Math.cos(t) * rad, sn = Math.sin(t) * rad;
    line[k]!.set(_c.x + cs * _e1.x + sn * _e2.x, _c.y + cs * _e1.y + sn * _e2.y, _c.z + cs * _e1.z + sn * _e2.z);
  }
  out.length = 1;
  return 1;
}

/**
 * Cylinder of radius `r` around the local Y axis between heights `y0` and `y1`: two vertical tangent segments, or
 * none when the eye is inside the cylinder's footprint.
 */
export function cylinderSilhouette(r: number, y0: number, y1: number, viewer: Viewer, out: Lines): number {
  let phi: number, half: number;
  if (viewer.eye) {
    const M = Math.hypot(viewer.eye.x, viewer.eye.z);
    if (M <= r) {
      out.length = 0;
      return 0;
    }
    phi = Math.atan2(viewer.eye.z, viewer.eye.x);
    half = Math.acos(r / M);
  } else if (viewer.dir) {
    phi = Math.atan2(-viewer.dir.z, -viewer.dir.x);
    half = Math.PI / 2;
  } else {
    out.length = 0;
    return 0;
  }
  for (let s = 0; s < 2; s++) {
    const th = phi + (s === 0 ? half : -half);
    const x = r * Math.cos(th), z = r * Math.sin(th);
    const l = slot(out, s, 2);
    l[0]!.set(x, y0, z);
    l[1]!.set(x, y1, z);
  }
  out.length = 2;
  return 2;
}

/** Profile slope `dr/dy` at each point from its neighbours (±1000 where the profile is horizontal). */
export function profileSlopes(profile: readonly (readonly [number, number])[], out: number[] = []): number[] {
  const n = profile.length;
  out.length = n;
  for (let i = 0; i < n; i++) {
    const a = profile[Math.max(0, i - 1)]!, b = profile[Math.min(n - 1, i + 1)]!;
    const dy = b[1] - a[1], dr = b[0] - a[0];
    out[i] = Math.abs(dy) < 1e-6 ? (dr < 0 ? -1000 : 1000) : dr / dy;
  }
  return out;
}

/**
 * Surface of revolution around the local Y axis with profile points `(r, y)`: for each side the continuous runs
 * (2+ points) of the contour generator. Runs end where the radius vanishes or the contour does not exist. Lines are
 * ordered by end of run, side + before side -, so two viewers' outputs are comparable for blending.
 */
export function latheSilhouette(profile: readonly (readonly [number, number])[], slopes: readonly number[], viewer: Viewer, out: Lines): number {
  let ex: number, ey: number, ez: number, persp: boolean;
  if (viewer.eye) {
    ex = viewer.eye.x;
    ey = viewer.eye.y;
    ez = viewer.eye.z;
    persp = true;
  } else if (viewer.dir) {
    ex = -viewer.dir.x;
    ey = -viewer.dir.y;
    ez = -viewer.dir.z;
    persp = false;
  } else {
    out.length = 0;
    return 0;
  }
  const M = Math.hypot(ex, ez);
  let count = 0;
  if (M < 1e-9) {
    out.length = 0;
    return 0;
  }
  const phi = Math.atan2(ez, ex);
  // run starts (index into profile) for side + and -; -1 = no run open
  let startP = -1, startM = -1;
  const flush = (end: number) => {
    // end is exclusive
    for (let s = 0; s < 2; s++) {
      const st = s === 0 ? startP : startM;
      if (st >= 0 && end - st >= 2) {
        const l = slot(out, count++, end - st);
        for (let i = st; i < end; i++) {
          const [r, y] = profile[i]!;
          const c = persp ? (r + slopes[i]! * (ey - y)) / M : (slopes[i]! * ey) / M;
          const th = phi + (s === 0 ? 1 : -1) * Math.acos(Math.max(-1, Math.min(1, c)));
          l[i - st]!.set(r * Math.cos(th), y, r * Math.sin(th));
        }
      }
    }
    startP = startM = -1;
  };
  for (let i = 0; i < profile.length; i++) {
    const [r, y] = profile[i]!;
    const c = persp ? (r + slopes[i]! * (ey - y)) / M : (slopes[i]! * ey) / M;
    const ok = r >= 1e-6 && Math.abs(c) <= 1;
    if (!ok) {
      flush(i);
      continue;
    }
    if (startP < 0) startP = i;
    if (startM < 0) startM = i;
  }
  flush(profile.length);
  out.length = count;
  return count;
}

/** Same number of lines and the same point count per line. */
export function sameStructure(a: Lines, b: Lines): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i]!.length !== b[i]!.length) return false;
  return true;
}

/**
 * The standing outline while lifting: element-wise blend from the print outline (lift 0) to the camera outline
 * (lift 1) when both have the same structure; otherwise the camera outline (the print one below lift 0.001).
 */
export function blendLines(print: Lines, camera: Lines, lift: number, out: Lines): Lines {
  const src = lift < 0.001 ? print : camera;
  if (lift < 0.001 || lift > 0.999 || !sameStructure(print, camera)) {
    for (let i = 0; i < src.length; i++) {
      const l = slot(out, i, src[i]!.length);
      for (let k = 0; k < l.length; k++) l[k]!.copy(src[i]![k]!);
    }
    out.length = src.length;
    return out;
  }
  for (let i = 0; i < camera.length; i++) {
    const a = print[i]!, b = camera[i]!;
    const l = slot(out, i, b.length);
    for (let k = 0; k < l.length; k++) l[k]!.lerpVectors(a[k]!, b[k]!, lift);
  }
  out.length = camera.length;
  return out;
}

/** Camera position in `obj`'s local space (obj.matrixWorld must be current). */
export function eyeInLocal(obj: Object3D, cameraWorld: Vector3, out: Vector3): Vector3 {
  return obj.worldToLocal(out.copy(cameraWorld));
}

const _inv = new Vector3();
/** The print view direction `(-cab.x, -cab.y, -1)` taken through the model frame and into `obj`'s local space. */
export function printDirInLocal(obj: Object3D, frame: Matrix4, cabX: number, cabY: number, out: Vector3, invWorld: Matrix4): Vector3 {
  _inv.set(-cabX, -cabY, -1).transformDirection(frame);
  invWorld.copy(obj.matrixWorld).invert();
  return out.copy(_inv).transformDirection(invWorld);
}
