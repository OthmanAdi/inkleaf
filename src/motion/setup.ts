import '../main';
import './tools.css';
import { DEMO_MOTIONS, MAGNIFIER_SWEEP, magnifierAt, type DemoMotionId } from '../demo/motion';
import { mountMagnifier } from './magnifier';
import { mountPageGestures } from './navigation-input';
import { mountMotionPanel } from './panel';

const demo = window.inkleafDemo;
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

const clips = { ...DEMO_MOTIONS, magnifier: MAGNIFIER_SWEEP };
const panel = mountMotionPanel<DemoMotionId | 'magnifier' | 'experiment'>(document.querySelector('main')!, clips, (id, seconds) => {
  if (id === 'experiment') {
    demo.seekExperiment(seconds);
    return;
  }
  if (id === 'magnifier') {
    const point = magnifierAt(seconds * MAGNIFIER_SWEEP.fps);
    const experiment = demo.experimentClip();
    if (experiment) {
      demo.seekExperiment(0);
      extraMagnifier?.inspect(point);
    } else {
      const popup = DEMO_MOTIONS.popup;
      demo.seek('popup', popup.lastFrame / popup.fps);
      magnifier?.inspect(point);
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
