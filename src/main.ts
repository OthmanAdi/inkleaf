import './demo/style.css';
import { TurnClock } from './engine/book/scheduler';
import { mountInspector } from './engine/core/inspector';
import { Registry } from './engine/core/registry';
import { Pendulum } from './engine/physics/pendulum';
import { physicsConfig } from './engine/physics/config';
import { lesson } from './demo/lesson';
import { DEMO_MOTIONS, pageTurnAt, popupAt } from './demo/motion';
import type { mountPendulumFigure } from './demo/figure';

type Clip = keyof typeof DEMO_MOTIONS;
type Figure = ReturnType<typeof mountPendulumFigure>;
declare global {
  interface Window {
    inkleafDemo: { seek(id: Clip, seconds: number): void };
  }
}

const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const notebook = get('notebook');
const cover = get('cover-copy');
const experiment = get('experiment');
const notes = get('lesson-copy');
const next = get<HTMLButtonElement>('open-book');
const prev = get<HTMLButtonElement>('previous');
const liftButton = get<HTMLButtonElement>('lift');
const release = get<HTMLButtonElement>('release');
const reset = get<HTMLButtonElement>('reset');
const drag = get<HTMLInputElement>('drag');
const canvas = get<HTMLCanvasElement>('figure');
const diagram = document.querySelector<HTMLElement>('.diagram')!;
const leaf = document.querySelector<HTMLElement>('.leaf')!;
const result = get('result');
const still = matchMedia('(prefers-reduced-motion: reduce)');
const registry = new Registry();
const motionTime = (id: Clip) => DEMO_MOTIONS[id].lastFrame / DEMO_MOTIONS[id].fps;
const storageKey = 'inkleaf.demo.' + lesson.id;
const pendulum = new Pendulum({
  params: {
    m: lesson.swing.massKg, L: lesson.swing.lengthM,
    theta0: -lesson.swing.startAngleDeg * Math.PI / 180, drag: 0, damping: 0,
  },
});

get('book-title').textContent = lesson.bookTitle;
get('lesson-book-title').textContent = lesson.bookTitle;
get('cover-title').textContent = lesson.title;
get('lesson-title').textContent = lesson.title;
get('lesson-description').textContent = lesson.description;
get('prediction-question').textContent = lesson.prediction.question;
get('prediction-explanation').textContent = lesson.prediction.explanation;

const predictionOptions = lesson.prediction.options.map((option, index) => {
  const label = document.createElement('label');
  label.className = 'choice';
  const radio = document.createElement('input');
  radio.type = 'radio';
  radio.name = 'prediction';
  radio.addEventListener('change', () => {
    prediction = index;
    showPrediction();
    save();
  });
  label.append(radio, option);
  get('prediction-options').append(label);
  return radio;
});

const turnClock = new TurnClock();
const turn = new Float64Array(1);
let opened = false;
let popup = 0;
let popupStarted = false;
let focusRelease = false;
let swinging = false;
let prediction = -1;
let figure: Figure;
let figureLoad: Promise<void> | undefined;
let framePending = false;
let lastFrame = 0;
let lastResult = '';
const initialEnergy = pendulum.energies()[pendulum.accounts.gravitational] ?? 0;
const height = pendulum.num('L') * (1 - Math.cos(pendulum.num('theta0')));
get('model-specs').textContent = pendulum.num('m').toFixed(2) + ' kg · ' + height.toFixed(2) + ' m release';

const energies = (['gravitational', 'kinetic', 'thermal'] as const).map(key => ({
  account: pendulum.accounts[key], number: get(key), bar: get('bar-' + key),
}));

for (const [id, label, kind, tags, source] of [
  ['demo', lesson.bookTitle, 'book', ['book'], 'src/demo/lesson.ts'],
  ['demo.turn', 'Turn the notebook leaf', 'animation', ['book', 'animation'], 'src/demo/motion.ts'],
  ['demo.popup', 'Raise the paper apparatus', 'animation', ['ink', 'animation'], 'src/demo/motion.ts'],
  ['demo.swing', 'Pendulum energy model', 'simulation', ['physics', 'energy'], 'src/demo/lesson.ts'],
] as const) {
  registry.add({ id, label, kind, tags, source, parent: id === 'demo' ? undefined : 'demo' });
}

function showPrediction() {
  const chosen = predictionOptions[prediction];
  if (chosen) chosen.checked = true;
  get('prediction-feedback').textContent = !chosen ? '' : prediction === lesson.prediction.correct
    ? 'That matches the ideal swing. Release the bob and check.'
    : 'Keep that prediction in mind. Release the bob and check.';
}

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ opened, prediction, drag: drag.checked }));
  } catch { /* Storage can be disabled. */ }
}

function setBook(open: boolean) {
  opened = open;
  notebook.classList.toggle('open', open);
  cover.hidden = open;
  notes.hidden = !open;
  experiment.hidden = !open;
  if (open) {
    leaf.style.setProperty('--mobile-leaf-height', experiment.parentElement!.getBoundingClientRect().height + 'px');
  } else {
    leaf.style.removeProperty('--mobile-leaf-height');
  }
}

function paintTurn() {
  const progress = turn[0] ?? 0;
  leaf.style.setProperty('--turn-angle', pageTurnAt(progress).angleDeg + 'deg');
  leaf.hidden = progress >= 1;
  next.hidden = progress > 0 || turnClock.active;
  prev.hidden = !opened || turnClock.active;
}

function goTo(open: boolean) {
  if (turnClock.active || open === opened) return;
  if (!open) {
    swinging = false;
    focusRelease = false;
  }
  setBook(open);
  if (!open) get('book-title').focus({ preventScroll: true });
  if (still.matches) {
    turn[0] = Number(open);
    if (open) get('lesson-title').focus({ preventScroll: true });
  } else {
    void turnClock.start([{ leaf: 0, to: Number(open), dur: motionTime('turn'), delay: 0, ease: 'linear' }], turn)
      .then(() => { if (open && turn[0] === 1) get('lesson-title').focus({ preventScroll: true }); });
    requestFrame();
  }
  paintTurn();
  save();
}

function showResult(message: string) {
  if (message === lastResult) return;
  lastResult = message;
  result.textContent = message;
}

function paintApparatus() {
  const lift = popupAt(popup).lift;
  const angle = pendulum.state.theta;
  diagram.style.setProperty('--bob-angle', -angle + 'rad');
  diagram.style.setProperty('--lift', String(lift));
  figure?.setPose(lift, angle);
  liftButton.hidden = popup > 0;
  release.hidden = popup === 0;
  release.disabled = popup < 1 || swinging || pendulum.state.phase === 'swinging';
  reset.hidden = popup === 0;
  drag.disabled = popup < 1 || swinging;
  const balances = pendulum.energies();
  for (const { account, number, bar } of energies) {
    const joules = Math.max(0, balances[account] ?? 0);
    const text = joules.toFixed(3) + ' J';
    if (number.textContent !== text) number.textContent = text;
    bar.style.transform = 'scaleX(' + (initialEnergy > 0 ? Math.min(1, joules / initialEnergy) : 0) + ')';
  }
}

function showObservation() {
  const pass = pendulum.state.passes[0];
  const turnPoint = pendulum.state.turns[0];
  if (!pass) return;
  const speed = 'First pass ' + pass.speed.toFixed(2) + ' m/s.';
  const rise = turnPoint
    ? ' Far side ' + (pendulum.num('L') * (1 - Math.cos(turnPoint.theta))).toFixed(3) + ' m.'
    : '';
  showResult(speed + rise);
}

function prepareFigure() {
  if (figureLoad) return;
  figureLoad = import('./demo/figure')
    .then(({ mountPendulumFigure }) => {
      figure = mountPendulumFigure(canvas, registry);
      if (figure) {
        paintApparatus();
        diagram.hidden = true;
      }
    })
    .catch((error: unknown) => console.warn('Using the printed pendulum diagram', error));
}

function requestFrame() {
  if (framePending) return;
  framePending = true;
  requestAnimationFrame(frame);
}

function frame(now: number) {
  const delta = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
  lastFrame = now;
  framePending = false;
  if (turnClock.update(still.matches ? motionTime('turn') : delta, turn)) paintTurn();
  if (popupStarted) {
    popup = still.matches ? 1 : Math.min(1, popup + delta / motionTime('popup'));
    if (popup >= 1) {
      popupStarted = false;
      showResult('Ready. Release the bob, then try again with air drag.');
    }
  }
  if (swinging) {
    if (still.matches) {
      sampleSwing(motionTime('swing'));
      swinging = false;
    } else {
      pendulum.step(delta);
      swinging = pendulum.time < 7;
    }
    showObservation();
  }
  paintApparatus();
  if (focusRelease && popup >= 1) {
    focusRelease = false;
    release.focus({ preventScroll: true });
  }
  if (turnClock.active || popupStarted || swinging) requestFrame();
  else lastFrame = 0;
}

function sampleSwing(seconds: number) {
  pendulum.reset();
  if (seconds <= 0) return;
  pendulum.release();
  const wholeSteps = Math.floor(seconds * 60);
  for (let i = 0; i < wholeSteps; i++) pendulum.step(1 / 60);
  pendulum.step(seconds - wholeSteps / 60);
}

function seek(id: Clip, seconds: number) {
  if (!Number.isFinite(seconds)) return;
  const progress = Math.max(0, Math.min(1, seconds / motionTime(id)));
  turnClock.finish();
  popupStarted = false;
  focusRelease = false;
  swinging = false;
  if (id === 'turn') {
    setBook(progress > 0);
    turn[0] = progress;
    popup = 0;
    sampleSwing(0);
    showResult('');
  } else {
    setBook(true);
    turn[0] = 1;
    if (id === 'popup') {
      popup = progress;
      sampleSwing(0);
      showResult('');
    } else {
      popup = 1;
      sampleSwing(progress * motionTime('swing'));
      showResult('');
      showObservation();
    }
    if (popup > 0) prepareFigure();
  }
  paintTurn();
  paintApparatus();
}
window.inkleafDemo = { seek };

next.addEventListener('click', () => goTo(true));
prev.addEventListener('click', () => goTo(false));
liftButton.addEventListener('click', () => {
  if (popupStarted || popup > 0) return;
  prepareFigure();
  popup = still.matches ? 1 : 0.001;
  popupStarted = popup < 1;
  paintApparatus();
  if (popupStarted) focusRelease = true;
  else release.focus({ preventScroll: true });
  showResult(popupStarted ? 'Raising the apparatus.' : 'Ready. Release the bob, then try again with air drag.');
  if (popupStarted) requestFrame();
});
release.addEventListener('click', () => {
  if (popup < 1 || swinging || pendulum.state.phase !== 'held') return;
  pendulum.release();
  swinging = true;
  showResult('Bob released.');
  paintApparatus();
  reset.focus({ preventScroll: true });
  requestFrame();
});
reset.addEventListener('click', () => {
  swinging = false;
  pendulum.reset();
  showResult('Bob reset at its release height.');
  paintApparatus();
});
drag.addEventListener('change', () => {
  swinging = false;
  pendulum.set('drag', drag.checked ? lesson.swing.drag : 0);
  showResult(drag.checked ? 'Air drag on. Release the bob to compare.' : 'Air drag off. Release the bob to compare.');
  paintApparatus();
  save();
});

let inspector: ReturnType<typeof mountInspector> | undefined;
const inspectorButton = get<HTMLButtonElement>('inspector');
const toggleInspector = () => {
  if (inspector) inspector.toggle();
  else {
    inspector = mountInspector(registry);
    inspector.el.addEventListener('click', event => {
      if ((event.target as HTMLElement).matches('[data-close]')) inspectorButton.setAttribute('aria-expanded', 'false');
    });
  }
  inspectorButton.setAttribute('aria-expanded', String(!inspector.el.hidden));
};
inspectorButton.addEventListener('click', toggleInspector);
if (new URLSearchParams(location.search).has('inspect')) toggleInspector();
document.addEventListener('keydown', (event) => {
  if (event.shiftKey && event.key.toLowerCase() === 'i') toggleInspector();
  const target = event.target as HTMLElement | null;
  if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey ||
    target?.closest('input, button, summary, textarea, select, [contenteditable]')) return;
  if (event.key === 'ArrowRight') goTo(true);
  if (event.key === 'ArrowLeft') goTo(false);
});

try {
  const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
  if (Number.isInteger(saved?.prediction)) prediction = saved.prediction;
  drag.checked = saved?.drag === true;
  pendulum.set('drag', drag.checked ? lesson.swing.drag : 0);
  setBook(saved?.opened === true);
} catch {
  setBook(false);
}
turn[0] = Number(opened);
showPrediction();
paintTurn();
paintApparatus();

registry.add({
  id: 'demo.swing.gravity', label: 'Gravity in the model', kind: 'constant',
  tags: ['physics', 'data'], parent: 'demo.swing', source: 'src/engine/physics/config.ts',
  describe: physicsConfig.constants.g + ' N/kg',
});
