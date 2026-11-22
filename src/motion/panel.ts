import { frameAt, timeAt, type MotionClip } from './frames';

export function mountMotionPanel<Id extends string>(
  host: HTMLElement,
  clips: Readonly<Partial<Record<Id, MotionClip>>>,
  seek: (id: Id, seconds: number) => void,
) {
  const catalog = new Map<Id, MotionClip>();
  const panel = document.createElement('details');
  panel.className = 'motion-panel';
  panel.innerHTML = `
    <summary>Explore motion frame by frame</summary>
    <div class="motion-controls">
      <label>Animation <select></select></label>
      <label>Frame <input type="range" min="0" step="1" value="0"></label>
      <div class="motion-steps">
        <button type="button" data-step="-1" aria-label="Previous frame">←</button>
        <output aria-live="off"></output>
        <button type="button" data-step="1" aria-label="Next frame">→</button>
      </div>
    </div>`;
  const choice = panel.querySelector('select')!;
  const slider = panel.querySelector<HTMLInputElement>('input')!;
  const output = panel.querySelector('output')!;
  const previous = panel.querySelector<HTMLButtonElement>('button[data-step="-1"]')!;
  const next = panel.querySelector<HTMLButtonElement>('button[data-step="1"]')!;

  for (const id of Object.keys(clips) as Id[]) {
    const clip = clips[id];
    if (!clip) continue;
    catalog.set(id, clip);
    choice.add(new Option(clip.label, id));
  }

  function apply(frame: number, updateScene: boolean): void {
    const id = choice.value as Id;
    const clip = catalog.get(id);
    if (!clip) return;
    const index = frameAt(clip, frame);
    slider.max = String(clip.lastFrame);
    slider.value = String(index);
    slider.setAttribute('aria-valuetext', `Frame ${index} of ${clip.lastFrame}`);
    const seconds = timeAt(clip, index);
    output.value = `${index} / ${clip.lastFrame} · ${seconds.toFixed(2)} s`;
    previous.disabled = index === 0;
    next.disabled = index === clip.lastFrame;
    if (updateScene) seek(id, seconds);
  }

  choice.addEventListener('change', () => apply(0, true));
  slider.addEventListener('input', () => apply(slider.valueAsNumber, true));
  previous.addEventListener('click', () => apply(slider.valueAsNumber - 1, true));
  next.addEventListener('click', () => apply(slider.valueAsNumber + 1, true));
  panel.addEventListener('toggle', () => { if (panel.open) apply(0, true); });
  apply(0, false);
  host.append(panel);

  return {
    setClip(id: Id, clip: MotionClip | null): void {
      const option = Array.from(choice.options).find((item) => item.value === id);
      const current = catalog.get(id);
      if (!clip) {
        const selected = choice.value === id;
        catalog.delete(id);
        option?.remove();
        if (selected) apply(0, false);
      } else if (current?.label !== clip.label || current.fps !== clip.fps || current.lastFrame !== clip.lastFrame) {
        catalog.set(id, clip);
        if (option) option.text = clip.label;
        else choice.add(new Option(clip.label, id));
        choice.value = id;
        apply(0, false);
      }
    },
  };
}
