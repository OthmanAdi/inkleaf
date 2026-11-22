/**
 * The pop-up fold. At lift 0 a model is its own cabinet-oblique drawing lying on the page (depth folded into the
 * shear); as lift grows the drawing rotates up about the hinge (the model-frame X axis) like a card standing up,
 * and the true depth unfolds only at the very end (weight lift⁸). The same math runs on the GPU (`FOLD_GLSL`) for
 * lines and paper surfaces, and here on the CPU for tests, picking and layout.
 */
import type { Matrix4, Vector3 } from 'three';
import { S01 } from './noise';

export interface FoldParams {
  /** Depth unfold weight exponent: λ = lift^exponent. */
  exponent: number;
  /** The folded drawing never sinks below the paper: y >= floor + floorLift·lift (mm). */
  floor: number;
  floorLift: number;
  /** Above this lift the fold is the identity. */
  identityAbove: number;
}

export const FOLD_DEFAULTS: FoldParams = { exponent: 8, floor: 0.06, floorLift: 0.02, identityAbove: 0.9995 };

export interface FoldParts {
  /** Rotation of the drawing about the hinge, radians (0 lying, π/2 standing). */
  angle: number;
  /** Depth unfold weight λ. */
  lambda: number;
  /** Clamped lift. */
  u: number;
}

/** Angle and depth weight for a lift value. */
export function foldParts(lift: number, p: FoldParams = FOLD_DEFAULTS): FoldParts {
  const u = Math.min(1, Math.max(0, lift));
  return { u, angle: (Math.PI / 2) * S01(u), lambda: Math.pow(u, p.exponent) };
}

/**
 * Folds a model-frame point `(x, y, z)` for a lift; writes the folded model-frame point into `out`.
 * `cab` is the cabinet shear (x, y), default (0.12, 0.32).
 */
export function foldModel(x: number, y: number, z: number, lift: number, cabX: number, cabY: number, out: { x: number; y: number; z: number }, p: FoldParams = FOLD_DEFAULTS): typeof out {
  if (lift > p.identityAbove) {
    out.x = x;
    out.y = y;
    out.z = z;
    return out;
  }
  const { u, angle, lambda } = foldParts(lift, p);
  const d = Math.max(0, -z);
  const X = x + (1 - lambda) * d * cabX;
  const Y = y + (1 - lambda) * d * cabY;
  const s = Math.sin(angle), c = Math.cos(angle);
  out.x = X;
  out.y = Y * s - lambda * d * c;
  out.z = -Y * c - lambda * d * s;
  out.y = Math.max(out.y, p.floor + p.floorLift * u);
  return out;
}

/** World-space version: `uScene · fold(uSceneInv · w)`. Mutates and returns `w`. */
export function popWorld(w: Vector3, lift: number, scene: Matrix4, sceneInv: Matrix4, cabX: number, cabY: number, p: FoldParams = FOLD_DEFAULTS): Vector3 {
  if (lift > p.identityAbove) return w;
  w.applyMatrix4(sceneInv);
  foldModel(w.x, w.y, w.z, lift, cabX, cabY, w, p);
  return w.applyMatrix4(scene);
}

/**
 * GLSL for the fold. Needs `uScene`, `uSceneInv` (mat4), `uCab` (vec2) and `uFoldK`
 * (exponent, floor, floorLift, identityAbove) declared by the includer.
 */
export const FOLD_GLSL = /* glsl */ `
vec3 popWorld(vec3 w, float lift) {
  if (lift > uFoldK.w) return w;
  vec3 q = (uSceneInv * vec4(w, 1.0)).xyz;
  float d = max(0.0, -q.z);
  float u = clamp(lift, 0.0, 1.0);
  float a = 1.5707963267948966 * u * u * (3.0 - 2.0 * u);
  float lam = u <= 0.0 ? 0.0 : pow(u, uFoldK.x);
  float X = q.x + (1.0 - lam) * d * uCab.x;
  float Y = q.y + (1.0 - lam) * d * uCab.y;
  float sa = sin(a), ca = cos(a);
  vec3 r = vec3(X, Y * sa - lam * d * ca, -Y * ca - lam * d * sa);
  r.y = max(r.y, uFoldK.y + uFoldK.z * u);
  return (uScene * vec4(r, 1.0)).xyz;
}
`;
