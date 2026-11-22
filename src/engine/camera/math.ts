/**
 * Pure camera math: damping factors, orbit drag, clamp and spring back, spherical orbit application, the narrow
 * screen pull-back, the closed-to-reading blend, the lesson frame fit and the portrait framings. No allocation in
 * the per-frame functions: callers pass the output objects.
 */
import { Matrix4, Vector3 } from 'three';
import type { CameraPose } from '../contracts';

export type DampMode = 'still' | 'follow' | 'tour' | 'default';

/** Blend factor toward the target this frame. */
export function blendFactor(mode: DampMode, dt: number, c: { remain: number; tauTour: number; tauFollow: number }): number {
  switch (mode) {
    case 'still': return 1;
    case 'follow': return 1 - Math.exp(-dt / c.tauFollow);
    case 'tour': return 1 - Math.exp(-dt / c.tauTour);
    default: return 1 - Math.pow(c.remain, dt);
  }
}

export interface OrbitState { yaw: number; pitch: number; held: boolean; idle: number }

export interface OrbitLimits {
  yawPerPx: number; pitchPerPx: number; yawLimit: number; pitchMin: number; pitchMax: number;
  polarMin: number; polarMax: number; idleDelay: number; spring: number;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** A drag of dx, dy CSS pixels since the previous move: applied directly, clamped. Left drag raises yaw, down drag lowers pitch. */
export function orbitDrag(o: OrbitState, dx: number, dy: number, c: OrbitLimits): void {
  o.yaw = clamp(o.yaw - dx * c.yawPerPx, -c.yawLimit, c.yawLimit);
  o.pitch = clamp(o.pitch - dy * c.pitchPerPx, c.pitchMin, c.pitchMax);
}

/** After release: count idle time; once past the delay, decay yaw and pitch toward zero (still mode: at once). */
export function orbitRelax(o: OrbitState, dt: number, c: OrbitLimits, still: boolean): void {
  if (o.held) return;
  o.idle += dt;
  if (o.idle <= c.idleDelay) return;
  const k = still ? 1 : 1 - Math.exp(-c.spring * dt);
  o.yaw -= o.yaw * k;
  o.pitch -= o.pitch * k;
  if (Math.abs(o.yaw) < 1e-6) o.yaw = 0;
  if (Math.abs(o.pitch) < 1e-6) o.pitch = 0;
}

/**
 * The orbited camera position: the offset from look to pos as spherical (polar from +y, azimuth from +z toward +x),
 * azimuth + yaw, polar + pitch clamped to [min(polarMin, polar), max(polarMax, polar)]. The look point is not moved.
 */
export function orbitPosition(pos: Vector3, look: Vector3, yaw: number, pitch: number, c: { polarMin: number; polarMax: number }, out: Vector3): Vector3 {
  const ox = pos.x - look.x, oy = pos.y - look.y, oz = pos.z - look.z;
  const r = Math.hypot(ox, oy, oz);
  if (r < 1e-9) return out.copy(pos);
  const phi = Math.acos(clamp(oy / r, -1, 1));
  const theta = Math.atan2(ox, oz) + yaw;
  const p = clamp(phi + pitch, Math.min(c.polarMin, phi), Math.max(c.polarMax, phi));
  const s = Math.sin(p);
  return out.set(look.x + r * s * Math.sin(theta), look.y + r * Math.cos(p), look.z + r * s * Math.cos(theta));
}

/** Narrow-screen pull-back factor: below `aspect`, (aspect / a)^(exp), with a different exponent for portrait. */
export function narrowFactor(a: number, c: { aspect: number; expLandscape: number; expPortrait: number }): number {
  return a < c.aspect ? Math.pow(c.aspect / a, a < 1 ? c.expPortrait : c.expLandscape) : 1;
}

/** Moves pos away from look by factor k (in place). */
export function pullBack(pose: CameraPose, k: number): CameraPose {
  if (k !== 1) pose.pos.sub(pose.look).multiplyScalar(k).add(pose.look);
  return pose;
}

export const smoothstep01 = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

/** The reading framing before portrait rules: closed pose blended to the reading pose by smoothstep(clamp(position)). */
export function openingBlend(position: number, closed: CameraPose, read: CameraPose, out: CameraPose): CameraPose {
  const s = smoothstep01(position);
  out.pos.lerpVectors(closed.pos, read.pos, s);
  out.look.lerpVectors(closed.look, read.look, s);
  out.fov = closed.fov + (read.fov - closed.fov) * s;
  return out;
}

export type PageToWorld = (u: number, v: number, out: Vector3) => Vector3;

export interface FrameFit { v: number; u0: number; u1: number; step: number; lift: number; downU: number; downV: number }

const _a = new Vector3(), _b = new Vector3(), _x = new Vector3(), _y = new Vector3(), _z = new Vector3(), _o = new Vector3();

/**
 * Fits the lesson frame to the right page: samples a row of page points, fits a line through their (x, y), lifts
 * the origin above the highest bulge, takes X along the fitted line, Y out of the page and Z toward the reader.
 */
export function fitLessonFrame(pageToWorld: PageToWorld, c: FrameFit, out = new Matrix4()): Matrix4 {
  const n = Math.max(2, Math.floor((c.u1 - c.u0) / c.step) + 1);
  const xs = new Float64Array(n), ys = new Float64Array(n), zs = new Float64Array(n);
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) {
    pageToWorld(c.u0 + i * c.step, c.v, _a);
    xs[i] = _a.x; ys[i] = _a.y; zs[i] = _a.z;
    mx += _a.x; my += _a.y;
  }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
  }
  const m = sxx > 1e-12 ? sxy / sxx : 0;
  const line = (x: number) => my + m * (x - mx);
  let lift = 0;
  for (let i = 2; i < n; i++) lift = Math.max(lift, ys[i]! - line(xs[i]!));
  _o.set(xs[0]!, line(xs[0]!) + lift + c.lift, zs[0]!);
  const dxs = xs[n - 1]! - xs[0]!;
  _x.set(1, m, Math.abs(dxs) > 1e-9 ? (zs[n - 1]! - zs[0]!) / dxs : 0).normalize();
  pageToWorld(c.downU, c.v, _a);
  pageToWorld(c.downU, c.downV, _b);
  const down = _a.sub(_b).normalize();
  _y.crossVectors(down, _x).normalize();
  _z.crossVectors(_x, _y);
  return out.makeBasis(_x, _y, _z).setPosition(_o);
}

/** Pose written in a frame -> world pose (point transforms). */
export function framePose(frame: Matrix4, pos: readonly number[], look: readonly number[], fov: number, out: CameraPose): CameraPose {
  out.pos.set(pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0).applyMatrix4(frame);
  out.look.set(look[0] ?? 0, look[1] ?? 0, look[2] ?? 0).applyMatrix4(frame);
  out.fov = fov;
  return out;
}

export interface ModelBounds {
  /** World centre of the visible model. */
  center: Vector3;
  /** Model-local width (x), height (y) and depth (z). */
  size: Vector3;
}

/**
 * Portrait framing of a live lesson model: view direction from the frame, distance that fits width (with depth)
 * and height in the portrait field of view, look point lowered a little.
 */
export function portraitModelPose(frame: Matrix4, b: ModelBounds, aspect: number, c: { fov: number; dir: readonly number[]; widthFactor: number; depthFactor: number; heightFactor: number; lookDrop: number }, out: CameraPose): CameraPose {
  const half = ((c.fov / 2) * Math.PI) / 180;
  const hHalf = Math.atan(Math.tan(half) * aspect);
  const dist = Math.max((b.size.x / 2 / Math.tan(hHalf)) * c.widthFactor + b.size.z * c.depthFactor, (b.size.y / 2 / Math.tan(half)) * c.heightFactor);
  _a.set(c.dir[0] ?? 0, c.dir[1] ?? 0, c.dir[2] ?? 0).normalize().transformDirection(frame);
  _b.setFromMatrixColumn(frame, 1).normalize();
  out.look.copy(b.center).addScaledVector(_b, -c.lookDrop * b.size.y);
  out.pos.copy(out.look).addScaledVector(_a, dist);
  out.fov = c.fov;
  return out;
}

/** Portrait framing of a text page: look at a page point, back off along the reading direction to fit the half width. */
export function portraitPagePose(lookAt: Vector3, read: CameraPose, aspect: number, c: { fov: number; pageHalf: number; pageMargin: number }, out: CameraPose): CameraPose {
  const hHalf = Math.atan(Math.tan(((c.fov / 2) * Math.PI) / 180) * aspect);
  _a.subVectors(read.pos, read.look).normalize();
  out.look.copy(lookAt);
  out.pos.copy(lookAt).addScaledVector(_a, (c.pageHalf * c.pageMargin) / Math.tan(hHalf));
  out.fov = c.fov;
  return out;
}

export const vec = (a: readonly number[], out = new Vector3()) => out.set(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0);
export const makePose = (): CameraPose => ({ pos: new Vector3(), look: new Vector3(), fov: 30 });
export const copyPose = (src: CameraPose, out: CameraPose): CameraPose => {
  out.pos.copy(src.pos);
  out.look.copy(src.look);
  out.fov = src.fov;
  return out;
};
