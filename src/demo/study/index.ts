import { Registry } from '../../engine/core/registry';
import { createSound, type SoundEngine } from '../../engine/sound/engine';
import { glossary, sources, studyLessons, studyQuestions } from './content';
import './study.css';

type View = 'quiz' | 'glossary' | 'notes';

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function labeledValue(label: string, value: string): HTMLElement {
  const block = make('section', 'study-note-block');
  block.append(make('h4', undefined, label), make('p', undefined, value));
  return block;
}

export function mountStudyTools(host: HTMLElement): () => void {
  const root = make('section', 'study-tools');
  root.setAttribute('aria-labelledby', 'study-heading');

  const header = make('header', 'study-header');
  const heading = make('div');
  heading.append(make('p', 'study-kicker', 'WHERE ENERGY GOES'), make('h2', undefined, 'Study desk'), make('p', 'study-intro', 'Check what you know, look up a term, or prepare a lesson.'));
  heading.querySelector('h2')!.id = 'study-heading';

  const settings = make('div', 'study-settings');
  const contrast = make('button', 'study-setting', 'Higher contrast');
  contrast.type = 'button';
  contrast.setAttribute('aria-pressed', 'false');
  const soundToggle = make('button', 'study-setting', 'Page sound: off');
  soundToggle.type = 'button';
  soundToggle.setAttribute('aria-pressed', 'false');
  const soundStatus = make('span', 'study-sr-only');
  soundStatus.setAttribute('role', 'status');
  settings.append(contrast, soundToggle, soundStatus);
  header.append(heading, settings);

  const nav = make('div', 'study-tabs');
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-label', 'Study tools');
  const tabDefs: readonly [View, string][] = [['quiz', 'Quick quiz'], ['glossary', 'Glossary'], ['notes', 'Sources & teaching notes']];
  const tabs = new Map<View, HTMLButtonElement>();
  for (const [view, label] of tabDefs) {
    const tab = make('button', 'study-tab', label);
    tab.type = 'button';
    tab.id = `study-tab-${view}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `study-panel-${view}`);
    tab.setAttribute('aria-selected', 'false');
    tab.tabIndex = -1;
    tabs.set(view, tab);
    nav.append(tab);
  }

  const panels = new Map<View, HTMLElement>();
  for (const [view] of tabDefs) {
    const panel = make('div', 'study-panel');
    panel.id = `study-panel-${view}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `study-tab-${view}`);
    panel.tabIndex = 0;
    panel.hidden = true;
    panels.set(view, panel);
  }
  root.append(header, nav, ...panels.values());

  let activeView: View = 'quiz';
  let sound: SoundEngine | undefined;
  const soundRegistry = new Registry();
  let questionIndex = 0;
  let score = 0;
  let answered = false;
  let selectedAnswer = -1;
  let currentLesson = 1;

  const pageSound = () => {
    if (sound?.enabled) sound.play('pageTurn', { gain: 0.32 });
  };

  function activate(view: View, focus = false): void {
    if (view !== activeView) pageSound();
    activeView = view;
    for (const [name, tab] of tabs) {
      const active = name === view;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      panels.get(name)!.hidden = !active;
    }
    if (focus) tabs.get(view)!.focus();
  }

  for (const [view, tab] of tabs) {
    tab.addEventListener('click', () => activate(view));
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      const names = tabDefs.map(([name]) => name);
      const i = names.indexOf(view);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? names.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : names.length - 1)) % names.length;
      activate(names[next]!, true);
    });
  }

  function renderQuestion(): void {
    const panel = panels.get('quiz')!;
    panel.replaceChildren();
    if (questionIndex >= studyQuestions.length) {
      const done = make('div', 'study-complete');
      done.append(make('p', 'study-kicker', 'ROUND COMPLETE'), make('h3', undefined, `You got ${score} of ${studyQuestions.length}`));
      done.append(make('p', undefined, score === studyQuestions.length ? 'Every answer is right. The explanations are there if you want to revisit the reasoning.' : 'Use each explanation to spot a useful topic to revisit.'));
      const retry = make('button', 'study-action', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', () => {
        questionIndex = 0;
        score = 0;
        selectedAnswer = -1;
        answered = false;
        renderQuestion();
        panel.querySelector<HTMLInputElement>('input')?.focus();
      });
      done.append(retry);
      panel.append(done);
      return;
    }

    const q = studyQuestions[questionIndex]!;
    const lesson = studyLessons.find((item) => item.n === q.lesson)!;
    const meta = make('div', 'study-question-meta');
    meta.append(make('span', undefined, `Question ${questionIndex + 1} of ${studyQuestions.length}`), make('span', undefined, `Lesson ${q.lesson} · ${lesson.title}`));
    const form = make('form', 'study-question');
    form.noValidate = true;
    const fieldset = make('fieldset');
    fieldset.append(make('legend', undefined, q.question));
    q.options.forEach((option, index) => {
      const label = make('label', 'study-option');
      const input = make('input');
      input.type = 'radio';
      input.name = 'study-answer';
      input.value = String(index);
      input.checked = selectedAnswer === index;
      input.disabled = answered;
      input.addEventListener('change', () => { selectedAnswer = index; });
      label.append(input, make('span', undefined, option));
      fieldset.append(label);
    });
    const feedback = make('p', 'study-feedback');
    feedback.setAttribute('aria-live', 'polite');
    const actions = make('div', 'study-actions');
    const submit = make('button', 'study-action', answered ? 'Continue' : 'Check answer');
    submit.type = 'submit';
    actions.append(submit);
    form.append(fieldset, feedback, actions);
    if (answered) {
      const right = selectedAnswer === q.answer;
      feedback.classList.add(right ? 'is-right' : 'is-wrong');
      feedback.textContent = `${right ? 'Correct.' : `Not quite. The answer is ${q.options[q.answer]}.`} ${q.explanation}`;
    }
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (answered) {
        questionIndex++;
        selectedAnswer = -1;
        answered = false;
        pageSound();
        renderQuestion();
        return;
      }
      if (selectedAnswer < 0) {
        feedback.textContent = 'Choose an answer first.';
        return;
      }
      answered = true;
      if (selectedAnswer === q.answer) score++;
      renderQuestion();
      panel.querySelector<HTMLButtonElement>('.study-action')?.focus();
    });
    panel.append(meta, form);
  }

  function renderGlossary(): void {
    const panel = panels.get('glossary')!;
    const label = make('label', 'study-search-label', 'Find a term');
    const input = make('input', 'study-search');
    input.type = 'search';
    input.placeholder = 'Try “power” or “thermal store”';
    input.setAttribute('aria-label', 'Search glossary terms and definitions');
    label.append(input);
    const count = make('p', 'study-result-count');
    count.setAttribute('aria-live', 'polite');
    const list = make('div', 'study-glossary-list');
    function filter(): void {
      const needle = input.value.trim().toLocaleLowerCase();
      const matches = glossary.filter((item) => `${item.term} ${item.definition}`.toLocaleLowerCase().includes(needle));
      count.textContent = `${matches.length} ${matches.length === 1 ? 'term' : 'terms'}`;
      list.replaceChildren();
      for (const item of matches) {
        const entry = make('article', 'study-glossary-entry');
        const top = make('div', 'study-glossary-top');
        top.append(make('h3', undefined, item.term));
        const lessonButtons = make('div', 'study-lesson-links');
        for (const n of item.lessons) {
          const lesson = studyLessons.find((row) => row.n === n)!;
          const button = make('button', 'study-lesson-link', `Lesson ${n}`);
          button.type = 'button';
          button.setAttribute('aria-label', `Open teaching notes for lesson ${n}: ${lesson.title}`);
          button.addEventListener('click', () => { setCurrentLesson(n); activate('notes'); });
          lessonButtons.append(button);
        }
        top.append(lessonButtons);
        entry.append(top, make('p', undefined, item.definition));
        list.append(entry);
      }
      if (!matches.length) list.append(make('p', 'study-empty', 'No matching terms. Try a shorter search.'));
    }
    input.addEventListener('input', filter);
    panel.replaceChildren(label, count, list);
    filter();
  }

  const notePanel = panels.get('notes')!;
  const noteSelectLabel = make('label', 'study-select-label', 'Lesson');
  const noteSelect = make('select', 'study-select');
  noteSelect.setAttribute('aria-label', 'Choose lesson notes');
  for (const lesson of studyLessons) {
    const option = make('option', undefined, `${lesson.n}. ${lesson.title}`);
    option.value = String(lesson.n);
    noteSelect.append(option);
  }
  noteSelectLabel.append(noteSelect);
  const noteContent = make('div', 'study-note-content');
  function setCurrentLesson(n: number): void {
    currentLesson = n;
    noteSelect.value = String(n);
    const lesson = studyLessons.find((item) => item.n === n)!;
    noteContent.replaceChildren();
    const title = make('h3', 'study-note-title', `Lesson ${lesson.n} · ${lesson.title}`);
    const notes = make('div', 'study-note-grid');
    notes.append(
      labeledValue('Common misconception', lesson.misconception),
      labeledValue('Ask the class', lesson.discussion),
      labeledValue('Curriculum', lesson.curriculum),
    );
    const refs = make('section', 'study-note-block study-source-block');
    refs.append(make('h4', undefined, 'References for this lesson'));
    const refList = make('ol', 'study-sources');
    for (const nRef of lesson.sources) {
      const source = sources.find((item) => item.n === nRef);
      if (!source) continue;
      const li = make('li');
      const link = make('a', undefined, source.title);
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      li.append(link, make('span', 'study-publisher', source.publisher));
      refList.append(li);
    }
    refs.append(refList);
    notes.append(refs);
    noteContent.append(title, notes);
  }
  noteSelect.addEventListener('change', () => setCurrentLesson(Number(noteSelect.value)));
  notePanel.append(noteSelectLabel, noteContent);
  setCurrentLesson(currentLesson);
  renderQuestion();
  renderGlossary();
  activate('quiz');

  contrast.addEventListener('click', () => {
    const on = !root.classList.contains('study-tools--contrast');
    root.classList.toggle('study-tools--contrast', on);
    host.classList.toggle('inkleaf-high-contrast', on);
    contrast.setAttribute('aria-pressed', String(on));
    contrast.textContent = on ? 'Standard contrast' : 'Higher contrast';
  });

  soundToggle.addEventListener('click', () => {
    const on = !sound?.enabled;
    if (on && typeof AudioContext === 'undefined' && !('webkitAudioContext' in globalThis)) {
      soundStatus.textContent = 'This browser does not support page sound.';
      return;
    }
    if (!sound) sound = createSound(soundRegistry, { enabled: false, autoUnlock: false });
    sound.setEnabled(on);
    if (on) sound.unlock();
    soundToggle.setAttribute('aria-pressed', String(on));
    soundToggle.textContent = `Page sound: ${on ? 'on' : 'off'}`;
    soundStatus.textContent = on ? 'Page sound enabled.' : 'Page sound disabled.';
  });

  host.append(root);
  document.addEventListener('inkleaf:lessonchange', pageSound);
  return () => {
    document.removeEventListener('inkleaf:lessonchange', pageSound);
    host.classList.remove('inkleaf-high-contrast');
    sound?.dispose();
    root.remove();
  };
}
