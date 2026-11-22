import { describe, expect, it } from 'vitest';
import { BOOK_MOTIONS, cameraAt, riffleChangeAt, riffleDuration, riffleLeafAt } from './book-motion';

describe('notebook approach', () => {
  it('starts oblique, opens along the approach, and settles level', () => {
    const arrival = BOOK_MOTIONS.camera.lastFrame / BOOK_MOTIONS.camera.fps;
    expect(cameraAt(-1)).toEqual(cameraAt(0));
    expect(cameraAt(0)).toMatchObject({ opening: 0, reading: false, depth: -280, pitch: 21, yaw: -15 });
    expect(cameraAt(arrival / 2)).toMatchObject({ reading: true });
    expect(cameraAt(arrival / 2).opening).toBeGreaterThan(0);
    expect(cameraAt(arrival / 2).opening).toBeLessThan(1);
    expect(cameraAt(arrival)).toMatchObject({ opening: 1, reading: true, pitch: 0 });
    expect(Math.abs(cameraAt(arrival).depth)).toBe(0);
    expect(cameraAt(arrival + 1)).toEqual(cameraAt(arrival));
  });
});

describe('contents riffle', () => {
  it('stages each leaf before it reaches the spine and ends within the inspection clip', () => {
    expect(riffleLeafAt(0.085, 1, 1).visible).toBe(false);
    expect(riffleLeafAt(0.086, 1, 1).visible).toBe(true);
    expect(riffleLeafAt(riffleDuration(2), 1, 1).visible).toBe(false);
    expect(riffleDuration(7)).toBeCloseTo(1.06);
    expect(riffleDuration(7)).toBeLessThanOrEqual(BOOK_MOTIONS.riffle.lastFrame / BOOK_MOTIONS.riffle.fps);
    expect(riffleLeafAt(riffleChangeAt(7), 6, 1).angle).toBeCloseTo(-90);
  });

  it('mirrors the page and its flex when the direction reverses', () => {
    const forward = riffleLeafAt(0.24, 1, 1);
    const backward = riffleLeafAt(0.24, 1, -1);
    expect(forward.visible && backward.visible).toBe(true);
    expect(forward.angle + backward.angle).toBeCloseTo(-180);
    expect(backward.fold).toBe(-forward.fold);
    expect(riffleLeafAt(0.24, 0, 1).angle).not.toBe(forward.angle);
  });
});
