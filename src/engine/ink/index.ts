/**
 * Ink and the pop-up life cycle: pen lines of constant screen width, paper surfaces with engraved hatching, the
 * printed page image, the print -> peel -> shade -> live -> undraw state machine and the authoring kit.
 *
 *   import { ink } from './engine/ink';
 *   const pop = ink.createPop(ctx, { frame, spread: 2, id: 'lesson-1.pop' });
 *   const k = ink.kit(pop, { prefix: 'lesson-1', pen: 'lesson-1' });
 *   k.box({ id: 'crate', min: [0, 0, -30], max: [20, 12, -10] });
 *   pop.renderPrint(); ... pop.draw(); ... await pop.undraw();
 */
import { createPop } from './pop';
import { kit } from './kit';
import { createPen, PEN_PRESETS } from './pen';
import { inkEnv, bindInk } from './params';

export { createPop, PopModel, type PopCreateOptions, type PopFrame, type PopUpdater } from './pop';
export { kit, Kit, type KitOptions, type GroupOptions, type LaterOptions, type DynamicOptions, type StrokesOptions } from './kit';
export type { Part, PartOptions, StrokeStyle, TimeSpec, InkSpec, PaperSpec, Vec3 } from './kit-core';
export { Pen, createPen, PEN_PRESETS, PEN_DEFAULTS, type PenOptions, type PenPreset } from './pen';
export { InkLineSet, type InkLineSetOptions } from './line-set';
export { createInkMaterial, createFlatMaterial, LINE_VERTEX, LINE_FRAGMENT, type InkMaterial, type InkMaterialOptions } from './line-material';
export { createPaperMaterial, createFadingShadowMaterial, HATCH_GLSL, alongOf, setHatchDir, type PaperMaterial, type PaperOptions } from './paper-material';
export { PrintRenderer, ObliqueCamera, PRINT_RECT, obliqueProject, printPageRect, type PrintRect, type PrintOptions } from './print';
export { popWorld, foldModel, foldParts, FOLD_GLSL, FOLD_DEFAULTS, type FoldParams } from './fold';
export { peelAt, shadeAt, undrawAt, undrawDuration, TIMING_DEFAULTS, type PopTimings } from './lifecycle';
export { hash, noise1, noise3, smooth, S01, smoothstep } from './noise';
export { widthProfile, resample, polylineLength, STROKE_DEFAULTS, FloatBuf, type StrokeParams } from './stroke';
export {
  sphereSilhouette, cylinderSilhouette, latheSilhouette, profileSlopes, blendLines, eyeInLocal, printDirInLocal, type Viewer, type Lines,
} from './silhouette';
export { LiveOutline, densify } from './shapes';
export { roundCorners, arcPoints, planeBasis } from './marks';
export { glyph, textWidth, FONT_CHARS } from './font';
export { fitText, SERIF, HAND, type CardPart, type TagPart, type CardText } from './cards';
export { type JarPart, type JarOptions } from './jar';
export { type RingPart, type RingOptions } from './rings';
export { type Cutaway, type CutawayOptions } from './cutaway';
export { inkEnv, bindInk, type InkEnv } from './params';
export { createPopUniforms, type PopUniforms } from './uniforms';

/** The ink package as one object: `ink.createPop(ctx, ...)`, `ink.kit(pop, ...)`. */
export const ink = { createPop, kit, pen: createPen, presets: PEN_PRESETS, env: inkEnv, bind: bindInk } as const;
