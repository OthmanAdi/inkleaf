import { Vector3, type OrthographicCamera, type PerspectiveCamera } from 'three';
import { frameAt, sampleTrack, type MotionClip } from './frames';
import './guided-view.css';

export const GUIDE_MOTIONS = {
  orbit: { label: 'View around the apparatus', fps: 60, lastFrame: 240 },
  guided: { label: 'Guided demonstration', fps: 60, lastFrame: 480 },
} as const satisfies Record<string, MotionClip>;
export type GuideMotionId = keyof typeof GUIDE_MOTIONS;
export interface FigureView { yaw: number; pitch: number }
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** Absolute samples, never an accumulated rotation of the apparatus. */
export function figureViewAt(frame: number): FigureView {
  const f = frameAt(GUIDE_MOTIONS.orbit, frame);
  return {
    yaw: sampleTrack([
      { frame: 0, value: 0, easeToNext: 'inOutSine' },
      { frame: 80, value: -48, easeToNext: 'inOutSine' },
      { frame: 160, value: 48, easeToNext: 'inOutSine' },
      { frame: 240, value: 0 },
    ], f),
    pitch: sampleTrack([
      { frame: 0, value: 0, easeToNext: 'inOutSine' },
      { frame: 120, value: 18, easeToNext: 'inOutSine' },
      { frame: 240, value: 0 },
    ], f),
  };
}

function storedView(canvas: HTMLCanvasElement): FigureView {
  return { yaw: Number(canvas.dataset.viewYaw) || 0, pitch: Number(canvas.dataset.viewPitch) || 0 };
}
function setView(canvas: HTMLCanvasElement, view: FigureView) {
  canvas.dataset.viewYaw = String(clamp(view.yaw, -60, 60));
  canvas.dataset.viewPitch = String(clamp(view.pitch, -15, 25));
  canvas.dispatchEvent(new Event('inkleaf:view'));
}

/** Shared camera rig for the perspective pendulum and orthographic lesson figures. */
export function mountFigureView(
  canvas: HTMLCanvasElement,
  camera: PerspectiveCamera | OrthographicCamera,
  render: () => void,
  target = new Vector3(0, 55, 0),
) {
  const base = camera.position.clone().sub(target);
  function apply() {
    const { yaw, pitch } = storedView(canvas);
    const radius = base.length();
    const azimuth = Math.atan2(base.x, base.z) + clamp(yaw, -60, 60) * Math.PI / 180;
    const elevation = clamp(Math.asin(base.y / radius) + clamp(pitch, -15, 25) * Math.PI / 180, 0.12, 1.25);
    const horizontal = radius * Math.cos(elevation);
    camera.position.set(horizontal * Math.sin(azimuth), radius * Math.sin(elevation), horizontal * Math.cos(azimuth)).add(target);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }
  const change = () => { apply(); render(); };
  canvas.addEventListener('inkleaf:view', change);
  apply();
  return {
    updateBase(position: Vector3) { base.copy(position).sub(target); apply(); },
    dispose() { canvas.removeEventListener('inkleaf:view', change); },
  };
}

interface GuidedViewOptions {
  canvas: () => HTMLCanvasElement | null;
  demo?: Window['inkleafDemo'];
}

/** Optional reader controls. Native controls remain in the normal tab order. */
export function mountGuidedView(host: HTMLElement, options: GuidedViewOptions) {
  const demo = options.demo ?? window.inkleafDemo;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const controls = document.createElement('details');
  controls.className = 'guided-view';
  controls.innerHTML = `<summary>View the apparatus</summary>
    <div class="guided-view-controls">
      <p>Turn the view with these sliders. Drag the pendulum bob directly to release it.</p>
      <label>Turn <input data-yaw type="range" min="-60" max="60" step="1" value="0"></label>
      <label>Tilt <input data-pitch type="range" min="-15" max="25" step="1" value="0"></label>
      <div class="guided-view-actions"><button type="button" data-reset>Reset view</button>
      <button type="button" data-play>Play demonstration</button><button type="button" data-pause disabled>Pause</button></div>
      <output aria-live="polite">Choose a lesson, then play its demonstration.</output>
    </div>`;
  const yaw = controls.querySelector<HTMLInputElement>('[data-yaw]')!;
  const pitch = controls.querySelector<HTMLInputElement>('[data-pitch]')!;
  const play = controls.querySelector<HTMLButtonElement>('[data-play]')!;
  const pauseButton = controls.querySelector<HTMLButtonElement>('[data-pause]')!;
  const output = controls.querySelector('output')!;
  const abort = new AbortController();
  const listen = { signal: abort.signal };
  let raf = 0;
  let elapsed = 0;
  let internalSeek = false;
  let selectedExtra = false;
  let playing = false;

  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
    playing = false;
    pauseButton.disabled = true;
    play.textContent = elapsed > 0 && elapsed < 8 ? 'Resume demonstration' : 'Play demonstration';
  }
  function sync() {
    const canvas = options.canvas();
    const view = canvas ? storedView(canvas) : { yaw: 0, pitch: 0 };
    yaw.value = String(view.yaw);
    pitch.value = String(view.pitch);
  }
  function seekScene(seconds: number, extra: boolean) {
    internalSeek = true;
    try {
      const duration = extra ? demo.experimentClip() : null;
      if (duration) demo.seekExperiment(seconds / 8 * duration.lastFrame / duration.fps);
      else demo.seek('swing', seconds / 8 * 3);
    } finally { internalSeek = false; }
  }
  function paintGuide(seconds: number) {
    seekScene(seconds, selectedExtra);
    const canvas = options.canvas();
    if (canvas) setView(canvas, reduced.matches ? { yaw: 0, pitch: 0 } : figureViewAt(seconds / 8 * GUIDE_MOTIONS.orbit.lastFrame));
    sync();
  }
  function manual() {
    stop();
    const canvas = options.canvas();
    if (canvas) setView(canvas, { yaw: yaw.valueAsNumber, pitch: pitch.valueAsNumber });
  }
  yaw.addEventListener('input', manual, listen);
  pitch.addEventListener('input', manual, listen);
  controls.querySelector('[data-reset]')!.addEventListener('click', () => {
    stop();
    const canvas = options.canvas();
    if (canvas) setView(canvas, { yaw: 0, pitch: 0 });
    sync();
  }, listen);
  pauseButton.addEventListener('click', () => { stop(); output.value = 'Demonstration paused. Use the controls or resume when ready.'; }, listen);
  play.addEventListener('click', () => {
    if (playing) elapsed = 0;
    stop();
    if (elapsed === 0 || elapsed >= 8) { elapsed = 0; selectedExtra = !!demo.experimentClip(); }
    if (reduced.matches) {
      paintGuide(8);
      elapsed = 8;
      output.value = 'Final reading shown. Automatic motion is off in your system settings.';
      return;
    }
    playing = true;
    pauseButton.disabled = false;
    play.textContent = 'Restart demonstration';
    output.value = 'Demonstration playing. Watch the apparatus and compare the readings.';
    let previous: number | undefined;
    const tick = (now: number) => {
      if (!playing) return;
      if (previous !== undefined) elapsed = Math.min(8, elapsed + Math.min(0.1, (now - previous) / 1000));
      previous = now;
      paintGuide(elapsed);
      if (elapsed >= 8) { stop(); output.value = 'Demonstration complete. Try changing a setting and compare.'; }
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }, listen);
  const lessonChange = () => {
    if (internalSeek) return;
    stop(); elapsed = 0; sync();
  };
  document.addEventListener('inkleaf:lessonchange', lessonChange, listen);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); }, listen);
  // A reader's own experiment controls always interrupt the optional demonstration.
  host.addEventListener('pointerdown', event => {
    if (!controls.contains(event.target as Node)) stop();
  }, listen);
  host.addEventListener('keydown', event => {
    if (event.key === 'Escape' || !controls.contains(event.target as Node)) stop();
  }, listen);
  reduced.addEventListener('change', () => { stop(); }, listen);
  host.append(controls);
  sync();
  return {
    seek(id: GuideMotionId, seconds: number) {
      if (!Number.isFinite(seconds)) return;
      stop();
      if (id === 'guided') {
        selectedExtra = !!demo.experimentClip();
        elapsed = clamp(frameAt(GUIDE_MOTIONS.guided, seconds * 60) / 60, 0, 8);
        paintGuide(elapsed);
      } else {
        const canvas = options.canvas();
        if (canvas) setView(canvas, figureViewAt(seconds * GUIDE_MOTIONS.orbit.fps));
        sync();
      }
    },
    dispose() { stop(); abort.abort(); controls.remove(); },
  };
}
