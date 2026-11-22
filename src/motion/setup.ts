import '../main';
import './tools.css';
import { DEMO_MOTIONS, MAGNIFIER_SWEEP, magnifierAt } from '../demo/motion';
import { mountMagnifier } from './magnifier';
import { mountMotionPanel } from './panel';

const button = document.createElement('button');
button.type = 'button';
button.textContent = 'Magnifier';
button.setAttribute('aria-pressed', 'false');
document.querySelector('.controls')!.append(button);
const magnifier = mountMagnifier(document.querySelector<HTMLCanvasElement>('#figure')!, button);

const clips = { ...DEMO_MOTIONS, magnifier: MAGNIFIER_SWEEP };
mountMotionPanel(document.querySelector('main')!, clips, (id, seconds) => {
  if (id === 'magnifier') {
    const popup = DEMO_MOTIONS.popup;
    window.inkleafDemo.seek('popup', popup.lastFrame / popup.fps);
    magnifier?.inspect(magnifierAt(seconds * MAGNIFIER_SWEEP.fps));
  } else {
    magnifier?.stop();
    window.inkleafDemo.seek(id, seconds);
  }
});
