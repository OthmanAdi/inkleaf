import { describe, expect, it } from 'vitest';
import { BoxGeometry, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';
import { DragPlane, TOUCH_PROBES, clientToNdc, pickTargets } from './pointer';

const rect = { left: 0, top: 0, width: 1600, height: 900 };

function camera() {
  const c = new PerspectiveCamera(30, 16 / 9, 1, 9000);
  c.position.set(0, 0, 500);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld(true);
  return c;
}

describe('figure pointer mapping', () => {
  it('tries 13 touch probes up to 14 px from the finger', () => {
    expect(TOUCH_PROBES).toHaveLength(13);
    expect(TOUCH_PROBES[0]).toEqual([0, 0]);
    expect(Math.max(...TOUCH_PROBES.map(([x, y]) => Math.hypot(x, y)))).toBe(14);
  });

  it('converts client pixels to normalised device coordinates', () => {
    expect(clientToNdc(800, 450, rect).toArray()).toEqual([0, 0]);
    expect(clientToNdc(0, 0, rect).toArray()).toEqual([-1, 1]);
  });

  it('finds a small target near a finger that a mouse at the same spot misses', () => {
    const cam = camera();
    const target = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial({ visible: false }));
    target.updateMatrixWorld(true);
    const rc = new Raycaster();
    const ndc = new Vector2();
    // The box spans about 7 px on screen at 500 mm; 10 px to its right a mouse misses and the probe (-10, 0) hits.
    expect(pickTargets(rc, cam, [target], { x: 810, y: 450, pointerType: 'mouse' }, rect, 1, ndc)).toBeNull();
    const hit = pickTargets(rc, cam, [target], { x: 810, y: 450, pointerType: 'touch' }, rect, 1, ndc);
    expect(hit?.object).toBe(target);
    expect(ndc.x).toBeCloseTo(0, 9);
  });

  it('drags on the upright lesson plane through the press point', () => {
    const cam = camera();
    cam.position.set(0, 300, 300);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    const plane = new DragPlane();
    const frame = new Matrix4().makeTranslation(0, 0, -36);
    plane.begin(new Vector3(5, 20, -36), frame, cam, 'frame-z');
    const rc = new Raycaster();
    rc.setFromCamera(new Vector2(0.1, 0.2), cam);
    const p = plane.intersect(rc, new Vector3());
    expect(p!.z).toBeCloseTo(-36, 6);
    plane.begin(new Vector3(5, 20, -36), frame, cam, 'camera');
    const q = plane.intersect(rc, new Vector3())!;
    const toCam = new Vector3(0, 300, 300).normalize();
    expect(q.clone().sub(new Vector3(5, 20, -36)).dot(toCam)).toBeCloseTo(0, 6);
  });
});
