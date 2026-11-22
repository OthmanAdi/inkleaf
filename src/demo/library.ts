import type { Registry } from '../engine/core/registry';
import type { MotionClip } from '../motion/frames';
import type { InteractiveLesson, LessonSample } from './lesson-contract';
import type { mountLessonFigure } from './lesson-figures';
import { popupAt } from './motion';

type Figure = ReturnType<typeof mountLessonFigure>;
type Answers = { prediction: number; setting: number };

export function mountExtraExperiment(registry: Registry, reducedMotion: MediaQueryList) {
  const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const canvas = get<HTMLCanvasElement>('extra-figure');
  const fallback = get('extra-fallback');
  const fallbackReading = get('extra-fallback-reading');
  const run = get<HTMLButtonElement>('extra-run');
  const reset = get<HTMLButtonElement>('extra-reset');
  const setting = get<HTMLSelectElement>('extra-setting');
  const readings = get('extra-readouts');
  const result = get('extra-result');
  const answers = new Map<string, Answers>();
  let active: InteractiveLesson | undefined;
  let current: Answers | undefined;
  let renderEpoch = 0;
  let frame = 0;
  let seconds = 0;
  let figure: Figure;
  let pointer: { id: number; x: number; y: number; setting?: number } | undefined;
  let readingSlots: { label: HTMLElement; value: HTMLElement }[] = [];

  function save() {
    if (!active || !current) return;
    try {
      localStorage.setItem('inkleaf.demo.' + active.id, JSON.stringify(current));
    } catch { /* Storage can be disabled. */ }
  }

  function answerFor(lesson: InteractiveLesson): Answers {
    const existing = answers.get(lesson.id);
    if (existing) return existing;
    const answer = { prediction: -1, setting: 0 };
    try {
      const saved = JSON.parse(localStorage.getItem('inkleaf.demo.' + lesson.id) ?? '{}');
      if (Number.isInteger(saved?.prediction) && lesson.prediction.options[saved.prediction]) answer.prediction = saved.prediction;
      if (Number.isInteger(saved?.setting) && lesson.settings.options[saved.setting]) answer.setting = saved.setting;
    } catch { /* Storage can be disabled or contain an earlier format. */ }
    answers.set(lesson.id, answer);
    return answer;
  }

  function paintReadings(sample: LessonSample) {
    if (readingSlots.length !== sample.readings.length) {
      readingSlots = sample.readings.map(() => {
        const row = document.createElement('div');
        const label = document.createElement('dt');
        const value = document.createElement('dd');
        row.append(label, value);
        return { label, value };
      });
      readings.replaceChildren(...readingSlots.map(({ label }) => label.parentElement!));
    }
    sample.readings.forEach(({ label, value }, index) => {
      const slot = readingSlots[index]!;
      if (slot.label.textContent !== label) slot.label.textContent = label;
      if (slot.value.textContent !== value) slot.value.textContent = value;
    });
    const first = sample.readings[0];
    fallbackReading.textContent = first ? `${first.label} · ${first.value}` : '';
    fallback.style.setProperty('--trace-fill', String(sample.pose.primary));
  }

  function paint(at: number, announce = true) {
    if (!active || !current) return;
    seconds = Math.max(0, Math.min(at, active.duration));
    const sample = active.sample(seconds, current.setting);
    paintReadings(sample);
    const lift = reducedMotion.matches ? 1 : popupAt(Math.min(1, seconds / 0.65)).lift;
    figure?.setPose(lift, sample.pose);
    if (announce && result.textContent !== sample.note) result.textContent = sample.note;
  }

  function pause() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    run.disabled = false;
  }

  function select(lesson?: InteractiveLesson) {
    if (active === lesson) return;
    pause();
    pointer = undefined;
    renderEpoch++;
    figure?.dispose();
    figure = undefined;
    canvas.hidden = true;
    fallback.hidden = false;
    active = lesson;
    current = undefined;
    if (!lesson) return;
    current = answerFor(lesson);
    get('extra-caption').textContent = lesson.title;
    get('extra-fallback-title').textContent = lesson.title;
    get('extra-setting-label').textContent = lesson.settings.label;
    run.textContent = lesson.action;
    setting.replaceChildren(...lesson.settings.options.map((label, index) => new Option(label, String(index))));
    setting.value = String(current.setting);
    paint(0);
    const epoch = renderEpoch;
    void import('./lesson-figures').then(({ mountLessonFigure }) => {
      if (epoch !== renderEpoch) return;
      // A renderer may measure the plate during construction.
      canvas.hidden = false;
      figure = mountLessonFigure(canvas, lesson.kind, registry);
      canvas.hidden = !figure;
      fallback.hidden = !!figure;
      paint(seconds, false);
    }).catch((error: unknown) => {
      if (epoch !== renderEpoch) return;
      canvas.hidden = true;
      fallback.hidden = false;
      console.warn('Using the printed experiment readings', error);
    });
  }

  function seek(time: number) {
    if (!active || !Number.isFinite(time)) return;
    pause();
    paint(time);
  }

  run.addEventListener('click', () => {
    if (!active) return;
    pause();
    const duration = active.duration;
    if (reducedMotion.matches) {
      paint(duration);
      return;
    }
    let start: number | undefined;
    paint(0, false);
    result.textContent = 'Running experiment.';
    reset.focus({ preventScroll: true });
    run.disabled = true;
    const advance = (now: number) => {
      start ??= now;
      const elapsed = (now - start) / 1000;
      const complete = elapsed >= duration || reducedMotion.matches;
      paint(complete ? duration : elapsed, complete);
      if (complete) pause();
      else frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
  });
  reset.addEventListener('click', () => seek(0));
  setting.addEventListener('change', () => {
    if (!current) return;
    current.setting = Number(setting.value);
    save();
    seek(0);
  });

  canvas.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    const hit = figure?.pickAction(event.clientX, event.clientY);
    pointer = hit ? { id: event.pointerId, x: event.clientX, y: event.clientY, setting: hit.setting } : undefined;
  });
  canvas.addEventListener('pointercancel', () => { pointer = undefined; });
  canvas.addEventListener('pointerup', (event) => {
    const target = pointer;
    pointer = undefined;
    if (!target || target.id !== event.pointerId || Math.hypot(event.clientX - target.x, event.clientY - target.y) > 10) return;
    if (canvas.dataset.loupeActive === 'true' || !current) return;
    if (target.setting !== undefined) {
      setting.value = String(target.setting);
      setting.dispatchEvent(new Event('change'));
    }
    run.click();
  });

  return {
    select,
    seek,
    clip(): MotionClip | null {
      return active ? { label: active.title, fps: 60, lastFrame: Math.ceil(active.duration * 60) } : null;
    },
    term: () => active?.term ?? null,
    prediction: () => current?.prediction ?? -1,
    predict(index: number) {
      if (!current) return;
      current.prediction = index;
      save();
    },
  };
}
