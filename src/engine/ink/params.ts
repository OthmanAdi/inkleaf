/**
 * Every number of the ink look and the pop-up life cycle as a named, live parameter (`ink.*` in the registry),
 * plus the shared uniform objects the shaders read. One set per registry, created on first use; every pop and
 * material of that world shares them, so `inkleaf.set('ink.hatch', 'coverage', 0.7)` changes all paper at once.
 */
import { Color, Vector3, Vector4, type IUniform } from 'three';
import type { EngineContext, QualityTier } from '../contracts';
import type { Registry } from '../core/registry';
import { tunable, type Tuned } from '../core/tune';
import { FOLD_DEFAULTS, type FoldParams } from './fold';
import { TIMING_DEFAULTS, type PopTimings } from './lifecycle';
import { PEN_DEFAULTS, PEN_PRESETS } from './pen';
import { STROKE_DEFAULTS, type StrokeParams } from './stroke';

const SRC = 'src/engine/ink/params.ts';

function defs(registry: Registry) {
  const lineListeners = new Set<() => void>();
  const state = { tier: 'high' as QualityTier };
  let ready = false;
  const u = {
    uLineA: { value: new Vector4() },
    uLineB: { value: new Vector4() },
    uLineC: { value: new Vector4() },
    uMinW: { value: 0 },
    uFoldK: { value: new Vector4() },
    uHatchK0: { value: new Vector4() },
    uHatchK1: { value: new Vector4() },
    uHatchK2: { value: new Vector4() },
    uHatchK3: { value: new Vector4() },
    uHatchK4: { value: new Vector4() },
    uHatchK5: { value: new Vector4() },
    uHatchK6: { value: new Vector4() },
    uPaperK0: { value: new Vector4() },
    uPaperK1: { value: new Vector4() },
    uIllus: { value: new Vector3(-0.5, 0.78, 0.36).normalize() },
    uHatchQ: { value: 1 },
  } satisfies Record<string, IUniform>;

  const line = tunable(registry, {
    id: 'ink.line', label: 'Pen line', kind: 'shader-params', tags: ['ink', 'shader', 'material'], source: 'src/engine/ink/line-material.ts',
    describe: 'The pen line shader: standing lines keep a constant on-screen width; lines lying on the page are 0.34 mm wide like printed ink.',
    params: {
      widthPx: { value: 1.5, min: 0.2, max: 8, step: 0.05, unit: 'px', help: 'Default standing line width before the line scale (materials made without their own width).' },
      lineScale: { value: 1.32, min: 0.2, max: 4, step: 0.01, help: 'Every material width is multiplied by this.' },
      widthScale: { value: 1, min: 0.1, max: 4, step: 0.01, help: 'Global extra multiplier on every standing line width (1 = as measured).' },
      widthMm: { value: 0.34, min: 0.05, max: 2, step: 0.01, unit: 'mm', help: 'Width of lines lying flat on the page and in the print.' },
      standLift: { value: 0.35, min: 0.01, max: 1, step: 0.01, help: 'Lift at which a line has fully switched from mm width to screen width.' },
      aaMargin: { value: 1, min: 0, max: 3, step: 0.1, unit: 'px', help: 'Anti-alias margin added to the ribbon on each side.' },
      miterCap: { value: 2.5, min: 1, max: 8, step: 0.1, help: 'Largest miter extension at sharp corners.' },
      miterFloor: { value: 0.4, min: 0.05, max: 1, step: 0.01, help: 'Floor of the miter denominator.' },
      flipDot: { value: -0.6, min: -1, max: 0, step: 0.01, help: 'Corners sharper than this (dot of tangents) use the outgoing tangent instead of a miter.' },
      subPixel: { value: 0.5, min: 0.1, max: 2, step: 0.05, unit: 'px', help: 'Half widths below this fade in alpha instead of thinning.' },
      flatDepth: { value: 0.995, min: 0.9, max: 0.9999, step: 0.0001, help: 'Clip depth the flat copy is forced to (nearest), so nothing hides it.' },
      visFadeFrom: { value: 0.02, min: 0, max: 1, step: 0.01, help: 'Lift where lines hidden in the print begin to show.' },
      visFadeTo: { value: 0.3, min: 0, max: 1, step: 0.01, help: 'Lift where lines hidden in the print are fully shown.' },
      minCoverage: { value: 0.003, min: 0, max: 0.1, step: 0.001, help: 'Fragments with less ink coverage are discarded.' },
      bias: { value: 2, min: 0, max: 10, step: 0.05, unit: 'mm', help: 'Default view-space pull toward the eye (stops lines z-fighting with their surface).' },
      color: { value: '#1c2433', help: 'Default ink colour.' },
      opacity: { value: 1, min: 0, max: 1, step: 0.01, help: 'Default ink opacity.' },
    },
    onChange: () => ready && syncLine(),
  });
  const syncLine = () => {
    u.uLineA.value.set(line.lineScale * line.widthScale, line.widthMm, line.standLift, line.aaMargin);
    u.uLineB.value.set(line.miterCap, line.miterFloor, line.flipDot, line.subPixel);
    u.uLineC.value.set(line.flatDepth, line.visFadeFrom, line.visFadeTo, line.minCoverage);
    lineListeners.forEach((fn) => fn());
  };

  const stroke = tunable(registry, {
    id: 'ink.stroke', label: 'Stroke shape and pressure', kind: 'stroke-params', tags: ['ink'], source: 'src/engine/ink/stroke.ts',
    describe: 'How a pen stroke is built: resample step, pressure noise, tapered ends and wobble. Applies to strokes built after the change.',
    params: {
      maxSeg: { value: STROKE_DEFAULTS.maxSeg, min: 0.2, max: 10, step: 0.1, unit: 'mm', help: 'Longest segment after resampling.' },
      base: { value: STROKE_DEFAULTS.base, min: 0, max: 2, step: 0.01, help: 'Pressure base weight.' },
      slow: { value: STROKE_DEFAULTS.slow, min: 0, max: 2, step: 0.01, help: 'Slow pressure variation amplitude.' },
      slowWave: { value: STROKE_DEFAULTS.slowWave, min: 1, max: 200, step: 1, unit: 'mm', help: 'Slow pressure wavelength.' },
      fine: { value: STROKE_DEFAULTS.fine, min: 0, max: 1, step: 0.01, help: 'Fine pressure variation amplitude.' },
      fineWave: { value: STROKE_DEFAULTS.fineWave, min: 0.5, max: 100, step: 0.5, unit: 'mm', help: 'Fine pressure wavelength.' },
      fineSeed: { value: STROKE_DEFAULTS.fineSeed, min: 0, max: 1000, step: 1, help: 'Seed offset of the fine layer.' },
      taperFloor: { value: STROKE_DEFAULTS.taperFloor, min: 0, max: 1, step: 0.01, help: 'Stroke ends start at this fraction of full weight.' },
      taperLength: { value: STROKE_DEFAULTS.taperLength, min: 0.1, max: 40, step: 0.1, unit: 'mm', help: 'Length over which a tapered end reaches full weight.' },
      wobbleWave: { value: STROKE_DEFAULTS.wobbleWave, min: 1, max: 200, step: 1, unit: 'mm', help: 'Wavelength of the optional wobble noise.' },
      defaultDur: { value: 0.5, min: 0.01, max: 5, step: 0.01, unit: 's', help: 'Duration of a stroke added without a pen or explicit time.' },
    },
  });

  const hatch = tunable(registry, {
    id: 'ink.hatch', label: 'Engraved hatching', kind: 'shader-params', tags: ['shader', 'ink', 'paper', 'effect'], source: 'src/engine/ink/paper-material.ts',
    describe: 'Engraver hatching on paper surfaces: one layer on sides turned from the illustration light, a cross layer only in shadow. Hatch lines keep their width on screen.',
    params: {
      coverage: { value: 0.58, min: 0, max: 1, step: 0.01, help: 'How much ink a hatch line lays down (0.58 = 58 % ink).' },
      wobble: { value: 0.32, min: 0, max: 2, step: 0.01, help: 'How far hatch lines meander, in line spacings.' },
      wobbleFreq: { value: 0.06, min: 0.001, max: 1, step: 0.001, unit: '1/mm', help: 'Meander noise frequency.' },
      breakScale: { value: 13, min: 1, max: 100, step: 0.5, unit: 'mm', help: 'Along-line scale of the small gaps in hatch lines.' },
      dutyMin: { value: 0.05, min: 0, max: 0.5, step: 0.005, help: 'Far-away half width (fraction of a spacing) at the lightest hatch.' },
      dutyMax: { value: 0.2, min: 0, max: 0.5, step: 0.005, help: 'Far-away half width at the darkest hatch.' },
      pxMin: { value: 0.55, min: 0.1, max: 4, step: 0.05, unit: 'px', help: 'Close-up half width at the lightest hatch.' },
      pxMax: { value: 1.25, min: 0.1, max: 4, step: 0.05, unit: 'px', help: 'Close-up half width at the darkest hatch.' },
      aa: { value: 0.7, min: 0, max: 3, step: 0.05, help: 'Anti-alias width in screen derivatives.' },
      breakThreshold: { value: 0.1, min: 0, max: 1, step: 0.01, help: 'Gaps where the per-line noise drops below this.' },
      breakHash: { value: 2.31, min: 0, max: 20, step: 0.01, help: 'Per-line offset of the gap noise.' },
      crossSpacing: { value: 1.12, min: 0.5, max: 3, step: 0.01, help: 'Cross-hatch spacing as a multiple of the main spacing.' },
      fineFrom: { value: 0.11, min: 0, max: 1, step: 0.005, help: 'Screen derivative where an extra line between each pair starts (close-ups).' },
      fineTo: { value: 0.05, min: 0, max: 1, step: 0.005, help: 'Screen derivative where the extra lines are full.' },
      fineDarkness: { value: 0.85, min: 0, max: 1, step: 0.01, help: 'Darkness of the extra close-up lines.' },
      moireGain: { value: 1.7, min: 0, max: 4, step: 0.05, help: 'Dense lines blend to this multiple of their half width (moire guard).' },
      moireFrom: { value: 0.3, min: 0, max: 2, step: 0.01, help: 'Screen derivative where the moire guard starts.' },
      moireTo: { value: 0.7, min: 0, max: 2, step: 0.01, help: 'Screen derivative where the moire guard is full.' },
      overlap: { value: 0.25, min: 0, max: 1, step: 0.01, help: 'Weight of the weaker layer where both layers cross.' },
      mask1From: { value: 0.28, min: 0, max: 1, step: 0.01, help: 'Darkness where the main hatch layer appears.' },
      mask1To: { value: 0.45, min: 0, max: 1, step: 0.01, help: 'Darkness where the main hatch layer is full.' },
      dark1From: { value: 0.3, min: 0, max: 1, step: 0.01, help: 'Darkness where main hatch lines start to thicken.' },
      mask2From: { value: 0.8, min: 0, max: 1, step: 0.01, help: 'Darkness where the cross-hatch appears (shadow only).' },
      mask2To: { value: 0.92, min: 0, max: 1, step: 0.01, help: 'Darkness where the cross-hatch is full.' },
      dark2From: { value: 0.82, min: 0, max: 1, step: 0.01, help: 'Darkness where cross-hatch lines start to thicken.' },
      seedCross: { value: 5, min: 0, max: 100, step: 1, help: 'Seed offset of the cross layer.' },
      seedFine: { value: 3, min: 0, max: 100, step: 1, help: 'Seed offset of the close-up layer.' },
      breakSeed: { value: 0.37, min: 0, max: 5, step: 0.01, help: 'Seed scale of the gap noise.' },
    },
    onChange: () => ready && syncHatch(),
  });
  const syncHatch = () => {
    u.uHatchK0.value.set(hatch.coverage, hatch.wobble, hatch.wobbleFreq, hatch.breakScale);
    u.uHatchK1.value.set(hatch.dutyMin, hatch.dutyMax, hatch.pxMin, hatch.pxMax);
    u.uHatchK2.value.set(hatch.aa, hatch.breakThreshold, hatch.breakHash, hatch.crossSpacing);
    u.uHatchK3.value.set(hatch.fineFrom, hatch.fineTo, hatch.fineDarkness, hatch.moireGain);
    u.uHatchK4.value.set(hatch.moireFrom, hatch.moireTo, hatch.overlap, hatch.mask1From);
    u.uHatchK5.value.set(hatch.mask1To, hatch.dark1From, hatch.mask2From, hatch.mask2To);
    u.uHatchK6.value.set(hatch.dark2From, hatch.seedCross, hatch.seedFine, hatch.breakSeed);
  };

  const paper = tunable(registry, {
    id: 'ink.paper', label: 'Paper surfaces', kind: 'material-params', tags: ['material', 'paper', 'shader'], source: 'src/engine/ink/paper-material.ts',
    describe: 'Paper-white model surfaces: a soft form term from the illustration light, halved in the key light shadow, plus glow colour spilling onto the paper. Defaults apply to paper made after the change.',
    params: {
      color: { value: '#fbf7ee', help: 'Default paper colour.' },
      hatchA: { value: [0.62, 0.74, 0.45], help: 'Default main hatch plane normal (object space, normalised).' },
      hatchB: { value: [-0.7, 0.4, 0.6], help: 'Default cross-hatch plane normal.' },
      spacing: { value: 1.7, min: 0.2, max: 10, step: 0.05, unit: 'mm', help: 'Default hatch line spacing.' },
      shade: { value: 0.16, min: 0, max: 1, step: 0.01, help: 'Default darkening of the paper tone on dark sides.' },
      form: { value: 0.82, min: 0, max: 1, step: 0.01, help: 'Weight of N·L in the form term.' },
      formFloor: { value: 0.18, min: 0, max: 1, step: 0.01, help: 'Form term floor (sides facing away).' },
      shadowFactor: { value: 0.5, min: 0, max: 1, step: 0.01, help: 'The form term is multiplied by this in the key light shadow.' },
      keyVisFrom: { value: 0.12, min: 0, max: 1, step: 0.01, help: 'Key light visibility below which a point counts as fully shadowed.' },
      keyVisTo: { value: 0.7, min: 0, max: 1, step: 0.01, help: 'Key light visibility above which a point counts as fully lit.' },
      spillGain: { value: 0.9, min: 0, max: 4, step: 0.01, help: 'How strongly coloured point-light spill tints the paper.' },
      gain: { value: 1, min: 0, max: 2, step: 0.01, help: 'Overall paper brightness.' },
    },
    onChange: () => ready && syncPaper(),
  });
  const syncPaper = () => {
    u.uPaperK0.value.set(paper.form, paper.formFloor, paper.shadowFactor, paper.spillGain);
    u.uPaperK1.value.set(paper.keyVisFrom, paper.keyVisTo, paper.gain, 0);
  };

  const illus = tunable(registry, {
    id: 'ink.illustration-light', label: 'Illustration light', kind: 'shader-light', tags: ['light', 'shader', 'ink'], source: 'src/engine/ink/params.ts',
    describe: 'The direction (world) the hatching treats as lit; converted to view space every frame, so hatching stays on the object while its lit side is fixed in the world.',
    params: {
      direction: { value: [-0.5, 0.78, 0.36], help: 'World direction toward the illustration light (normalised).' },
    },
  });

  const fold = tunable(registry, {
    id: 'ink.fold', label: 'Pop-up fold', kind: 'shader-params', tags: ['shader', 'animation', 'ink'], source: 'src/engine/ink/fold.ts',
    describe: 'How the drawing lying on the page rotates up about the hinge and unfolds its depth (weight lift^exponent).',
    params: {
      exponent: { value: FOLD_DEFAULTS.exponent, min: 1, max: 32, step: 0.5, help: 'Depth unfold exponent: depth appears only at the very end of the lift.' },
      floor: { value: FOLD_DEFAULTS.floor, min: 0, max: 2, step: 0.01, unit: 'mm', help: 'Lowest height above the paper while folded.' },
      floorLift: { value: FOLD_DEFAULTS.floorLift, min: 0, max: 2, step: 0.01, unit: 'mm', help: 'Extra floor height at full lift.' },
      identityAbove: { value: FOLD_DEFAULTS.identityAbove, min: 0.9, max: 1, step: 0.0001, help: 'Above this lift the fold is skipped.' },
    },
    onChange: () => ready && syncFold(),
  });
  const syncFold = () => u.uFoldK.value.set(fold.exponent, fold.floor, fold.floorLift, fold.identityAbove);

  const print = tunable(registry, {
    id: 'ink.print', label: 'Printed page image', kind: 'render-params', tags: ['texture', 'ink', 'paper', 'camera'], source: 'src/engine/ink/print.ts',
    describe: 'The flat print: an oblique orthographic render of the model (layer 1) into a texture the right page multiplies onto the paper. Applies to pops made after the change, except printOffsetU.',
    params: {
      pxPerMm: { value: 6, min: 1, max: 16, step: 0.5, unit: 'px/mm', help: 'Print resolution (6 gives 1080 x 1200).' },
      x0: { value: -10, min: -100, max: 100, step: 1, unit: 'mm', help: 'Print rect left edge in the model frame.' },
      x1: { value: 170, min: 0, max: 400, step: 1, unit: 'mm', help: 'Print rect right edge.' },
      y0: { value: -4, min: -100, max: 100, step: 1, unit: 'mm', help: 'Print rect bottom edge (reader side of the hinge).' },
      y1: { value: 196, min: 0, max: 400, step: 1, unit: 'mm', help: 'Print rect top edge.' },
      samples: { value: 4, min: 0, max: 8, step: 1, help: 'MSAA samples of the print target.' },
      cabX: { value: 0.12, min: -1, max: 1, step: 0.01, help: 'Cabinet shear x: receding edges go right by this per mm of depth.' },
      cabY: { value: 0.32, min: -1, max: 1, step: 0.01, help: 'Cabinet shear y: receding edges go up by this per mm of depth.' },
      cameraZ: { value: 1000, min: 10, max: 10000, step: 10, unit: 'mm', help: 'Print camera height above the hinge plane.' },
      near: { value: 1, min: 0.01, max: 100, step: 0.1, unit: 'mm', help: 'Print camera near plane.' },
      far: { value: 2000, min: 100, max: 20000, step: 10, unit: 'mm', help: 'Print camera far plane.' },
      visScale: { value: 0.5, min: 0.1, max: 1, step: 0.05, help: 'Resolution of the hidden-line depth pass relative to the print (540 x 600).' },
      visBias: { value: 2, min: 0, max: 20, step: 0.1, unit: 'mm', help: 'Depth tolerance of the hidden-line test.' },
      printOffsetU: { value: 0, min: -20, max: 20, step: 0.5, unit: 'mm', help: 'Shift of the print on the page relative to the model frame origin (0 = print and pop-up agree; -6 reproduces the measured 6 mm discrepancy).' },
    },
  });

  const timing = tunable(registry, {
    id: 'ink.timing', label: 'Print, peel, shade, live, undraw', kind: 'animation', tags: ['animation', 'ink'], source: 'src/engine/ink/lifecycle.ts',
    describe: 'Timings of the pop-up life cycle: the print fades into flat lines as the pen redraws the figure standing up, then paper fades in; leaving folds it back down.',
    params: {
      printFade: { value: TIMING_DEFAULTS.printFade, min: 0.01, max: 3, step: 0.01, unit: 's', help: 'Peel: printed image fades into the flat line copy (1 - smoothstep).' },
      shade: { value: TIMING_DEFAULTS.shade, min: 0.01, max: 3, step: 0.01, unit: 's', help: 'Paper surfaces fade in after the last stroke (smoothstep).' },
      undrawSurfaces: { value: TIMING_DEFAULTS.undrawSurfaces, min: 0.01, max: 3, step: 0.01, unit: 's', help: 'Leave: surfaces fade out (linear).' },
      undrawFold: { value: TIMING_DEFAULTS.undrawFold, min: 0.01, max: 3, step: 0.01, unit: 's', help: 'Leave: fold back into the page (1 - smoothstep).' },
      printReturnFrom: { value: TIMING_DEFAULTS.printReturnFrom, min: 0, max: 0.99, step: 0.01, help: 'Fold progress where the printed image starts returning.' },
      liveClock: { value: TIMING_DEFAULTS.liveClock, min: 10, max: 1e7, step: 1, unit: 's', help: 'Pen clock used in live (past every stroke).' },
      printClock: { value: TIMING_DEFAULTS.printClock, min: 10, max: 1e8, step: 1, unit: 's', help: 'Pen clock while rendering the print.' },
      colorEps: { value: TIMING_DEFAULTS.colorEps, min: 0, max: 0.1, step: 0.0005, help: 'Surface alpha above which paper writes colour.' },
      shadowEps: { value: TIMING_DEFAULTS.shadowEps, min: 0, max: 0.1, step: 0.0005, help: 'Surface alpha above which surfaces cast shadows.' },
    },
  });

  const pen = tunable(registry, {
    id: 'ink.pen', label: 'Pen stroke timing', kind: 'animation', tags: ['animation', 'ink'], source: 'src/engine/ink/pen.ts',
    describe: 'Default pen: strokes start `gap` seconds apart and last length/speed clamped to min..max. Applies to pens made after the change.',
    params: {
      speed: { value: PEN_DEFAULTS.speed, min: 10, max: 5000, step: 5, unit: 'mm/s', help: 'Pen speed.' },
      gap: { value: PEN_DEFAULTS.gap, min: 0, max: 1, step: 0.001, unit: 's', help: 'Seconds between stroke starts.' },
      min: { value: PEN_DEFAULTS.min, min: 0, max: 2, step: 0.01, unit: 's', help: 'Shortest stroke.' },
      max: { value: PEN_DEFAULTS.max, min: 0.01, max: 5, step: 0.01, unit: 's', help: 'Longest stroke.' },
    },
  });
  const presets: Record<string, Tuned<{ speed: { value: number }; gap: { value: number }; min: { value: number }; max: { value: number }; fit: { value: number } }>> = {};
  for (const [name, p] of Object.entries(PEN_PRESETS)) {
    presets[name] = tunable(registry, {
      id: `ink.pen.${name}`, label: `Pen preset ${name}`, kind: 'pen-preset', tags: ['animation', 'ink', 'data'], source: 'src/engine/ink/pen.ts',
      describe: p.help,
      params: {
        speed: { value: p.speed, min: 10, max: 5000, step: 5, unit: 'mm/s' },
        gap: { value: p.gap, min: 0, max: 1, step: 0.001, unit: 's' },
        min: { value: p.min, min: 0, max: 2, step: 0.01, unit: 's' },
        max: { value: p.max, min: 0.01, max: 5, step: 0.01, unit: 's' },
        fit: { value: p.fit ?? 0, min: 0, max: 10, step: 0.01, unit: 's', help: 'Pen body is fitted to this many seconds (0 = no fit).' },
      },
    });
  }

  const quality = tunable(registry, {
    id: 'ink.quality', label: 'Ink quality tiers', kind: 'quality', tags: ['quality', 'effect', 'ink'], source: 'src/engine/ink/params.ts',
    describe: 'Per tier: hatch gaps and cross-hatching on or off, and the thinnest line width still drawn outside the print.',
    params: {
      hatchHigh: { value: 1, min: 0, max: 1, step: 1, help: 'Hatch breaks and cross-hatch on the high tier.' },
      hatchMedium: { value: 1, min: 0, max: 1, step: 1, help: 'On the medium tier.' },
      hatchLow: { value: 0, min: 0, max: 1, step: 1, help: 'On the low tier.' },
      minWidthHigh: { value: 0, min: 0, max: 2, step: 0.01, help: 'Lines with a base width below this are hidden outside the print (high).' },
      minWidthMedium: { value: 0, min: 0, max: 2, step: 0.01, help: 'Medium tier.' },
      minWidthLow: { value: 0.62, min: 0, max: 2, step: 0.01, help: 'Low tier.' },
    },
    onChange: () => ready && applyTier(state.tier),
  });
  const applyTier = (tier: QualityTier) => {
    state.tier = tier;
    u.uHatchQ.value = tier === 'low' ? quality.hatchLow : tier === 'medium' ? quality.hatchMedium : quality.hatchHigh;
    u.uMinW.value = tier === 'low' ? quality.minWidthLow : tier === 'medium' ? quality.minWidthMedium : quality.minWidthHigh;
  };

  const order = tunable(registry, {
    id: 'ink.render-order', label: 'Ink render order', kind: 'render-order', tags: ['ink', 'data'], source: 'src/engine/ink/params.ts',
    describe: 'Draw order inside the pop-up: paper first (it writes depth even while invisible, which hides back lines), then standing lines, flat copies and rings.',
    params: {
      surfaces: { value: 2, min: -100, max: 100, step: 1 },
      lines: { value: 10, min: -100, max: 100, step: 1 },
      flat: { value: 11, min: -100, max: 100, step: 1 },
      rings: { value: 12, min: -100, max: 100, step: 1 },
    },
  });

  const ring = tunable(registry, {
    id: 'ink.ring', label: 'Hover and attention rings', kind: 'ui-params', tags: ['ui', 'effect', 'input', 'ink'], source: 'src/engine/ink/rings.ts',
    describe: 'Dashed rotating ink rings drawn around a thing when hovered, pressed or pointed out.',
    params: {
      dashes: { value: 14, min: 3, max: 60, step: 1, help: 'Dashes per ring.' },
      duty: { value: 0.55, min: 0.05, max: 1, step: 0.01, help: 'Fraction of each slot that is inked.' },
      dashPoints: { value: 5, min: 2, max: 20, step: 1, help: 'Points per dash.' },
      spin: { value: 0.9, min: -10, max: 10, step: 0.05, unit: 'rad/s', help: 'Rotation speed.' },
      ease: { value: 10, min: 0.1, max: 60, step: 0.5, unit: '1/s', help: 'How fast the ring level follows its target.' },
      hover: { value: 0.6, min: 0, max: 1, step: 0.05, help: 'Level while hovered.' },
      pressHold: { value: 0.35, min: 0, max: 3, step: 0.05, unit: 's', help: 'Seconds at full level after a press.' },
      toward: { value: 3, min: 0, max: 20, step: 0.1, unit: 'mm', help: 'Hover ring offset toward the camera.' },
      attentionToward: { value: 2, min: 0, max: 20, step: 0.1, unit: 'mm', help: 'Attention ring offset toward the camera.' },
      grow: { value: 1.2, min: 0, max: 10, step: 0.1, unit: 'mm', help: 'Hover ring radius growth at full level.' },
      attentionRadius: { value: 8, min: 1, max: 60, step: 0.5, unit: 'mm', help: 'Attention ring radius.' },
      attentionGrow: { value: 0.08, min: 0, max: 1, step: 0.01, help: 'Attention ring relative growth at full level.' },
      opacityGain: { value: 1.4, min: 0, max: 4, step: 0.05, help: 'Opacity = min(1, gain x level).' },
      widthPx: { value: 1.9, min: 0.2, max: 8, step: 0.05, unit: 'px', help: 'Ring line width.' },
      color: { value: '#273463', help: 'Ring ink colour (navy).' },
      radiusFactor: { value: 0.55, min: 0.1, max: 2, step: 0.01, help: 'Auto radius = factor x hypot(width, height) of the thing.' },
      radiusMin: { value: 9, min: 1, max: 100, step: 0.5, unit: 'mm', help: 'Smallest auto radius.' },
      radiusMax: { value: 22, min: 1, max: 200, step: 0.5, unit: 'mm', help: 'Largest auto radius.' },
    },
  });

  const cutaway = tunable(registry, {
    id: 'ink.cutaway', label: 'Cut-away knife', kind: 'effect-params', tags: ['effect', 'shader', 'input', 'ink'], source: 'src/engine/ink/cutaway.ts',
    describe: 'A clip plane through an object toward the camera that removes its front half to reveal what is inside.',
    params: {
      rate: { value: 6, min: 0.1, max: 60, step: 0.5, unit: '1/s', help: 'Opening speed (exponential).' },
      offset: { value: 1.4, min: 0, max: 5, step: 0.05, help: 'Closed knife offset as a multiple of the radius.' },
      innerAt: { value: 0.35, min: 0, max: 1, step: 0.01, help: 'Opening level where the inner object appears.' },
    },
  });

  const card = tunable(registry, {
    id: 'ink.card', label: 'Cards, tags and labels', kind: 'text-params', tags: ['text', 'ui', 'paper', 'ink'], source: 'src/engine/ink/cards.ts',
    describe: 'Paper cards and hanging tags with canvas text and pen borders. Applies to cards made after the change.',
    params: {
      pxPerMm: { value: 14, min: 2, max: 40, step: 1, unit: 'px/mm', help: 'Card canvas resolution.' },
      background: { value: '#fbf6ea', help: 'Card and tag paper colour.' },
      text: { value: '#1c2433', help: 'Main text colour.' },
      secondary: { value: '#4a5161', help: 'Secondary text colour.' },
      outerWidth: { value: 0.95, min: 0, max: 4, step: 0.05, help: 'Outer border pen weight.' },
      innerWidth: { value: 0.42, min: 0, max: 4, step: 0.05, help: 'Inner border pen weight.' },
      inset: { value: 1, min: 0, max: 10, step: 0.1, unit: 'mm', help: 'Inner border inset.' },
      lift: { value: 0.12, min: 0, max: 2, step: 0.01, unit: 'mm', help: 'Border height above the card face.' },
      borderPx: { value: 1.25, min: 0.2, max: 8, step: 0.05, unit: 'px', help: 'Card border ink width.' },
      fitShrink: { value: 0.94, min: 0.5, max: 0.99, step: 0.01, help: 'Font shrink step when text does not fit.' },
      tagPxPerMm: { value: 22, min: 2, max: 60, step: 1, unit: 'px/mm', help: 'Hanging tag canvas resolution.' },
      tagCut: { value: 3.2, min: 0, max: 10, step: 0.1, unit: 'mm', help: 'Largest corner cut on the hole side of a tag.' },
      redrawMs: { value: 70, min: 0, max: 1000, step: 5, unit: 'ms', help: 'Text redraw throttle.' },
    },
  });

  const box = tunable(registry, {
    id: 'ink.box', label: 'Box edges', kind: 'helper-params', tags: ['object', 'ink'], source: 'src/engine/ink/shapes.ts',
    describe: 'Box edges cross at the corners like a draughtsman\'s box: each edge overshoots by min(max, fraction x length).',
    params: {
      overshootMax: { value: 1.2, min: 0, max: 10, step: 0.05, unit: 'mm' },
      overshootFrac: { value: 0.06, min: 0, max: 1, step: 0.005 },
    },
  });

  const sil = tunable(registry, {
    id: 'ink.silhouette', label: 'Live outlines', kind: 'helper-params', tags: ['ink', 'camera'], source: 'src/engine/ink/silhouette.ts',
    describe: 'Outlines of round things recomputed every frame so they follow the camera. Applies to shapes made after the change.',
    params: {
      spherePoints: { value: 72, min: 8, max: 400, step: 1, help: 'Points on a sphere outline.' },
      widthPx: { value: 1.6, min: 0.2, max: 8, step: 0.05, unit: 'px', help: 'Outline ink width.' },
      latheDense: { value: 3, min: 1, max: 12, step: 1, help: 'Steps each lathe profile segment is split into.' },
      latheSegments: { value: 48, min: 6, max: 256, step: 1, help: 'Radial segments of lathe surfaces.' },
      rimPoints: { value: 64, min: 8, max: 256, step: 1, help: 'Points on rim rings.' },
      outlineLen: { value: 0.8, min: 0, max: 4, step: 0.05, help: 'Pen length of a lathe outline as a fraction of its profile length.' },
    },
  });

  ready = true;
  syncLine();
  syncHatch();
  syncPaper();
  syncFold();
  applyTier('high');
  return {
    u, line, stroke, hatch, paper, illus, fold, print, timing, pen, presets, quality, order, ring, cutaway, card, box, sil,
    lineListeners, applyTier,
    get tier() { return state.tier; },
    /** Current stroke parameters (a copy). */
    strokeParams: (): StrokeParams => ({ ...stroke }),
    foldParams: (): FoldParams => ({ ...fold }),
    timings: (): PopTimings => ({ ...timing }),
    ctxs: new WeakSet<EngineContext>(),
  };
}

export type InkEnv = ReturnType<typeof defs>;

const envs = new WeakMap<Registry, InkEnv>();

/** The ink parameters and shared uniforms of a registry, created on first use. */
export function inkEnv(registry: Registry): InkEnv {
  let e = envs.get(registry);
  if (!e) envs.set(registry, (e = defs(registry)));
  return e;
}

const _v = new Vector3();
/**
 * Binds the ink environment to an engine: quality tier changes and the per-frame illustration light direction
 * (world -> main camera view space, in the `uniforms` phase). Idempotent per context.
 */
export function bindInk(ctx: EngineContext): InkEnv {
  const e = inkEnv(ctx.registry);
  if (e.ctxs.has(ctx)) return e;
  e.ctxs.add(ctx);
  e.applyTier(ctx.quality.tier);
  ctx.events.on('quality', ({ tier }) => e.applyTier(tier));
  const update = () => {
    const d = e.illus.direction;
    ctx.camera.updateMatrixWorld();
    _v.set(d[0] ?? 0, d[1] ?? 0, d[2] ?? 0).normalize().transformDirection(ctx.camera.matrixWorldInverse);
    e.u.uIllus.value.copy(_v);
  };
  update();
  ctx.onFrame('uniforms', update);
  return e;
}

/** Parses a colour parameter into a linear three.js Color. */
export const linearColor = (hex: string) => new Color(hex);
