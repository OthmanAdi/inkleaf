/**
 * The camera rig. Three separate parts: target providers (hero hold > tour shot > reading framing), a damper with
 * a selectable time constant, and an orbit offset applied after damping in spherical coordinates around the damped
 * look point. Lesson poses are written in a lesson frame fitted to the right page, so they survive page bulge.
 */
import { Matrix3, Matrix4, Vector3, type PerspectiveCamera } from 'three';
import type { CameraPose, CameraRigApi, EngineContext, Side, Unsubscribe } from '../contracts';
import { registerCameraConfig, unregisterCameraConfig, type CameraConfig } from './config';
import {
  blendFactor, copyPose, fitLessonFrame, framePose, makePose, narrowFactor, openingBlend, orbitDrag, orbitPosition, orbitRelax,
  portraitModelPose, portraitPagePose, pullBack, smoothstep01, vec, type DampMode, type ModelBounds, type OrbitState,
} from './math';

/** What the rig needs from the book. */
export interface RigBook {
  readonly position: number;
  readonly turning: boolean;
  readonly openSpread: number;
  pageToWorld(spread: number, side: Side, u: number, v: number, out?: Vector3): Vector3;
}

export type SpreadKind = 'lesson' | 'contents' | 'other';

export interface RigOptions {
  book?: RigBook | null;
  /** Kind of a spread: lessons get the model framing and a lesson frame; contents frames its right page. */
  spreadKind?: (spread: number) => SpreadKind;
  /** Bounds of the visible pop-up model of the current lesson (see `modelBounds`), or null when not live. */
  bounds?: () => ModelBounds | null;
  /** Clock in milliseconds (default `performance.now`). */
  now?: () => number;
  /** Hook `update` into the engine's camera phase (default true). */
  autoUpdate?: boolean;
}

export interface TourShot {
  /** Fixed pose in the lesson frame. */
  pose?: CameraPose;
  /** Followed world point; the camera sits at point + frame rotation x offset. */
  follow?: () => Vector3 | null;
  offset?: Vector3;
  fov?: number;
}

export interface CameraRig extends CameraRigApi {
  readonly config: CameraConfig;
  readonly orbit: OrbitState;
  /** The current lesson frame (identity until fitted). */
  readonly frame: Matrix4;
  readonly hasFrame: boolean;
  /** The last computed target (before damping). */
  readonly target: CameraPose;
  readonly heroActive: boolean;
  readonly touring: boolean;
  setBook(book: RigBook | null): void;
  setFrame(m: Matrix4 | null): void;
  /** Fits the lesson frame to the right page of a spread and makes it current. */
  fitFrame(spread: number): Matrix4 | null;
  /** Starts the hero hold for a lesson number (lesson 1 holds longest). */
  heroHold(lesson: number): void;
  cancelHero(): void;
  /** Tour state: while active the camera uses tour damping; while paused the camera freezes. */
  setTour(active: boolean, paused?: boolean): void;
  orbitDrag(dx: number, dy: number): void;
  /** Pointer down (true) or up (false): resets the idle timer of the spring back. */
  setHeld(on: boolean): void;
  /** Flick to turn: yaw back to zero at once. */
  resetYaw(): void;
  /** Jumps the damped pose to the target now. */
  snap(): void;
  dispose(): void;
}

const _tmp = new Vector3(), _off = new Vector3(), _m3 = new Matrix3();

export function createCameraRig(ctx: EngineContext, opts: RigOptions = {}): CameraRig {
  const camera: PerspectiveCamera = ctx.camera;
  let cfgReady = false;
  const cfg = registerCameraConfig(ctx.registry, () => {
    if (!cfgReady) return;
    camera.near = cfg.main.near;
    camera.far = cfg.main.far;
    camera.updateProjectionMatrix();
  });
  cfgReady = true;
  camera.near = cfg.main.near;
  camera.far = cfg.main.far;
  let book = opts.book ?? null;
  const now = opts.now ?? (() => performance.now());
  const kindOf = opts.spreadKind ?? (() => 'other' as SpreadKind);

  const frame = new Matrix4();
  let hasFrame = false;
  const damped = makePose();
  const target = makePose();
  const portraitView = makePose();
  let portraitStored = false;
  const closed = makePose(), read = makePose();
  const orbit: OrbitState = { yaw: 0, pitch: 0, held: false, idle: 0 };

  let heroPose: CameraPose | null = null;
  let heroFromConfig = false;
  let heroUntil = 0;
  let touring = false;
  let tourPaused = false;
  let shot: TourShot | null = null;
  let shotAge = 0;

  const refreshPoses = () => {
    vec(cfg.closed.anchor, _tmp);
    vec(cfg.closed.posOffset, closed.pos).add(_tmp);
    vec(cfg.closed.lookOffset, closed.look).add(_tmp);
    closed.fov = cfg.closed.fov;
    vec(cfg.read.pos, read.pos);
    vec(cfg.read.look, read.look);
    read.fov = cfg.read.fov;
  };

  function pageWorld(spread: number, side: Side, u: number, v: number, out: Vector3): Vector3 {
    return book ? book.pageToWorld(spread, side, u, v, out) : out.set(u, 0, v - 125);
  }

  function readingFraming(out: CameraPose): CameraPose {
    const p = book ? book.position : 1;
    const s = smoothstep01(p);
    const aspect = camera.aspect || 1;
    const pc = cfg.portrait;
    if (aspect < 1 && book) {
      if (book.turning && portraitStored) return copyPose(portraitView, out);
      const k = book.openSpread;
      const kind = kindOf(k);
      if (s > 0.99 && kind === 'lesson' && hasFrame) {
        const b = opts.bounds?.() ?? null;
        if (!b) return framePose(frame, pc.fallbackPos, pc.fallbackLook, pc.fov, out);
        portraitModelPose(frame, b, aspect, pc, out);
        copyPose(out, portraitView);
        portraitStored = true;
        return out;
      }
      if (s > 0.99 && k >= 1 && kind !== 'lesson') {
        pageWorld(k, kind === 'contents' ? 'right' : 'left', pc.pageU, pc.pageV, _tmp);
        portraitPagePose(_tmp, read, aspect, pc, out);
        copyPose(out, portraitView);
        portraitStored = true;
        return out;
      }
    }
    openingBlend(p, closed, read, out);
    return pullBack(out, narrowFactor(aspect, cfg.narrow));
  }

  function computeTarget(out: CameraPose): CameraPose {
    refreshPoses();
    const t = now();
    if ((heroPose || heroFromConfig) && !touring && t < heroUntil) {
      if (heroFromConfig) return framePose(frame, cfg.hero.pos, cfg.hero.look, cfg.hero.fov, out);
      out.pos.copy(heroPose!.pos).applyMatrix4(frame);
      out.look.copy(heroPose!.look).applyMatrix4(frame);
      out.fov = heroPose!.fov;
      return out;
    }
    if (touring && shot) {
      if (shot.follow) {
        const P = shot.follow();
        if (P) {
          vec(cfg.tour.followOffset, _off);
          if (shot.offset) _off.copy(shot.offset);
          _off.applyMatrix3(_m3.setFromMatrix4(frame));
          out.look.copy(P);
          out.pos.copy(P).add(_off);
          out.fov = shot.fov ?? 30;
          return out;
        }
      } else if (shot.pose) {
        out.pos.copy(shot.pose.pos).applyMatrix4(frame);
        out.look.copy(shot.pose.look).applyMatrix4(frame);
        out.fov = shot.fov ?? shot.pose.fov ?? 30;
        const a = camera.aspect || 1;
        if (a < cfg.narrow.tourAspect) pullBack(out, Math.pow(cfg.narrow.tourAspect / a, cfg.narrow.tourExp));
        return out;
      }
    }
    return readingFraming(out);
  }

  function apply(): void {
    orbitPosition(damped.pos, damped.look, orbit.yaw, orbit.pitch, cfg.orbit, camera.position);
    if (camera.fov !== damped.fov) {
      camera.fov = damped.fov;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(damped.look);
    camera.updateMatrixWorld();
  }

  function update(dt: number): void {
    if (touring && tourPaused) return;
    if (touring) shotAge += dt;
    computeTarget(target);
    const still = ctx.still;
    const mode: DampMode = still ? 'still' : touring && shot?.follow && shotAge > cfg.damping.followDelay ? 'follow' : touring ? 'tour' : 'default';
    const a = blendFactor(mode, dt, cfg.damping);
    damped.pos.lerp(target.pos, a);
    damped.look.lerp(target.look, a);
    damped.fov += (target.fov - damped.fov) * a;
    orbitRelax(orbit, dt, cfg.orbit, still);
    apply();
  }

  // Boot: the damped pose starts at the closed pose (or the reading pose without a book).
  refreshPoses();
  computeTarget(target);
  copyPose(book && book.position < 0.5 ? closed : target, damped);
  apply();

  const unsubs: Unsubscribe[] = [];
  if (opts.autoUpdate !== false) unsubs.push(ctx.onFrame('camera', (f) => update(f.dt)));
  unsubs.push(ctx.events.on('arrive', ({ spread }) => {
    portraitStored = false;
    if (kindOf(spread) === 'lesson') rig.fitFrame(spread);
  }));
  unsubs.push(ctx.events.on('turn-start', () => rig.cancelHero()));
  unsubs.push(ctx.events.on('still', ({ on }) => {
    if (on) rig.cancelHero();
  }));

  const rig: CameraRig = {
    config: cfg,
    orbit,
    frame,
    get hasFrame() {
      return hasFrame;
    },
    get pose() {
      return damped;
    },
    get target() {
      return target;
    },
    get heroActive() {
      return (heroPose !== null || heroFromConfig) && !touring && now() < heroUntil;
    },
    get touring() {
      return touring;
    },
    setBook(b) {
      book = b;
    },
    setFrame(m) {
      if (m) frame.copy(m);
      else frame.identity();
      hasFrame = m !== null;
    },
    fitFrame(spread) {
      if (!book) return null;
      fitLessonFrame((u, v, out) => book!.pageToWorld(spread, 'right', u, v, out), cfg.frame, frame);
      hasFrame = true;
      return frame;
    },
    hold(pose, untilMs) {
      heroFromConfig = false;
      heroPose = pose ? copyPose(pose, heroPose ?? makePose()) : null;
      heroUntil = pose ? untilMs ?? Infinity : 0;
    },
    heroHold(lesson) {
      if (!cfg.hero.enabled) return;
      heroPose = null;
      heroFromConfig = true;
      heroUntil = now() + (lesson === 1 ? cfg.hero.firstLesson : cfg.hero.otherLessons) * 1000;
    },
    cancelHero() {
      heroPose = null;
      heroFromConfig = false;
      heroUntil = 0;
    },
    setTourShot(s) {
      shot = s ? { ...s, pose: s.pose ? copyPose(s.pose, makePose()) : undefined } : null;
      shotAge = 0;
    },
    setTour(active, paused = false) {
      if (active && !touring) shotAge = 0;
      touring = active;
      tourPaused = active && paused;
      if (!active) shot = null;
    },
    orbitDrag(dx, dy) {
      orbitDrag(orbit, dx, dy, cfg.orbit);
    },
    setHeld(on) {
      orbit.held = on;
      orbit.idle = 0;
    },
    resetYaw() {
      orbit.yaw = 0;
    },
    snap() {
      computeTarget(target);
      copyPose(target, damped);
      apply();
    },
    update,
    dispose() {
      for (const u of unsubs) u();
      ctx.registry.remove('camera.rig');
      unregisterCameraConfig(ctx.registry);
    },
  };
  ctx.registry.add({
    id: 'camera.rig', label: 'Camera rig', kind: 'camera-rig', tags: ['camera', 'animation'], object: camera,
    describe: 'Moves the camera each frame: picks the target (hero hold, tour shot or reading framing), damps toward it and adds the orbit tilt. Live yaw and pitch can be set here.',
    source: 'src/engine/camera/rig.ts',
    params: [
      { key: 'yaw', label: 'Orbit yaw', type: 'number', unit: 'rad', min: -3.14, max: 3.14, step: 0.01, help: 'Current orbit yaw (springs back when idle)', get: () => orbit.yaw, set: (v) => void (orbit.yaw = Number(v)) },
      { key: 'pitch', label: 'Orbit pitch', type: 'number', unit: 'rad', min: -1.5, max: 1.5, step: 0.01, help: 'Current orbit pitch (springs back when idle)', get: () => orbit.pitch, set: (v) => void (orbit.pitch = Number(v)) },
    ],
  });
  return rig;
}
