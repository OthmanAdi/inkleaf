export function mountMagnifier(canvas: HTMLCanvasElement, button: HTMLButtonElement) {
  const plate = canvas.parentElement;
  if (!plate) return;
  const detail = document.createElement('canvas');
  detail.className = 'inkleaf-loupe';
  detail.width = detail.height = 192;
  detail.hidden = true;
  detail.setAttribute('aria-hidden', 'true');
  const context = detail.getContext('2d');
  if (!context) return;

  const help = document.createElement('p');
  help.className = 'inkleaf-loupe-help';
  help.hidden = true;
  help.textContent = '2× detail. Move or tap the diagram to inspect a point. With the magnifier button focused, use the arrow keys to move it and Escape to close it.';
  help.id = 'inkleaf-loupe-help';
  button.setAttribute('aria-describedby', help.id);
  plate.append(detail);
  plate.after(help);

  const zoom = 2;
  let active = false;
  let pendingDetail = false;
  let x = 0.5;
  let y = 0.5;
  const minOffset = (value: number) => Math.min(0.95, Math.max(0.05, value));

  function setActive(value: boolean): void {
    active = value;
    canvas.dataset.loupeActive = String(active);
    button.setAttribute('aria-pressed', String(active));
    detail.hidden = !active;
    if (active) canvas.dispatchEvent(new Event('inkleaf:request-frame'));
  }

  const syncAvailability = () => {
    const hidden = canvas.hasAttribute('hidden');
    button.hidden = hidden;
    if (hidden && active) setActive(false);
    if (!hidden && pendingDetail) {
      pendingDetail = false;
      setActive(true);
    }
  };
  new MutationObserver(syncAvailability).observe(canvas, { attributes: true, attributeFilter: ['hidden'] });
  syncAvailability();

  button.addEventListener('click', () => setActive(!active));
  button.addEventListener('keydown', (event) => {
    if (!active) return;
    switch (event.key) {
      case 'ArrowLeft': x = minOffset(x - 0.08); break;
      case 'ArrowRight': x = minOffset(x + 0.08); break;
      case 'ArrowUp': y = minOffset(y - 0.08); break;
      case 'ArrowDown': y = minOffset(y + 0.08); break;
      case 'Escape': setActive(false); break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (active) canvas.dispatchEvent(new Event('inkleaf:request-frame'));
  });

  function locate(event: PointerEvent): void {
    if (!active) return;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    x = minOffset((event.clientX - bounds.left) / bounds.width);
    y = minOffset((event.clientY - bounds.top) / bounds.height);
  }

  canvas.addEventListener('pointermove', (event) => { if (event.pointerType === 'mouse') locate(event); });
  canvas.addEventListener('pointerdown', (event) => {
    if (!active) return;
    locate(event);
    canvas.dispatchEvent(new Event('inkleaf:request-frame'));
  });
  canvas.addEventListener('inkleaf:frame', () => {
    if (!active) return;
    const screen = canvas.getBoundingClientRect();
    if (screen.width === 0 || screen.height === 0) return;
    // Crop in CSS pixels first so the zoom stays the same across device pixel ratios.
    const cropCss = detail.getBoundingClientRect().width / zoom;
    const width = Math.min(canvas.width, cropCss * canvas.width / screen.width);
    const height = Math.min(canvas.height, cropCss * canvas.height / screen.height);
    const left = Math.min(canvas.width - width, Math.max(0, x * canvas.width - width / 2));
    const top = Math.min(canvas.height - height, Math.max(0, y * canvas.height - height / 2));
    context.drawImage(canvas, left, top, width, height, 0, 0, detail.width, detail.height);
  });

  return {
    inspect(center: { x: number; y: number }): void {
      x = minOffset(center.x);
      y = minOffset(center.y);
      pendingDetail = canvas.hasAttribute('hidden');
      if (!pendingDetail) setActive(true);
    },
    stop(): void {
      pendingDetail = false;
      setActive(false);
    },
  };
}
