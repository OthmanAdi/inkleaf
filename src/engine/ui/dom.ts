/** Small DOM helpers shared by the UI and lens packages. */

/** Adds a `<style>` once per id; later calls replace its text. */
export function ensureStyle(id: string, css: string): HTMLStyleElement {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.append(el);
  }
  if (el.textContent !== css) el.textContent = css;
  return el;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | undefined> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children);
  return el;
}

/** The fixed overlay that holds the glass UI (`#ui`), created if the page has none. */
export function uiRoot(): HTMLElement {
  let el = document.getElementById('ui');
  if (!el) {
    el = h('div', { id: 'ui' });
    document.body.append(el);
  }
  return el;
}

/** Sets CSS custom properties on an element (numbers get `px`). */
export function setVars(el: HTMLElement, vars: Record<string, number | string>): void {
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, typeof v === 'number' ? `${v}px` : v);
}
