/**
 * Every number the lesson runtime and the navigator read, registered once per registry as `runtime.*` and `nav.*`
 * entities. Values are read live, so `inkleaf.set('nav.hero', 'holdFirst', 5)` changes the next hero hold.
 */
import { tunable } from '../core/tune';
import type { Registry } from '../core/registry';

const SRC = 'src/engine/runtime/tunables.ts';

function build(r: Registry) {
  const frame = tunable(r, {
    id: 'runtime.frame', label: 'Lesson frame', kind: 'layout', tags: ['layout', 'book', 'lesson'], source: SRC,
    describe: 'The coordinate frame every lesson figure is authored in: fitted to the right page along the hinge line, x along the page, y up off the paper, z toward the reader.',
    params: {
      insetU: { value: 14, min: 0, max: 60, unit: 'mm', help: 'Page u of the print rectangle origin (frame x = 0 before the sample offset)' },
      sampleStart: { value: 6, min: 0, max: 40, unit: 'mm', help: 'First fit sample lies this far past insetU; the frame origin sits on it' },
      sampleEnd: { value: 166, min: 40, max: 190, unit: 'mm', help: 'Last fit sample, measured from insetU' },
      sampleStep: { value: 8, min: 1, max: 40, unit: 'mm', help: 'Spacing of the fit samples across the page' },
      maxU: { value: 188, min: 40, max: 190, unit: 'mm', help: 'Fit samples never go past this page u' },
      baselineV: { value: 212, min: 100, max: 245, unit: 'mm', help: 'Page v of the hinge line the model stands on' },
      upU: { value: 74, min: 0, max: 190, unit: 'mm', help: 'Page u of the two points that give the page-down direction' },
      upV: { value: 152, min: 0, max: 240, unit: 'mm', help: 'Page v of the upper reference point (the lower one is baselineV)' },
      fitSkip: { value: 2, min: 0, max: 10, step: 1, help: 'Samples nearest the gutter ignored when finding the highest bulge' },
      lift: { value: 0.05, min: 0, max: 2, unit: 'mm', help: 'Floor of the frame above the highest page bulge' },
    },
  });

  const print = tunable(r, {
    id: 'runtime.print', label: 'Printed figure', kind: 'layout', tags: ['ink', 'texture', 'book', 'lesson'], source: SRC,
    describe: 'Where the flat printed copy of a lesson figure sits: the print window in frame mm, its resolution and the cabinet shear.',
    params: {
      x0: { value: -10, min: -60, max: 0, unit: 'mm', help: 'Left edge of the print window in frame x' },
      x1: { value: 170, min: 60, max: 200, unit: 'mm', help: 'Right edge of the print window in frame x' },
      y0: { value: -4, min: -30, max: 0, unit: 'mm', help: 'Bottom of the print window (below the hinge)' },
      y1: { value: 196, min: 60, max: 240, unit: 'mm', help: 'Top of the print window (up the page)' },
      pxPerMm: { value: 6, min: 1, max: 12, unit: 'px/mm', help: 'Print texture resolution (applies to lessons built after a change)' },
      cabX: { value: 0.12, min: 0, max: 1, help: 'Cabinet shear: x moved per mm of depth' },
      cabY: { value: 0.32, min: 0, max: 1, help: 'Cabinet shear: page-up moved per mm of depth' },
      offsetU: { value: 0, min: -20, max: 20, unit: 'mm', help: 'Shift of the print on the page; 0 keeps print and standing model registered (-6 places it at insetU)' },
    },
  });

  const ink = tunable(r, {
    id: 'runtime.page-ink', label: 'Page handwriting', kind: 'canvas-layer', tags: ['ink', 'text', 'book', 'lesson'], source: SRC,
    describe: 'The transparent ink layers over both lesson pages: the prediction tick, the handwritten margin numbers and the stamp.',
    params: {
      pxPerMm: { value: 4, min: 1, max: 8, unit: 'px/mm', help: 'Ink canvas resolution (applies to lessons built after a change)' },
      throttle: { value: 0.08, min: 0, max: 1, unit: 's', help: 'Minimum time between two ink redraws' },
      color: { value: '#273463', help: 'Pen colour of ticks, numbers and rings' },
      tickWidth: { value: 0.75, min: 0.1, max: 3, unit: 'mm', help: 'Stroke width of the prediction tick' },
      marginU: { value: 12, min: 0, max: 60, unit: 'mm', help: 'Left edge of the margin numbers' },
      marginStart: { value: 4, min: 0, max: 30, unit: 'mm', help: 'First margin baseline below the top of the equation box' },
      marginFallbackV: { value: 80, min: 0, max: 240, unit: 'mm', help: 'Equation top used when the page reports none' },
      marginSize: { value: 5.6, min: 2, max: 12, unit: 'mm', help: 'Default size of a margin line' },
      marginLead: { value: 1.12, min: 0.8, max: 2, help: 'Baseline advance as a multiple of the line size' },
      marginWeight: { value: 560, min: 300, max: 800, step: 10, help: 'Handwriting font weight' },
      tiltOdd: { value: -0.012, min: -0.2, max: 0.2, unit: 'rad', help: 'Rotation of odd margin lines' },
      tiltEven: { value: -0.6, min: -2, max: 2, help: 'Even lines rotate by tiltOdd times this factor' },
    },
  });

  const ring = tunable(r, {
    id: 'runtime.switch-ring', label: 'Switch ring', kind: 'ink-mark', tags: ['ink', 'ui', 'input', 'lesson'], source: SRC,
    describe: 'The hand-drawn loop around the chosen option of a figure switch on the right page.',
    params: {
      padU: { value: 1.2, min: 0, max: 6, unit: 'mm', help: 'Extra horizontal radius around the option' },
      padV: { value: 0.6, min: 0, max: 6, unit: 'mm', help: 'Extra vertical radius around the option' },
      raise: { value: 0.4, min: -3, max: 3, unit: 'mm', help: 'Centre raised above the option box middle' },
      points: { value: 41, min: 8, max: 200, step: 1, help: 'Points along the loop' },
      start: { value: -0.4, min: -6.3, max: 6.3, unit: 'rad', help: 'Angle the pen starts at' },
      turns: { value: 2.15, min: 1, max: 4, unit: 'pi', help: 'Swept angle in multiples of pi (over 2 overlaps like a hand loop)' },
      wobble: { value: 0.04, min: 0, max: 0.3, help: 'Horizontal radius wobble' },
      width: { value: 0.42, min: 0.05, max: 2, unit: 'mm', help: 'Stroke width' },
    },
  });

  const stamp = tunable(r, {
    id: 'runtime.stamp', label: 'Challenge stamp', kind: 'ink-mark', tags: ['ink', 'animation', 'paper', 'lesson'], source: SRC,
    describe: 'The rubber stamp a lesson gets when its challenge is met: a worn red ring with the lesson number, pressed in over a short time.',
    params: {
      press: { value: 0.35, min: 0, max: 3, unit: 's', help: 'Seconds the stamp takes to press in (linear)' },
      color: { value: '#b8412e', help: 'Stamp ink colour' },
      alpha: { value: 0.86, min: 0, max: 1, help: 'Ink opacity at full press' },
      cu: { value: 31, min: 0, max: 190, unit: 'mm', help: 'Stamp centre, page u' },
      cv: { value: 194, min: 0, max: 250, unit: 'mm', help: 'Stamp centre, page v' },
      r: { value: 13, min: 3, max: 30, unit: 'mm', help: 'Radius of the dashed stamp slot' },
      radiusScale: { value: 0.86, min: 0.3, max: 1.2, help: 'Stamp radius as a share of the slot radius' },
      rotation: { value: -0.16, min: -1, max: 1, unit: 'rad', help: 'Base rotation' },
      rotationStep: { value: 0.07, min: -0.5, max: 0.5, unit: 'rad', help: 'Extra rotation per lesson (n mod 3)' },
      outerWidth: { value: 0.09, min: 0, max: 0.3, help: 'Outer ring width as a share of the radius' },
      innerRadius: { value: 0.8, min: 0, max: 1, help: 'Inner ring radius as a share of the radius' },
      innerWidth: { value: 0.04, min: 0, max: 0.3, help: 'Inner ring width as a share of the radius' },
      numberSize: { value: 0.62, min: 0.1, max: 1.2, help: 'Lesson number size as a share of the radius' },
      wordSize: { value: 0.19, min: 0.05, max: 0.6, help: 'Word size as a share of the radius' },
      word: { value: 'DONE', help: 'Word under the number' },
      holes: { value: 70, min: 0, max: 400, step: 1, help: 'Worn specks punched out of the ink' },
      holeAlpha: { value: 0.5, min: 0, max: 1, help: 'How much each speck erases' },
    },
  });

  const flap = tunable(r, {
    id: 'runtime.flap', label: 'Why? flap', kind: 'animation', tags: ['animation', 'paper', 'input', 'book', 'lesson'], source: SRC,
    describe: 'The lift-the-flap card over the explanation on a lesson page: it swings over its bottom edge toward the reader.',
    params: {
      angle: { value: 2.72, min: 0.5, max: 3.14, unit: 'rad', help: 'Fully open angle (applies to cards built after a change)' },
      rate: { value: 7, min: 0.5, max: 60, unit: '1/s', help: 'Opening speed: amount approaches its target by 1 - exp(-rate dt)' },
      printedAt: { value: 0.02, min: 0, max: 0.5, help: 'Above this open amount the page stops printing the closed flap face' },
    },
  });

  const pen = tunable(r, {
    id: 'runtime.pen-sound', label: 'Pen sounds', kind: 'sound-use', tags: ['sound', 'ink', 'lesson'], source: SRC,
    describe: 'How the lesson runtime uses the pen sound: a scratching loop while the figure peels, a short tick on predictions and switches.',
    params: {
      loopGain: { value: 1, min: 0, max: 2, help: 'Gain of the peel loop' },
      loopStop: { value: 0.12, min: 0, max: 1, unit: 's', help: 'Fade when the peel ends' },
      tickGain: { value: 1.4, min: 0, max: 3, help: 'Gain of a tick' },
      tickLength: { value: 0.5, min: 0.05, max: 2, unit: 's', help: 'Length of a tick' },
    },
  });

  const pointer = tunable(r, {
    id: 'runtime.pointer', label: 'Figure pointer', kind: 'input-mapping', tags: ['input', 'interaction', 'lesson'], source: SRC,
    describe: 'How pointer events reach a figure: touch probes around the finger, and the plane a drag moves on.',
    params: {
      touchScale: { value: 1, min: 0, max: 3, help: 'Scale of the 13 touch probe offsets (up to 14 px)' },
      dragPlane: { value: 'frame-z', options: ['frame-z', 'camera'], help: 'frame-z: the upright plane through the press point facing the reader; camera: facing the camera' },
    },
  });

  const tour = tunable(r, {
    id: 'runtime.tour', label: 'Tour intents', kind: 'camera-intent', tags: ['camera', 'animation', 'lesson'], source: SRC,
    describe: 'Camera poses (lesson frame mm) behind the named tour shots a manifest can use: wide, figure, and the follow offset.',
    params: {
      widePos: { value: [88, 270, 310], unit: 'mm', help: 'Eye of a wide establishing shot' },
      wideLook: { value: [86, 48, -60], unit: 'mm', help: 'Look point of a wide shot' },
      figurePos: { value: [100, 188, 250], unit: 'mm', help: 'Eye of a figure close-up' },
      figureLook: { value: [86, 40, -62], unit: 'mm', help: 'Look point of a figure close-up' },
      followOffset: { value: [10, 24, 60], unit: 'mm', help: 'Eye offset from a followed point, rotated with the frame' },
      fov: { value: 30, min: 10, max: 80, unit: 'deg', help: 'Field of view of tour shots' },
      hold: { value: 2, min: 0.5, max: 10, unit: 's', help: 'Default seconds per shot' },
    },
  });

  return { frame, print, ink, ring, stamp, flap, pen, pointer, tour };
}

function buildNav(r: Registry) {
  const turn = tunable(r, {
    id: 'nav.turn', label: 'Page navigation', kind: 'animation', tags: ['animation', 'book', 'control'], source: SRC,
    describe: 'Page turns started by the navigator: duration, the landing open and when a jump riffles.',
    params: {
      duration: { value: 1.15, min: 0.2, max: 5, unit: 's', help: 'Seconds of a single page turn' },
      landingDuration: { value: 1.1, min: 0.2, max: 5, unit: 's', help: 'Duration passed for the opening move' },
      riffleOver: { value: 1, min: 0, max: 10, step: 1, help: 'Jumps of more than this many spreads play the riffle sound' },
    },
  });
  const landing = tunable(r, {
    id: 'nav.landing', label: 'Opening sequence', kind: 'animation', tags: ['animation', 'book', 'camera'], source: SRC,
    describe: 'Boot: the ready gate, then the closed book opens by itself to the first lesson.',
    params: {
      delay: { value: 0.45, min: 0, max: 10, unit: 's', help: 'Wait after ready before the book opens' },
      readyFrames: { value: 4, min: 0, max: 120, step: 1, help: 'Frames drawn before the app counts as ready' },
      readyAfter: { value: 1.6, min: 0, max: 10, unit: 's', help: 'Earliest ready time after page load' },
      auto: { value: true, help: 'Open the book by itself' },
    },
  });
  const hero = tunable(r, {
    id: 'nav.hero', label: 'Hero hold', kind: 'camera-pose', tags: ['camera', 'animation', 'lesson'], source: SRC,
    describe: 'After the opening, the camera holds a close 3/4 view of the first lesson figure while it peels up, then returns to reading.',
    params: {
      enabled: { value: true, help: 'Hold the close view after the opening' },
      holdFirst: { value: 7.8, min: 0, max: 30, unit: 's', help: 'Hold on the first lesson' },
      holdOther: { value: 3.6, min: 0, max: 30, unit: 's', help: 'Hold when the opening lands on another lesson' },
      pos: { value: [100, 188, 250], unit: 'mm', help: 'Eye in the lesson frame' },
      look: { value: [86, 40, -62], unit: 'mm', help: 'Look point in the lesson frame' },
      fov: { value: 30, min: 10, max: 80, unit: 'deg', help: 'Field of view during the hold' },
      minAspect: { value: 1, min: 0, max: 3, help: 'No hold on screens narrower than this aspect' },
    },
  });
  const watch = tunable(r, {
    id: 'nav.auto-watch', label: 'Automatic tour', kind: 'animation', tags: ['animation', 'camera', 'ui'], source: SRC,
    describe: 'On the first visit to a lesson in a session, its guided tour starts by itself once the figure is live and idle.',
    params: {
      enabled: { value: true, help: 'Start the tour by itself on first visits' },
      delay: { value: 0.9, min: 0, max: 10, unit: 's', help: 'Seconds after the figure is live and not busy' },
    },
  });
  const quiz = tunable(r, {
    id: 'nav.quiz', label: 'Quiz flaps', kind: 'animation', tags: ['animation', 'paper', 'input', 'book'], source: SRC,
    describe: 'The answer flaps on the quiz spread and what happens when the last one is lifted.',
    params: {
      angle: { value: 1.72, min: 0.5, max: 3.14, unit: 'rad', help: 'Open angle of an answer flap (cards built after a change)' },
      rate: { value: 7, min: 0.5, max: 60, unit: '1/s', help: 'Opening speed' },
      stampDelay: { value: 0.35, min: 0, max: 3, unit: 's', help: 'Delay of the stamp sound after the last flap is lifted' },
      prepareBefore: { value: 1, min: 0, max: 10, step: 1, help: 'Build the flaps once the target is this many spreads before the quiz' },
      persist: { value: false, help: 'Keep picks and lifted flaps across visits and reloads' },
    },
  });
  return { turn, landing, hero, watch, quiz };
}

export type RuntimeTunables = ReturnType<typeof build>;
export type NavTunables = ReturnType<typeof buildNav>;

const runtimeCache = new WeakMap<Registry, RuntimeTunables>();
const navCache = new WeakMap<Registry, NavTunables>();

export function runtimeTunables(registry: Registry): RuntimeTunables {
  let t = runtimeCache.get(registry);
  if (!t) runtimeCache.set(registry, (t = build(registry)));
  return t;
}

export function navTunables(registry: Registry): NavTunables {
  let t = navCache.get(registry);
  if (!t) navCache.set(registry, (t = buildNav(registry)));
  return t;
}
