import { describe, expect, it } from 'vitest';
import { Color, Matrix4, Object3D, PointLight, SpotLight, Vector3 } from 'three';
import type { GlowSource } from '../contracts';
import { COOKIE_DEFAULTS, cookieBytes, cookieValue } from './cookie';
import { deskGeometry, padGeometry } from './desk';
import { buildRoom } from './environment';
import { SpillSlots } from './spill-lights';

const src = (id: string, strength: number, x = 0): GlowSource => ({ id, strength, position: new Vector3(x, 50, 0), color: new Color(1, 0.5, 0) });

describe('spill light slots', () => {
  const make = () => {
    const lights = [new PointLight(), new PointLight(), new PointLight()];
    return { lights, slots: new SpillSlots(lights) };
  };

  it('fades a newcomer in with k = h on its first frame', () => {
    const { lights, slots } = make();
    const dt = 1 / 60;
    const h = 1 - Math.exp(-12 * dt);
    slots.update([src('a', 1)], dt);
    expect(slots.slots[0]!.id).toBe('a');
    expect(lights[0]!.intensity).toBeCloseTo(2600 * h, 6);
    for (let i = 0; i < 120; i++) slots.update([src('a', 1)], dt);
    expect(lights[0]!.intensity).toBeCloseTo(2600, 0);
  });

  it('copies position and colour of the source', () => {
    const { lights, slots } = make();
    slots.update([src('a', 0.5, 42)], 0.1);
    expect(lights[0]!.position.x).toBe(42);
    expect(lights[0]!.color.g).toBe(0.5);
  });

  it('takes the top three, ignores weak sources, cuts vanished ones at once', () => {
    const { lights, slots } = make();
    const list = [src('a', 0.9), src('b', 0.8), src('c', 0.7), src('d', 0.6), src('e', 0.005)];
    slots.update(list, 0.1);
    expect(slots.slots.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    slots.update([src('b', 0.8), src('c', 0.7)], 0.1);
    expect(slots.slots[0]!.id).toBe(null);
    expect(lights[0]!.intensity).toBe(0);
  });

  it('keeps an incumbent within the hysteresis bonus and fades a loser out', () => {
    const { slots } = make();
    slots.update([src('a', 0.5), src('b', 0.5), src('c', 0.5)], 0.1);
    slots.update([src('a', 0.5), src('b', 0.5), src('c', 0.5), src('d', 0.65)], 0.1);
    expect(slots.slots.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    const before = slots.slots[2]!.k;
    slots.update([src('a', 0.5), src('b', 0.5), src('c', 0.5), src('d', 0.75)], 0.1);
    expect(slots.slots[2]!.k).toBeLessThan(before);
    expect(slots.holds('d')).toBe(false);
    for (let i = 0; i < 40; i++) slots.update([src('a', 0.5), src('b', 0.5), src('c', 0.5), src('d', 0.75)], 0.05);
    expect(slots.holds('c')).toBe(false);
    expect(slots.holds('d')).toBe(true);
  });

  it('ignores negative dt', () => {
    const { lights, slots } = make();
    slots.update([src('a', 1)], -1);
    expect(lights[0]!.intensity).toBe(0);
  });
});

describe('window cookie', () => {
  it('is fully open inside a pane and dark on the bars and outside the frame', () => {
    expect(cookieValue(191, 567)).toBe(1);
    expect(cookieValue(0, 400)).toBeLessThan(0.002);
    expect(cookieValue(300, 0)).toBe(0);
    expect(cookieValue(800, 400)).toBe(0);
    expect(cookieValue(300, -1000)).toBe(0);
    expect(cookieValue(15, 400)).toBeCloseTo(0.5, 6);
  });

  it('maps desk points through the key light so the bar cross lands at (-560, -210)', () => {
    const key = new SpotLight('#ffffff', 1, 0, 0.36, 0.35, 0);
    const dir = new Vector3(-0.6, 0.66, -0.48).normalize();
    key.target.position.set(0, -12.575, 20);
    key.position.copy(key.target.position).addScaledVector(dir, 2300);
    expect(key.position.x).toBeCloseTo(-1362.402, 2);
    key.shadow.camera.near = 1400;
    key.shadow.camera.far = 3300;
    key.updateMatrixWorld(true);
    key.target.updateMatrixWorld(true);
    key.shadow.updateMatrices(key);
    const cam = key.shadow.camera;
    expect(cam.fov).toBeCloseTo(41.253, 3);
    const unproject = new Matrix4().multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse);
    const bytes = cookieBytes(unproject, key.position, key.target.position, -12.575);
    const sample = (x: number, z: number) => {
      const p = new Vector3(x, -12.575, z).project(cam);
      const c = Math.floor((p.x + 1) / 2 * COOKIE_DEFAULTS.size);
      const r = Math.floor((p.y + 1) / 2 * COOKIE_DEFAULTS.size);
      return bytes[(r * COOKIE_DEFAULTS.size + c) * 4]!;
    };
    expect(sample(-560, -210)).toBeLessThan(10);
    expect(sample(100, 0)).toBe(255);
    expect(sample(-190, 91)).toBeLessThan(60);
  });
});

describe('desk and pad geometry', () => {
  it('builds the pad with the measured 852 vertices, spanning y 0..2.5', () => {
    const g = padGeometry();
    expect(g.attributes.position!.count).toBe(852);
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.min.y).toBeCloseTo(0, 6);
    expect(b.max.y).toBeCloseTo(2.5, 6);
    expect(b.max.x).toBeCloseTo(320, 6);
    expect(b.max.z).toBeCloseTo(215, 6);
  });

  it('writes millimetre UVs on the pad and tile UVs on the desk', () => {
    const pad = padGeometry();
    const i = 5;
    expect(pad.attributes.uv!.getX(i)).toBeCloseTo(pad.attributes.position!.getX(i), 6);
    expect(pad.attributes.uv!.getY(i)).toBeCloseTo(pad.attributes.position!.getZ(i), 6);
    const desk = deskGeometry();
    expect(desk.attributes.uv!.getX(0)).toBeCloseTo(-4000 / 1400, 6);
    expect(desk.attributes.uv!.getY(0)).toBeCloseTo(-4000 / 900, 6);
  });
});

describe('room environment scene', () => {
  it('places the window at the key direction x 2400 facing the origin', () => {
    const room = buildRoom();
    const win = room.children[2] as Object3D;
    expect(win.position.x).toBeCloseTo(-1421.6, 0);
    expect(win.position.y).toBeCloseTo(1563.8, 0);
    expect(win.position.z).toBeCloseTo(-1137.3, 0);
    expect(win.children).toHaveLength(5);
    const bounce = room.children[3] as Object3D;
    expect(bounce.position.x).toBeCloseTo(1606.8, 0);
  });
});
