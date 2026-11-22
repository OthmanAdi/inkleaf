/**
 * Every camera number as a named, live parameter: poses, damping, orbit limits, hero hold, framing fits, tours and
 * the landing. `registerCameraConfig` is called once by the rig; other camera modules read the returned objects.
 */
import type { Registry } from '../core/registry';
import { tunable, type Tuned } from '../core/tune';

const SRC = 'src/engine/camera/config.ts';

export const POSE_READ = {
  pos: { value: [16, 430, 400], unit: 'mm', help: 'Camera position of the reading view (whole open book)' },
  look: { value: [12, 24, 4], unit: 'mm', help: 'Point the reading view looks at' },
  fov: { value: 30, min: 5, max: 90, step: 0.5, unit: 'deg', help: 'Vertical field of view of the reading view' },
};
export const POSE_CLOSED = {
  anchor: { value: [106.45, 0, 0], unit: 'mm', help: 'Centre of the closed book that the closed view is offset from' },
  posOffset: { value: [-300, 360, 400], unit: 'mm', help: 'Camera position relative to the anchor (left-front 3/4 view)' },
  lookOffset: { value: [4, -8, 6], unit: 'mm', help: 'Look point relative to the anchor' },
  fov: { value: 30, min: 5, max: 90, step: 0.5, unit: 'deg', help: 'Field of view while the book is closed' },
};
export const POSE_HERO = {
  enabled: { value: true, help: 'Dolly in to the first lesson after the opening' },
  pos: { value: [100, 188, 250], unit: 'mm', help: 'Hero camera position in the lesson frame' },
  look: { value: [86, 40, -62], unit: 'mm', help: 'Hero look point in the lesson frame' },
  fov: { value: 30, min: 5, max: 90, step: 0.5, unit: 'deg', help: 'Hero field of view' },
  firstLesson: { value: 7.8, min: 0, max: 30, step: 0.1, unit: 's', help: 'How long the close view holds on lesson 1' },
  otherLessons: { value: 3.6, min: 0, max: 30, step: 0.1, unit: 's', help: 'How long it holds when landing on another lesson' },
};
export const DAMPING = {
  remain: { value: 0.02, min: 0.0001, max: 0.9, step: 0.0001, help: 'Default follow: fraction of the gap left after one second (1 - remain^dt per frame)' },
  tauTour: { value: 0.2, min: 0.01, max: 2, step: 0.01, unit: 's', help: 'Time constant while a tour shot is framed' },
  tauFollow: { value: 0.05, min: 0.005, max: 1, step: 0.005, unit: 's', help: 'Time constant of a follow shot once locked on' },
  followDelay: { value: 0.6, min: 0, max: 2, step: 0.05, unit: 's', help: 'Seconds into a follow shot before it locks on tightly' },
};
export const NARROW = {
  aspect: { value: 1.6, min: 0.5, max: 3, step: 0.01, help: 'Below this aspect ratio the camera pulls back' },
  expLandscape: { value: 0.9, min: 0, max: 2, step: 0.01, help: 'Pull-back exponent for landscape (aspect >= 1)' },
  expPortrait: { value: 0.75, min: 0, max: 2, step: 0.01, help: 'Pull-back exponent for portrait (aspect < 1)' },
  tourAspect: { value: 1.2, min: 0.5, max: 3, step: 0.01, help: 'Below this aspect a fixed tour shot pulls back' },
  tourExp: { value: 0.85, min: 0, max: 2, step: 0.01, help: 'Pull-back exponent of tour shots' },
};
export const PORTRAIT = {
  fov: { value: 40, min: 10, max: 90, step: 0.5, unit: 'deg', help: 'Field of view on portrait screens' },
  dir: { value: [8, 222, 350], help: 'View direction toward the model in the lesson frame (normalised)' },
  widthFactor: { value: 1.08, min: 0.5, max: 3, step: 0.01, help: 'Margin on the model width' },
  depthFactor: { value: 0.5, min: 0, max: 2, step: 0.01, help: 'Share of the model depth added to the distance' },
  heightFactor: { value: 1.25, min: 0.5, max: 3, step: 0.01, help: 'Margin on the model height' },
  lookDrop: { value: 0.18, min: -1, max: 1, step: 0.01, help: 'Look point lowered by this share of the model height' },
  fallbackPos: { value: [92, 230, 300], unit: 'mm', help: 'Portrait camera in the lesson frame before the model is live' },
  fallbackLook: { value: [84, 8, -50], unit: 'mm', help: 'Portrait look point before the model is live' },
  pageU: { value: 95, min: 0, max: 400, step: 1, unit: 'mm', help: 'Page point a non-lesson portrait view looks at (across)' },
  pageV: { value: 118, min: 0, max: 400, step: 1, unit: 'mm', help: 'Page point a non-lesson portrait view looks at (down)' },
  pageHalf: { value: 95, min: 10, max: 400, step: 1, unit: 'mm', help: 'Half page width a non-lesson portrait view fits' },
  pageMargin: { value: 1.06, min: 0.5, max: 3, step: 0.01, help: 'Margin on that width' },
};
export const FRAME = {
  v: { value: 212, min: 0, max: 400, step: 1, unit: 'mm', help: 'Page row (down from the head) sampled to fit the lesson frame' },
  u0: { value: 20, min: 0, max: 400, step: 1, unit: 'mm', help: 'First sample across the page' },
  u1: { value: 180, min: 0, max: 400, step: 1, unit: 'mm', help: 'Last sample across the page' },
  step: { value: 8, min: 1, max: 50, step: 1, unit: 'mm', help: 'Sample spacing' },
  lift: { value: 0.05, min: 0, max: 5, step: 0.01, unit: 'mm', help: 'Extra lift of the frame origin above the page' },
  downU: { value: 74, min: 0, max: 400, step: 1, unit: 'mm', help: 'Column used to find the page down direction' },
  downV: { value: 152, min: 0, max: 400, step: 1, unit: 'mm', help: 'Second row used to find the page down direction' },
};
export const ORBIT = {
  yawPerPx: { value: 0.0032, min: 0, max: 0.02, step: 0.0001, unit: 'rad/px', help: 'Yaw per pixel of horizontal drag' },
  pitchPerPx: { value: 0.0024, min: 0, max: 0.02, step: 0.0001, unit: 'rad/px', help: 'Pitch per pixel of vertical drag' },
  yawLimit: { value: 0.42, min: 0, max: 3.14, step: 0.01, unit: 'rad', help: 'Largest yaw either way' },
  pitchMin: { value: -0.18, min: -1.5, max: 0, step: 0.01, unit: 'rad', help: 'Lowest pitch (toward top-down)' },
  pitchMax: { value: 0.14, min: 0, max: 1.5, step: 0.01, unit: 'rad', help: 'Highest pitch (toward the horizon)' },
  polarMin: { value: 0.35, min: 0, max: 1.5, step: 0.01, unit: 'rad', help: 'Polar angle the orbit may not go below (unless it starts there)' },
  polarMax: { value: 1.35, min: 0.2, max: 3, step: 0.01, unit: 'rad', help: 'Polar angle the orbit may not go above' },
  idleDelay: { value: 0.8, min: 0, max: 10, step: 0.05, unit: 's', help: 'Wait after release before springing back' },
  spring: { value: 2.2, min: 0, max: 20, step: 0.1, unit: '1/s', help: 'Spring-back rate (yaw *= exp(-rate dt))' },
};
export const TOUR = {
  shotSeconds: { value: 2, min: 0.3, max: 10, step: 0.1, unit: 's', help: 'Length of each tour shot' },
  endPad: { value: 0.4, min: 0, max: 3, step: 0.05, unit: 's', help: 'The tour ends this long after the last shot starts its slot' },
  autoStart: { value: true, help: 'Play the tour by itself on the first visit of a lesson' },
  autoDelay: { value: 0.9, min: 0, max: 10, step: 0.05, unit: 's', help: 'Wait after the model is live (and idle) before the tour starts' },
  restartDebounce: { value: 0.7, min: 0, max: 3, step: 0.05, unit: 's', help: 'The play button ignores clicks this long after a tour ends' },
  widePos: { value: [92, 300, 360], unit: 'mm', help: "Named shot 'wide': camera in the lesson frame" },
  wideLook: { value: [92, 40, -70], unit: 'mm', help: "Named shot 'wide': look point" },
  followOffset: { value: [6, 26, 62], unit: 'mm', help: 'Default offset of a follow shot from the followed point (lesson frame)' },
};
export const LANDING = {
  enabled: { value: true, help: 'Open the book by itself after loading' },
  delay: { value: 0.45, min: 0, max: 5, step: 0.05, unit: 's', help: 'Wait after the first frames are ready' },
  duration: { value: 1.1, min: 0.2, max: 5, step: 0.05, unit: 's', help: 'Cover opening time' },
  target: { value: 2, min: 1, max: 99, step: 1, help: 'Spread the opening lands on' },
};

export interface CameraConfig {
  main: Tuned<{ near: { value: number }; far: { value: number } }>;
  read: Tuned<typeof POSE_READ>;
  closed: Tuned<typeof POSE_CLOSED>;
  hero: Tuned<typeof POSE_HERO>;
  damping: Tuned<typeof DAMPING>;
  narrow: Tuned<typeof NARROW>;
  portrait: Tuned<typeof PORTRAIT>;
  frame: Tuned<typeof FRAME>;
  orbit: Tuned<typeof ORBIT>;
  tour: Tuned<typeof TOUR>;
  landing: Tuned<typeof LANDING>;
}

const registered = new WeakMap<Registry, CameraConfig>();

/** Registers the camera parameter blocks once per registry and returns them. */
export function registerCameraConfig(registry: Registry, onMain?: () => void): CameraConfig {
  const have = registered.get(registry);
  if (have) return have;
  const t = <P extends Record<string, import('../core/tune').Def>>(id: string, label: string, tags: string[], kind: string, describe: string, params: P, onChange?: () => void) =>
    tunable(registry, { id, label, tags, kind, describe, source: SRC, params, onChange });
  const cfg: CameraConfig = {
    main: t('camera.main', 'Main camera', ['camera'], 'perspective-camera', 'The one perspective camera. Clip planes in millimetres.', {
      near: { value: 20, min: 0.1, max: 500, step: 0.1, unit: 'mm', help: 'Near clip plane' },
      far: { value: 9000, min: 100, max: 100000, step: 10, unit: 'mm', help: 'Far clip plane' },
    }, onMain),
    read: t('camera.pose.read', 'Reading pose', ['camera', 'layout'], 'camera-pose', 'Where the camera rests once the book is open: the whole spread from above the reader.', POSE_READ),
    closed: t('camera.pose.closed', 'Closed-book pose', ['camera'], 'camera-pose', 'The 3/4 view of the closed book at boot; the camera blends to the reading pose as the cover opens.', POSE_CLOSED),
    hero: t('camera.pose.hero', 'Hero hold close-up', ['camera', 'animation'], 'camera-pose', 'After the opening the camera dollies in to a close 3/4 view of the lesson figure, holds, then pulls back.', POSE_HERO),
    damping: t('camera.damping', 'Camera follow smoothing', ['camera', 'animation'], 'damping', 'How quickly the camera catches up with its target: default, during tours and on follow shots. Still mode snaps.', DAMPING),
    narrow: t('camera.narrow-fit', 'Narrow-screen pull-back', ['camera', 'layout'], 'framing', 'Pulls the camera back on narrow screens so the book still fits.', NARROW),
    portrait: t('camera.portrait', 'Portrait framing', ['camera', 'layout'], 'framing', 'On portrait screens the camera frames the lesson model (or one page) instead of the whole spread.', PORTRAIT),
    frame: t('camera.lesson-frame', 'Lesson coordinate frame', ['camera', 'layout', 'book'], 'frame-fit', 'A frame fitted to the right page of a lesson spread; lesson camera poses (hero, tours, portrait) are written in it.', FRAME),
    orbit: t('camera.orbit', 'Orbit drag', ['camera', 'control', 'input'], 'orbit', 'Dragging tilts the view a little around the look point; released, it waits and springs back.', ORBIT),
    tour: t('camera.tour', 'Guided demonstration', ['camera', 'animation', 'ui'], 'tour', 'Five short camera shots with captions that show a lesson figure working; plays by itself on a first visit.', TOUR),
    landing: t('camera.landing', 'Opening sequence', ['camera', 'animation', 'book'], 'landing', 'After loading the closed book opens by itself to the first lesson while the camera glides to the reading view.', LANDING),
  };
  registered.set(registry, cfg);
  return cfg;
}

/** Removes the camera config from a registry (and the cache) so it can be registered again. */
export function unregisterCameraConfig(registry: Registry): void {
  registered.delete(registry);
  for (const id of ['camera.main', 'camera.pose', 'camera.damping', 'camera.narrow-fit', 'camera.portrait', 'camera.lesson-frame', 'camera.orbit', 'camera.tour', 'camera.landing']) registry.removeTree(id);
}
