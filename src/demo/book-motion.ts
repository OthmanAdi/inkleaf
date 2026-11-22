import { BOOT_TABLE, RIFFLE_TABLE } from '../engine/book/scheduler';
import { ease, window01 } from '../engine/core/ease';
import type { MotionClip } from '../motion/frames';

const cameraDuration = BOOT_TABLE.duration[0];
const leafDuration = RIFFLE_TABLE.leafDuration[0];
const stagger = RIFFLE_TABLE.stagger[0];
const maxLeaves = 7;
const fps = 60;

export const BOOK_MOTIONS = {
  camera: { label: 'Camera arrival', fps, lastFrame: Math.ceil(cameraDuration * fps) },
  riffle: { label: 'Contents page riffle', fps, lastFrame: Math.ceil((leafDuration + (maxLeaves - 1) * stagger) * fps) },
} as const satisfies Record<string, MotionClip>;

export type BookMotionId = keyof typeof BOOK_MOTIONS;

export function cameraAt(seconds: number) {
  const progress = window01(seconds, 0, cameraDuration);
  const approach = ease('inOutSine', progress);
  const distance = 1 - approach;
  const arc = Math.sin(Math.PI * approach) * distance;
  return {
    progress,
    opening: ease('inOutCubic', window01(progress, 0.16, 0.94)),
    reading: progress >= 0.32,
    x: -22 * distance + 44 * arc,
    y: 46 * distance - 45 * arc,
    depth: -280 * distance,
    pitch: 21 * distance - 7 * arc,
    yaw: -15 * distance + 11 * arc,
    roll: -7 * distance + 2 * arc,
  };
}

export function riffleDuration(count: number) {
  return leafDuration + (count - 1) * stagger;
}

export function riffleLeafAt(seconds: number, index: number, direction: -1 | 1) {
  const time = window01(seconds, index * stagger, riffleDuration(index + 1));
  const progress = ease('inOutQuad', time);
  const turn = direction === 1 ? progress : 1 - progress;
  const flex = 22 * Math.sin(Math.PI * progress) * (1 - 2 * progress);
  return {
    visible: time > 0 && time < 1,
    angle: -180 * turn - direction * flex,
    fold: direction * flex,
    lift: (index + 1) * 2.5,
  };
}

export function riffleChangeAt(count: number) {
  return (count - 1) * stagger + leafDuration / 2;
}
