/**
 * Bounds of the visible pop-up model, used by the portrait framing: the union of the geometry boxes of every
 * visible mesh under the pop group (meshes with invisible materials or hidden ancestors are skipped), in the pop
 * group's local space; the centre is returned in world space.
 */
import { Box3, Matrix4, Vector3, type Material, type Mesh, type Object3D } from 'three';
import type { ModelBounds } from './math';

const _box = new Box3(), _m = new Matrix4(), _inv = new Matrix4();

const visibleMaterial = (m: Material | Material[]) => (Array.isArray(m) ? m.some((x) => x.visible) : m.visible);

export function modelBounds(group: Object3D, out: ModelBounds = { center: new Vector3(), size: new Vector3() }): ModelBounds | null {
  group.updateWorldMatrix(true, true);
  _inv.copy(group.matrixWorld).invert();
  const acc = new Box3();
  const visit = (o: Object3D) => {
    if (!o.visible) return;
    const mesh = o as Mesh;
    if (mesh.isMesh && mesh.geometry && visibleMaterial(mesh.material)) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox && !mesh.geometry.boundingBox.isEmpty()) {
        _m.multiplyMatrices(_inv, mesh.matrixWorld);
        acc.union(_box.copy(mesh.geometry.boundingBox).applyMatrix4(_m));
      }
    }
    for (const c of o.children) visit(c);
  };
  visit(group);
  if (acc.isEmpty()) return null;
  acc.getSize(out.size);
  acc.getCenter(out.center).applyMatrix4(group.matrixWorld);
  return out;
}
