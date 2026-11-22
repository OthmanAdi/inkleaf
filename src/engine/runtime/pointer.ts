/**
 * Pointer to figure mapping: picking a lesson's target meshes (with extra probes around a finger) and turning a
 * pointer into the `PointerInfo` a figure receives, on a drag plane fixed at press time.
 */
import { Matrix4, Plane, Vector2, Vector3, type Camera, type Intersection, type Object3D, type Raycaster } from 'three';
import type { PointerInfo } from '../contracts';
import type { RectLike } from './deps';

/** Client-pixel offsets tried in order for touch; the first hit wins. Mouse and pen use only the first. */
export const TOUCH_PROBES: readonly (readonly [number, number])[] = [
  [0, 0], [10, 0], [-10, 0], [0, 10], [0, -10], [8, 8], [-8, 8], [8, -8], [-8, -8], [14, 0], [-14, 0], [0, 14], [0, -14],
];

export function clientToNdc(x: number, y: number, rect: RectLike, out = new Vector2()): Vector2 {
  const w = rect.width || 1, h = rect.height || 1;
  return out.set(((x - rect.left) / w) * 2 - 1, -((y - rect.top) / h) * 2 + 1);
}

const scratchHits: Intersection[] = [];

/** Raycasts the targets (not their children) at the pointer, with the touch probes for `pointerType === 'touch'`. */
export function pickTargets(
  raycaster: Raycaster, camera: Camera, targets: readonly Object3D[],
  at: { x: number; y: number; pointerType?: string }, rect: RectLike, probeScale: number, ndcOut: Vector2,
): Intersection | null {
  if (!targets.length) return null;
  const count = at.pointerType === 'touch' ? TOUCH_PROBES.length : 1;
  for (let i = 0; i < count; i++) {
    const [dx, dy] = TOUCH_PROBES[i]!;
    clientToNdc(at.x + dx * probeScale, at.y + dy * probeScale, rect, ndcOut);
    raycaster.setFromCamera(ndcOut, camera);
    scratchHits.length = 0;
    raycaster.intersectObjects(targets as Object3D[], false, scratchHits);
    const hit = scratchHits[0];
    if (hit) {
      scratchHits.length = 0;
      return hit;
    }
  }
  return null;
}

const axis = new Vector3();
const hitPoint = new Vector3();

/** The plane a drag moves on, chosen at press time through the press point. */
export class DragPlane {
  readonly plane = new Plane();
  private readonly cameraPlane = new Plane();

  /** `frame-z`: the upright plane of the lesson frame (normal = frame z, toward the reader); `camera`: facing the camera. */
  begin(point: Vector3, frame: Matrix4, camera: Camera, mode: string): void {
    camera.getWorldDirection(axis).negate();
    this.cameraPlane.setFromNormalAndCoplanarPoint(axis, point);
    if (mode === 'camera') {
      this.plane.copy(this.cameraPlane);
      return;
    }
    axis.setFromMatrixColumn(frame, 2).normalize();
    this.plane.setFromNormalAndCoplanarPoint(axis, point);
  }

  /** Where the ray meets the plane; the camera-facing plane when the ray runs along the upright plane. */
  intersect(raycaster: Raycaster, out: Vector3): Vector3 | null {
    const ray = raycaster.ray;
    if (Math.abs(this.plane.normal.dot(ray.direction)) > 1e-4 && ray.intersectPlane(this.plane, out)) return out;
    return ray.intersectPlane(this.cameraPlane, out);
  }
}

/** A fresh `PointerInfo` (figures may keep it). */
export function makePointerInfo(world: Vector3, ndc: Vector2, frameInverse: Matrix4): PointerInfo {
  return { world: world.clone(), local: hitPoint.copy(world).applyMatrix4(frameInverse).clone(), ndc: ndc.clone() };
}
