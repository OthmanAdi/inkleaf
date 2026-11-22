import { ease, type EaseName } from '../engine/core/ease';

export interface MotionClip {
  readonly label: string;
  readonly fps: number;
  readonly lastFrame: number;
}

export interface Keyframe {
  readonly frame: number;
  readonly value: number;
  readonly easeToNext?: EaseName;
}

export function frameAt(clip: MotionClip, frame: number): number {
  if (!Number.isFinite(frame)) return 0;
  return Math.max(0, Math.min(Math.round(frame), clip.lastFrame));
}

export function timeAt(clip: MotionClip, frame: number): number {
  return frameAt(clip, frame) / clip.fps;
}

/** Interpolate ordered keyframes. The first and last values hold outside the authored segment. */
export function sampleTrack(track: readonly [Keyframe, ...Keyframe[]], frame: number): number {
  let previous = track[0];
  if (frame <= previous.frame) return previous.value;

  for (const next of track.slice(1)) {
    if (frame <= next.frame) {
      const progress = (frame - previous.frame) / (next.frame - previous.frame);
      return previous.value + (next.value - previous.value) * ease(previous.easeToNext ?? 'linear', progress);
    }
    previous = next;
  }
  return previous.value;
}
