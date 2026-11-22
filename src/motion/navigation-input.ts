function onControl(event: Event): boolean {
  return event.target instanceof Element &&
    !!event.target.closest('button, input, select, label, a, summary, canvas, [contenteditable]');
}

export function mountPageGestures(host: HTMLElement, movePage: (direction: -1 | 1) => void): void {
  host.style.touchAction = 'pan-y pinch-zoom';
  let start: { id: number; x: number; y: number } | undefined;
  let lastWheelTurn = -Infinity;

  host.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch') return;
    start = event.isPrimary && !onControl(event)
      ? { id: event.pointerId, x: event.clientX, y: event.clientY }
      : undefined;
  });
  host.addEventListener('pointercancel', () => { start = undefined; });
  host.addEventListener('pointerup', (event) => {
    if (!start || start.id !== event.pointerId) return;
    const { x, y } = start;
    start = undefined;
    const dx = event.clientX - x;
    const dy = event.clientY - y;
    if (Math.abs(dx) >= 58 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      movePage(dx < 0 ? 1 : -1);
    }
  });

  host.addEventListener('wheel', (event) => {
    if (!event.shiftKey || event.ctrlKey || event.metaKey || onControl(event)) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (Math.abs(delta) < 1) return;
    event.preventDefault();
    if (event.timeStamp - lastWheelTurn < 750) return;
    lastWheelTurn = event.timeStamp;
    movePage(delta > 0 ? 1 : -1);
  }, { passive: false });
}
