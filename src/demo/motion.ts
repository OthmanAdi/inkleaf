import { sampleTrack, type Keyframe, type MotionClip } from '../motion/frames';

export const DEMO_MOTIONS = {
  turn: { label: 'Page turn', fps: 60, lastFrame: 54 },
  popup: { label: 'Diagram unfolds', fps: 60, lastFrame: 42 },
  swing: { label: 'Pendulum swing', fps: 60, lastFrame: 180 },
} as const satisfies Record<string, MotionClip>;

export type DemoMotionId = keyof typeof DEMO_MOTIONS;

const page: readonly [Keyframe, Keyframe] = [
  { frame: 0, value: 0, easeToNext: 'inOutSine' },
  { frame: DEMO_MOTIONS.turn.lastFrame, value: -180 },
];

const stand: readonly [Keyframe, Keyframe, Keyframe] = [
  { frame: 0, value: 0, easeToNext: 'inQuad' },
  { frame: 14, value: 0.2, easeToNext: 'outCubic' },
  { frame: DEMO_MOTIONS.popup.lastFrame, value: 1 },
];

export function pageTurnAt(progress: number): { angleDeg: number } {
  return { angleDeg: sampleTrack(page, progress * DEMO_MOTIONS.turn.lastFrame) };
}

export function popupAt(progress: number): { lift: number } {
  return { lift: sampleTrack(stand, progress * DEMO_MOTIONS.popup.lastFrame) };
}

export const MAGNIFIER_SWEEP = { label: 'Magnifier sweep', fps: 60, lastFrame: 48 } as const;

export function magnifierAt(frame: number): { x: number; y: number } {
  return {
    x: sampleTrack([
      { frame: 0, value: 0.36, easeToNext: 'inOutSine' },
      { frame: MAGNIFIER_SWEEP.lastFrame, value: 0.64 },
    ], frame),
    y: sampleTrack([
      { frame: 0, value: 0.39, easeToNext: 'inOutSine' },
      { frame: 24, value: 0.62, easeToNext: 'inOutSine' },
      { frame: MAGNIFIER_SWEEP.lastFrame, value: 0.54 },
    ], frame),
  };
}

export function magnifierZoomAt(frame: number): number {
  return sampleTrack([
    { frame: 0, value: 1.7, easeToNext: 'inOutSine' },
    { frame: 24, value: 2.25, easeToNext: 'inOutSine' },
    { frame: MAGNIFIER_SWEEP.lastFrame, value: 2 },
  ], frame);
}
