/**
 * One uniform block per pop model. Every ink and paper material of the pop spreads these same objects, so the
 * state machine writes once per frame and all materials follow.
 */
import { Matrix4, Vector2, type IUniform } from 'three';

export interface PopUniforms {
  /** Model frame (model -> world) and its inverse. */
  uScene: IUniform<Matrix4>;
  uSceneInv: IUniform<Matrix4>;
  /** Cabinet shear (x, y). */
  uCab: IUniform<Vector2>;
  /** Pen clock in seconds since the peel started. */
  uClock: IUniform<number>;
  /** Lift of the lines: 1 standing, 0 lying folded on the page. */
  uLiftAll: IUniform<number>;
  /** 1 while rendering the print. */
  uPrint: IUniform<number>;
  /** Pixels per mm of the print. */
  uPxPerMm: IUniform<number>;
  /** Drawing-buffer size in pixels. */
  uRes: IUniform<Vector2>;
  /** Lift of the paper surfaces. */
  uLiftSurf: IUniform<number>;
  /** Paper surface alpha (shade fades it in). */
  uSurfAlpha: IUniform<number>;
  /** Alpha of standing lines (fades out at the end of the undraw). */
  uStandAlpha: IUniform<number>;
  /** Alpha of the flat copy (fades in at the start of the peel). */
  uCopyAlpha: IUniform<number>;
}

export function createPopUniforms(frame: Matrix4, pxPerMm: number, cab: Vector2): PopUniforms {
  return {
    uScene: { value: frame.clone() },
    uSceneInv: { value: frame.clone().invert() },
    uCab: { value: cab.clone() },
    uClock: { value: 0 },
    uLiftAll: { value: 1 },
    uPrint: { value: 0 },
    uPxPerMm: { value: pxPerMm },
    uRes: { value: new Vector2(1, 1) },
    uLiftSurf: { value: 1 },
    uSurfAlpha: { value: 0 },
    uStandAlpha: { value: 1 },
    uCopyAlpha: { value: 1 },
  };
}
