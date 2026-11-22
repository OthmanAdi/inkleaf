/**
 * Cut-away: a clip plane through an object, turned toward the camera, that removes its front half to reveal what
 * is inside. The target's materials become private copies (so other parts are not cut) and double-sided paper.
 */
import { Matrix3, Mesh, Vector3, Vector4, type Object3D } from 'three';
import { v3, type Part, type PartOptions, type Scope, type Vec3 } from './kit-core';
import type { InkMaterial } from './line-material';
import { InkLineSet } from './line-set';
import type { PaperMaterial } from './paper-material';

export interface CutawayOptions extends PartOptions {
  /** The part (or object) to cut open. */
  target: Part | Object3D;
  /** What is revealed inside (hidden until the cut is more than 35 % open). */
  inner?: Part | Object3D;
  /** Object radius in mm: the closed knife sits 1.4 x radius in front of the centre (default 12). */
  radius?: number;
  /** Keep the knife plane parallel to this axis (part space of the target), e.g. [0, 1, 0] for upright things. */
  lockAxis?: Vec3;
  /** Start open. */
  open?: boolean;
}

export interface Cutaway {
  id: string;
  open(on: boolean): void;
  toggle(): void;
  readonly isOpen: boolean;
  /** Opening level 0..1. */
  readonly k: number;
}

const groupOf = (x: Part | Object3D): Object3D => ((x as Part).group ? (x as Part).group : (x as Object3D));

/** Cuts the target open toward the camera on `open(true)`; eases at rate 6/s. */
export function cutaway(s: Scope, o: CutawayOptions): Cutaway {
  const pop = s.pop;
  const env = pop.env.cutaway;
  const target = groupOf(o.target);
  const inner = o.inner ? groupOf(o.inner) : null;
  const clips: Vector4[] = [];
  const innerSet = new Set<Object3D>();
  inner?.traverse((c) => innerSet.add(c));
  target.traverse((obj) => {
    if (innerSet.has(obj)) return;
    const mesh = obj as Mesh;
    if (!mesh.isMesh || mesh.name === 'flat-copy') return;
    const set = pop.sets.find((x) => x.mesh === mesh);
    if (set instanceof InkLineSet) {
      const old = set.material as InkMaterial;
      const m = pop.ink({ ...old.userData.inkOpts, widthPx: old.uniforms.uWidthPx!.value as number });
      set.setMaterial(m);
      clips.push(m.uniforms.uClip!.value as Vector4);
      return;
    }
    const pm = mesh.material as PaperMaterial;
    if (pm?.userData?.isPaper) {
      const m = pop.paper({ ...pm.userData.paperOpts, spacing: pm.userData.paper.uSpacing.value, doubleSided: true });
      mesh.material = m;
      clips.push(m.userData.paper.uClip.value);
    }
  });
  if (inner) inner.visible = false;
  let k = 0, goal = o.open ? 1 : 0;
  const lock = o.lockAxis ? v3(o.lockAxis).normalize() : null;
  const T = new Vector3(), P = new Vector3(), L = new Vector3(), nm = new Matrix3();
  pop.addUpdater((f) => {
    k = f.frozen ? goal : k + (goal - k) * (1 - Math.exp(-env.rate * f.dt));
    if (inner) inner.visible = k > env.innerAt;
    if (k <= 0.005) {
      for (const c of clips) c.set(0, 0, 0, -1);
      return;
    }
    target.getWorldPosition(P);
    T.copy(f.camera.position).sub(P);
    if (lock) {
      L.copy(lock).applyMatrix3(nm.setFromMatrix4(target.matrixWorld)).normalize();
      T.addScaledVector(L, -T.dot(L));
    }
    T.normalize();
    const n = (1 - k) * env.offset * (o.radius ?? 12);
    for (const c of clips) c.set(T.x, T.y, T.z, -(T.dot(P) + n));
  });
  const id = `${s.path}.${(o.id ?? s.root.nextId('cutaway')).toLowerCase()}`;
  const api: Cutaway = {
    id,
    open(on: boolean) {
      goal = on ? 1 : 0;
    },
    toggle() {
      goal = goal > 0.5 ? 0 : 1;
    },
    get isOpen() {
      return goal > 0.5;
    },
    get k() {
      return k;
    },
  };
  pop.ctx.registry.add({
    id, label: o.label ?? 'Cut-away', tags: ['effect', 'shader', 'input', 'ink', ...(o.tags ?? [])], kind: 'ink-cutaway',
    object: target, source: 'lesson figure module (ink kit)',
    describe: o.describe ?? 'A knife plane facing the camera that cuts the front half of an object away to show its inside.',
    params: [
      { key: 'open', label: 'Open', type: 'boolean', get: () => goal > 0.5, set: (v) => api.open(!!v) },
      { key: 'radius', label: 'Radius', type: 'number', unit: 'mm', min: 0.5, max: 200, get: () => o.radius ?? 12, set: (v) => void (o.radius = v as number) },
    ],
  });
  return api;
}
