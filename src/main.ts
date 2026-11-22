import './demo/style.css';
import { TurnClock } from './engine/book/scheduler';
import { mountInspector } from './engine/core/inspector';
import { Registry } from './engine/core/registry';
import { Pendulum } from './engine/physics/pendulum';
import { physicsConfig } from './engine/physics/config';
import { lesson } from './demo/lesson';
import type { InteractiveLesson } from './demo/lesson-contract';
import { interactiveLessons } from './demo/lessons';
import { mountExtraExperiment } from './demo/library';
import { DEMO_MOTIONS, pageTurnAt, popupAt } from './demo/motion';
import type { mountPendulumFigure } from './demo/figure';
import type { MotionClip } from './motion/frames';

type Clip = keyof typeof DEMO_MOTIONS;
type Figure = ReturnType<typeof mountPendulumFigure>;
declare global {
  interface Window {
    inkleafDemo: {
      seek(id: Clip, seconds: number): void;
      seekExperiment(seconds: number): void;
      experimentClip(): MotionClip | null;
      experimentTerm(): InteractiveLesson['term'] | null;
      movePage(direction: -1 | 1): void;
    };
  }
}

const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const notebook = get('notebook');
const cover = get('cover-copy');
const experiment = get('experiment');
const notes = get('lesson-copy');
const contents = get('contents-copy');
const contentsList = get('contents-list');
const extraExperiment = get('extra-experiment');
const next = get<HTMLButtonElement>('open-book');
const prev = get<HTMLButtonElement>('previous');
const contentsButton = get<HTMLButtonElement>('contents');
const earlierButton = get<HTMLButtonElement>('previous-lesson');
const laterButton = get<HTMLButtonElement>('next-lesson');
const liftButton = get<HTMLButtonElement>('lift');
const release = get<HTMLButtonElement>('release');
const reset = get<HTMLButtonElement>('reset');
const drag = get<HTMLInputElement>('drag');
const angle = get<HTMLInputElement>('angle');
const canvas = get<HTMLCanvasElement>('figure');
const diagram = document.querySelector<HTMLElement>('.diagram')!;
const leaf = document.querySelector<HTMLElement>('.leaf')!;
const result = get('result');
const still = matchMedia('(prefers-reduced-motion: reduce)');
const registry = new Registry();
const extra = mountExtraExperiment(registry, still);
const lessons = [...interactiveLessons.slice(0, 1), lesson, ...interactiveLessons.slice(1)];
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
get('cover-title').textContent = lesson.bookTitle;

const turnClock = new TurnClock();
const turn = new Float64Array(1);
let opened = false;
let contentsOpen = false;
let selected = lessons.indexOf(lesson);
let visiblePage = '';
let predictionOptions: HTMLInputElement[] = [];
let spreadTurn: { page: number | 'contents'; direction: -1 | 1; focus: boolean; landed: boolean } | undefined;
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
let grabbed: { id: number; x: number; y: number; moved: boolean } | undefined;
let initialEnergy = 0;

function paintLaunchSettings() {
  const radians = pendulum.num('theta0');
  const height = pendulum.num('L') * (1 - Math.cos(radians));
  initialEnergy = pendulum.num('m') * physicsConfig.constants.g * height;
  const degrees = Math.round(radians * 180 / Math.PI);
  angle.value = String(degrees);
  get<HTMLOutputElement>('angle-value').value = degrees + '°';
  get('model-specs').textContent = pendulum.num('m').toFixed(2) + ' kg · ' + height.toFixed(2) + ' m release';
}

function setLaunchAngle(degrees: number) {
  if (!Number.isFinite(degrees)) return;
  const value = Math.max(-75, Math.min(75, Math.round(degrees)));
  pendulum.set('theta0', value * Math.PI / 180);
  swinging = false;
  paintLaunchSettings();
  paintApparatus();
}
paintLaunchSettings();

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

const contentsEntries = lessons.map((entry, index) => {
  const item = document.createElement('li');
  const button = document.createElement('button');
  const number = document.createElement('span');
  number.className = 'contents-number';
  number.textContent = String(index + 1).padStart(2, '0');
  number.setAttribute('aria-hidden', 'true');
  button.type = 'button';
  button.append(number, entry.title);
  button.addEventListener('click', () => selectLesson(index));
  item.append(button);
  contentsList.append(item);
  return button;
});

function activeLesson() {
  return lessons[selected]!;
}

function paintNotes() {
  const entry = activeLesson();
  get('lesson-title').textContent = entry.title;
  get('lesson-description').textContent = entry.description;
  get('prediction-question').textContent = entry.prediction.question;
  get('prediction-explanation').textContent = entry.prediction.explanation;
  get<HTMLDetailsElement>('prediction-explanation').closest('details')!.open = false;
  get('lesson-term').hidden = !('term' in entry);
  if ('term' in entry) {
    get('term-label').textContent = entry.term.label;
    get('term-definition').textContent = entry.term.definition;
  }

  const options = get('prediction-options');
  options.replaceChildren();
  predictionOptions = entry.prediction.options.map((option, index) => {
    const label = document.createElement('label');
    label.className = 'choice';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'prediction';
    radio.addEventListener('change', () => {
      if ('kind' in entry) extra.predict(index);
      else prediction = index;
      showPrediction();
      save();
    });
    label.append(radio, option);
    options.append(label);
    return radio;
  });
  showPrediction();
}

function showPrediction() {
  const entry = activeLesson();
  const isExtra = 'kind' in entry;
  const answer = isExtra ? extra.prediction() : prediction;
  const chosen = predictionOptions[answer];
  if (chosen) chosen.checked = true;
  get('prediction-feedback').textContent = !chosen ? '' : isExtra
    ? 'Prediction recorded. Run the experiment and compare it with the readings.'
    : prediction === lesson.prediction.correct
      ? 'That matches the ideal swing. Release the bob and check.'
      : 'Keep that prediction in mind. Release the bob and check.';
}

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ opened, contentsOpen, selected: activeLesson().id, prediction, drag: drag.checked, launchAngle: pendulum.num('theta0') }));
  } catch { /* Storage can be disabled. */ }
}

function setBook(open: boolean) {
  opened = open;
  const entry = activeLesson();
  const showingContents = open && contentsOpen;
  const showingLesson = open && !contentsOpen;
  const isExtra = 'kind' in entry;
  notebook.classList.toggle('open', open);
  cover.hidden = open;
  contents.hidden = contentsList.hidden = !showingContents;
  notes.hidden = !showingLesson;
  experiment.hidden = !showingLesson || isExtra;
  extraExperiment.hidden = !showingLesson || !isExtra;
  contentsButton.setAttribute('aria-expanded', String(showingContents));
  contentsEntries.forEach((button, index) => {
    if (index === selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  earlierButton.hidden = laterButton.hidden = !showingLesson;
  earlierButton.disabled = selected === 0;
  laterButton.disabled = selected === lessons.length - 1;
  const page = showingLesson ? entry.id : showingContents ? 'contents' : 'cover';
  if (page !== visiblePage) {
    visiblePage = page;
    extra.select(showingLesson && isExtra ? entry : undefined);
    if (showingLesson) paintNotes();
    if (experiment.hidden) {
      swinging = false;
      focusRelease = false;
    }
    document.dispatchEvent(new Event('inkleaf:lessonchange'));
  }
  if (open) {
    leaf.style.setProperty('--mobile-leaf-height', experiment.parentElement!.getBoundingClientRect().height + 'px');
  } else {
    leaf.style.removeProperty('--mobile-leaf-height');
  }
}

function focusPage() {
  get(contentsOpen ? 'contents-title' : 'lesson-title').focus();
}

function openSpread(page: number | 'contents', focus: boolean) {
  contentsOpen = page === 'contents';
  if (typeof page === 'number') selected = page;
  setBook(true);
  if (focus) focusPage();
  save();
}

function turnToSpread(page: number | 'contents', direction: -1 | 1, focus: boolean) {
  if (still.matches) {
    openSpread(page, focus);
    return;
  }
  spreadTurn = { page, direction, focus, landed: false };
  turn[0] = direction === 1 ? 0 : 1;
  void turnClock.start([{
    leaf: 0, to: direction === 1 ? 1 : 0, dur: motionTime('turn'), delay: 0, ease: 'linear',
  }], turn);
  paintTurn();
  requestFrame();
}

function selectLesson(index: number, focus = true) {
  if (!lessons[index] || turnClock.active) return;
  if (opened) {
    if (contentsOpen || index !== selected) turnToSpread(index, contentsOpen || index > selected ? 1 : -1, focus);
  } else {
    selected = index;
    contentsOpen = false;
    goTo(true);
  }
}

function toggleContents() {
  if (turnClock.active) return;
  if (opened) {
    if (contentsOpen) turnToSpread(selected, 1, true);
    else turnToSpread('contents', -1, true);
  } else {
    contentsOpen = true;
    goTo(true);
  }
}

function movePage(direction: -1 | 1) {
  if (!opened) {
    if (direction === 1) goTo(true);
  } else if (contentsOpen) {
    if (direction === 1) selectLesson(0);
    else goTo(false);
  } else if (selected === 0 && direction === -1) {
    toggleContents();
  } else {
    selectLesson(selected + direction);
  }
}

function paintTurn() {
  let progress = turn[0] ?? 0;
  const currentTurn = spreadTurn;
  if (currentTurn) {
    const crossedSpine = currentTurn.direction === 1 ? progress >= 0.5 : progress <= 0.5;
    if (crossedSpine && !currentTurn.landed) {
      currentTurn.landed = true;
      openSpread(currentTurn.page, false);
    }
    if (!turnClock.active) {
      spreadTurn = undefined;
      turn[0] = progress = 1;
      if (currentTurn.focus) focusPage();
    }
  }
  leaf.classList.toggle('spread-turn', !!spreadTurn);
  leaf.style.setProperty('--turn-angle', pageTurnAt(progress).angleDeg + 'deg');
  leaf.hidden = !spreadTurn && progress >= 1;
  next.hidden = opened || progress > 0 || turnClock.active;
  prev.hidden = !opened || (turnClock.active && !spreadTurn);
}

function goTo(open: boolean) {
  if (turnClock.active || open === opened) return;
  if (!open) {
    swinging = false;
    focusRelease = false;
    contentsOpen = false;
  }
  setBook(open);
  if (!open) get('book-title').focus({ preventScroll: true });
  if (still.matches) {
    turn[0] = Number(open);
    if (open) focusPage();
  } else {
    void turnClock.start([{ leaf: 0, to: Number(open), dur: motionTime('turn'), delay: 0, ease: 'linear' }], turn)
      .then(() => { if (open && opened && turn[0] === 1) focusPage(); });
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
  const currentAngle = pendulum.state.theta;
  diagram.style.setProperty('--bob-angle', -currentAngle + 'rad');
  diagram.style.setProperty('--lift', String(lift));
  figure?.setPose(lift, currentAngle);
  liftButton.hidden = popup > 0;
  get('angle-control').hidden = popup < 1;
  angle.disabled = swinging;
  release.hidden = popup === 0;
  release.disabled = popup < 1 || swinging || pendulum.state.phase === 'swinging' || pendulum.num('theta0') === 0;
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
  spreadTurn = undefined;
  turnClock.finish();
  popupStarted = false;
  focusRelease = false;
  swinging = false;
  selected = lessons.indexOf(lesson);
  contentsOpen = false;
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
window.inkleafDemo = { seek, seekExperiment: extra.seek, experimentClip: extra.clip, experimentTerm: extra.term, movePage };

next.addEventListener('click', () => goTo(true));
prev.addEventListener('click', () => goTo(false));
contentsButton.addEventListener('click', toggleContents);
earlierButton.addEventListener('click', () => movePage(-1));
laterButton.addEventListener('click', () => movePage(1));
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
function releaseBob() {
  if (popup < 1 || swinging || pendulum.state.phase !== 'held' || pendulum.num('theta0') === 0) return;
  pendulum.release();
  swinging = true;
  showResult('Bob released.');
  paintApparatus();
  reset.focus({ preventScroll: true });
  requestFrame();
}

release.addEventListener('click', releaseBob);
angle.addEventListener('input', () => {
  setLaunchAngle(angle.valueAsNumber);
  showResult(angle.valueAsNumber === 0 ? 'At zero degrees the bob is at rest. Choose a different angle to swing.' : '');
  save();
});
canvas.addEventListener('pointerdown', (event) => {
  if (popup < 1 || grabbed || !event.isPrimary || event.button !== 0 || canvas.dataset.loupeActive === 'true' ||
    figure?.angleAt(event.clientX, event.clientY, true) === undefined) return;
  grabbed = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  canvas.setPointerCapture(event.pointerId);
  canvas.setAttribute('data-grabbing', '');
});
canvas.addEventListener('pointermove', (event) => {
  if (grabbed?.id !== event.pointerId) return;
  if (!grabbed.moved && Math.hypot(event.clientX - grabbed.x, event.clientY - grabbed.y) < 5) return;
  grabbed.moved = true;
  const degrees = figure?.angleAt(event.clientX, event.clientY, false);
  if (degrees !== undefined) setLaunchAngle(degrees);
});
function endGrab(event: PointerEvent, shouldRelease: boolean) {
  if (grabbed?.id !== event.pointerId) return;
  const moved = grabbed.moved;
  grabbed = undefined;
  canvas.removeAttribute('data-grabbing');
  if (moved) {
    if (shouldRelease) releaseBob();
    save();
  }
}
canvas.addEventListener('pointerup', (event) => endGrab(event, true));
canvas.addEventListener('pointercancel', (event) => endGrab(event, false));
canvas.addEventListener('lostpointercapture', (event) => endGrab(event, false));
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
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    event.preventDefault();
    movePage(event.key === 'ArrowRight' ? 1 : -1);
  }
});

try {
  const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
  if (Number.isInteger(saved?.prediction)) prediction = saved.prediction;
  const savedLesson = lessons.findIndex((entry) => entry.id === saved?.selected);
  if (savedLesson >= 0) selected = savedLesson;
  contentsOpen = saved?.opened === true && saved?.contentsOpen === true;
  drag.checked = saved?.drag === true;
  pendulum.set('drag', drag.checked ? lesson.swing.drag : 0);
  if (typeof saved?.launchAngle === 'number' && Number.isFinite(saved.launchAngle)) {
    const limit = 75 * Math.PI / 180;
    pendulum.set('theta0', Math.max(-limit, Math.min(limit, saved.launchAngle)));
  }
  paintLaunchSettings();
  setBook(saved?.opened === true);
} catch {
  setBook(false);
}
turn[0] = Number(opened);
paintTurn();
paintApparatus();

registry.add({
  id: 'demo.swing.gravity', label: 'Gravity in the model', kind: 'constant',
  tags: ['physics', 'data'], parent: 'demo.swing', source: 'src/engine/physics/config.ts',
  describe: physicsConfig.constants.g + ' N/kg',
});
