import '../main';
import './tools.css';
import { BOOK_MOTIONS } from '../demo/book-motion';
import { DEMO_MOTIONS, MAGNIFIER_SWEEP, magnifierAt, magnifierZoomAt, type DemoMotionId } from '../demo/motion';
import { mountStudyTools } from '../demo/study';
import { GUIDE_MOTIONS, mountGuidedView } from './guided-view';
import { mountMagnifier } from './magnifier';
import { mountPageGestures } from './navigation-input';
import { mountMotionPanel } from './panel';

const demo = window.inkleafDemo;
const host = document.querySelector('main')!;
const swingCanvas = document.querySelector<HTMLCanvasElement>('#figure')!;
const extraCanvas = document.querySelector<HTMLCanvasElement>('#extra-figure')!;
const addMagnifier = (
  canvasId: string,
  controls: string,
  term: () => { label: string; definition: string } | null,
) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Magnifier';
  button.setAttribute('aria-pressed', 'false');
  document.querySelector(controls)!.append(button);
  return mountMagnifier(document.querySelector<HTMLCanvasElement>(canvasId)!, button, term);
};

const magnifier = addMagnifier('#figure', '.controls', () => ({
  label: 'Pendulum',
  definition: 'A mass suspended from a pivot. Its gravitational energy changes as it swings through different heights.',
}));
const extraMagnifier = addMagnifier('#extra-figure', '.extra-controls', () => demo.experimentTerm());
mountPageGestures(document.querySelector('#notebook')!, (direction) => demo.movePage(direction));

const activeCanvas = () => demo.experimentClip() ? extraCanvas : swingCanvas;
const views = mountGuidedView(host, { canvas: activeCanvas, demo });
const clips = { ...DEMO_MOTIONS, ...BOOK_MOTIONS, ...GUIDE_MOTIONS, magnifier: MAGNIFIER_SWEEP };
const panel = mountMotionPanel<DemoMotionId | keyof typeof BOOK_MOTIONS | keyof typeof GUIDE_MOTIONS | 'magnifier' | 'experiment'>(host, clips, (id, seconds) => {
  if (id === 'camera' || id === 'riffle') {
    magnifier?.stop();
    extraMagnifier?.stop();
    demo.seekBookMotion(id, seconds);
    return;
  }
  if (id === 'guided' || id === 'orbit') {
    if (id === 'orbit' && activeCanvas().hidden) {
      if (demo.experimentClip()) demo.seekExperiment(0);
      else demo.seek('popup', DEMO_MOTIONS.popup.lastFrame / DEMO_MOTIONS.popup.fps);
    }
    views.seek(id, seconds);
    return;
  }
  if (id === 'experiment') {
    demo.seekExperiment(seconds);
    return;
  }
  if (id === 'magnifier') {
    const frame = seconds * MAGNIFIER_SWEEP.fps;
    const point = magnifierAt(frame);
    const optics = { zoom: magnifierZoomAt(frame) };
    const experiment = demo.experimentClip();
    if (experiment) {
      // Hold a raised apparatus pose while the optical track moves.
      demo.seekExperiment(Math.min(0.7, experiment.lastFrame / experiment.fps));
      extraMagnifier?.inspect(point, optics);
    } else {
      const popup = DEMO_MOTIONS.popup;
      demo.seek('popup', popup.lastFrame / popup.fps);
      magnifier?.inspect(point, optics);
    }
  } else {
    magnifier?.stop();
    extraMagnifier?.stop();
    demo.seek(id, seconds);
  }
});

let activeTerm = demo.experimentTerm()?.label;
document.addEventListener('inkleaf:lessonchange', () => {
  const label = demo.experimentTerm()?.label;
  if (activeTerm !== label) {
    magnifier?.stop();
    extraMagnifier?.stop();
    activeTerm = label;
  }
  panel.setClip('experiment', demo.experimentClip());
});
panel.setClip('experiment', demo.experimentClip());
mountStudyTools(host);

const printedTerm = document.querySelector<HTMLElement>('#term-label')!;
printedTerm.tabIndex = 0;
const inspectTerm = () => {
  if (!extraCanvas.hidden && demo.experimentTerm()) extraMagnifier?.inspect({ x: 0.5, y: 0.5 });
};
printedTerm.addEventListener('pointerenter', inspectTerm);
printedTerm.addEventListener('focus', inspectTerm);
