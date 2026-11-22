/**
 * The lesson frame: a matrix fitted to the right page of a spread along the hinge line. Lessons author every point in
 * it (x along the page, y up off the paper, z toward the reader, the model standing on y = 0 at z <= 0), and the same
 * frame drives the print camera, the peel hinge, the hero pose and the tour shots.
 */
import { Matrix4, Vector3 } from 'three';
import type { BookApi } from '../contracts';

export interface FrameParams {
  insetU: number;
  sampleStart: number;
  sampleEnd: number;
  sampleStep: number;
  maxU: number;
  baselineV: number;
  upU: number;
  upV: number;
  fitSkip: number;
  lift: number;
}

export type PageMapper = Pick<BookApi, 'pageToWorld'>;

const MAX_SAMPLES = 128;
const xs = new Float64Array(MAX_SAMPLES);
const ys = new Float64Array(MAX_SAMPLES);
const zs = new Float64Array(MAX_SAMPLES);
const p = new Vector3();
const q = new Vector3();
const ax = new Vector3();
const ay = new Vector3();
const az = new Vector3();
const down = new Vector3();

/** Page u of the frame origin: the first fit sample. */
export const frameOriginU = (t: FrameParams) => t.insetU + t.sampleStart;

/**
 * Samples the page along v = baselineV, fits a straight line through the samples' world (x, y), lifts it to the
 * highest bulge (ignoring the first `fitSkip` samples near the gutter) plus `lift`, and builds the basis.
 */
export function computeLessonFrame(book: PageMapper, spread: number, t: FrameParams, out = new Matrix4()): Matrix4 {
  const u0 = frameOriginU(t);
  const u1 = Math.min(t.maxU, t.insetU + t.sampleEnd);
  const step = Math.max(1e-3, t.sampleStep);
  const n = Math.min(MAX_SAMPLES, Math.max(2, Math.floor((u1 - u0) / step + 1e-9) + 1));
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) {
    book.pageToWorld(spread, 'right', u0 + i * step, t.baselineV, p);
    xs[i] = p.x; ys[i] = p.y; zs[i] = p.z;
    sx += p.x; sy += p.y;
  }
  const mx = sx / n, my = sy / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    sxx += dx * dx;
    sxy += dx * (ys[i]! - my);
  }
  const m = sxx > 1e-12 ? sxy / sxx : 0;
  const line = (x: number) => my + m * (x - mx);
  let g = 0;
  for (let i = Math.max(0, Math.round(t.fitSkip)); i < n; i++) g = Math.max(g, ys[i]! - line(xs[i]!));

  const dxAll = xs[n - 1]! - xs[0]!;
  ax.set(1, m, Math.abs(dxAll) > 1e-9 ? (zs[n - 1]! - zs[0]!) / dxAll : 0).normalize();
  book.pageToWorld(spread, 'right', t.upU, t.baselineV, p);
  book.pageToWorld(spread, 'right', t.upU, t.upV, q);
  down.subVectors(p, q).normalize();
  ay.crossVectors(down, ax).normalize();
  az.crossVectors(ax, ay).normalize();
  out.makeBasis(ax, ay, az);
  out.setPosition(xs[0]!, line(xs[0]!) + g + t.lift, zs[0]!);
  return out;
}

/** Transforms a lesson-frame point (array or vector) into world space. */
export function frameToWorld(frame: Matrix4, v: readonly number[] | Vector3, out = new Vector3()): Vector3 {
  if (v instanceof Vector3) out.copy(v);
  else out.set(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
  return out.applyMatrix4(frame);
}

/** Rotates a lesson-frame direction into world space (length kept). */
export function frameDirToWorld(frame: Matrix4, v: readonly number[], out = new Vector3()): Vector3 {
  return out.set(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0).transformDirection(frame).multiplyScalar(Math.hypot(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0));
}
