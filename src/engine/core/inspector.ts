/**
 * The inspector: open a world with `?inspect` (or press Shift+I) to see every registered entity, filter by tag or
 * words, change parameters live and copy the changed values as a `tune` block for the world manifest.
 * Plain DOM, no dependencies; it never runs unless asked for.
 */
import type { Entity, ParamSpec, ParamValue, Registry } from './registry';

const CSS = `
.ikl-insp { position: fixed; top: 12px; right: 12px; width: min(380px, calc(100vw - 24px)); max-height: calc(100vh - 24px);
  display: flex; flex-direction: column; z-index: 50; font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #1c2433; background: rgba(251, 247, 238, 0.94); border: 1px solid rgba(28, 36, 51, 0.18); border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22); backdrop-filter: blur(8px); }
.ikl-insp header { display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid rgba(28, 36, 51, 0.12); }
.ikl-insp input[type=search] { flex: 1; font: inherit; padding: 4px 6px; border: 1px solid rgba(28, 36, 51, 0.25); border-radius: 6px; background: #fff; }
.ikl-insp button { font: inherit; padding: 3px 8px; border: 1px solid rgba(28, 36, 51, 0.25); border-radius: 6px; background: #fff; cursor: pointer; }
.ikl-insp .tags { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 8px; border-bottom: 1px solid rgba(28, 36, 51, 0.12); }
.ikl-insp .tags button { padding: 1px 6px; border-radius: 10px; }
.ikl-insp .tags button[aria-pressed=true] { background: #1c2433; color: #fbf7ee; }
.ikl-insp .list { overflow: auto; padding: 4px 0; }
.ikl-insp details { padding: 3px 10px; border-bottom: 1px dashed rgba(28, 36, 51, 0.08); }
.ikl-insp summary { cursor: pointer; }
.ikl-insp summary b { font-weight: 600; }
.ikl-insp summary i { color: rgba(28, 36, 51, 0.55); font-style: normal; }
.ikl-insp .desc { margin: 4px 0; color: rgba(28, 36, 51, 0.7); }
.ikl-insp label { display: grid; grid-template-columns: 1fr 1.3fr; gap: 6px; align-items: center; margin: 3px 0; }
.ikl-insp label input[type=range] { width: 100%; }
.ikl-insp .count { padding: 4px 10px; color: rgba(28, 36, 51, 0.55); }
`;

export interface InspectorOptions {
  /** Called when the pointer is over an entity row, with its id (or null). The app highlights the object. */
  onHover?: (id: string | null) => void;
}

export function mountInspector(registry: Registry, opts: InspectorOptions = {}): { el: HTMLElement; destroy(): void; toggle(): void } {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const el = document.createElement('aside');
  el.className = 'ikl-insp';
  el.setAttribute('aria-label', 'inkleaf inspector');
  el.innerHTML = `<header><input type="search" placeholder="filter: words, tag:light, kind:spot-light, id:book.*" aria-label="Filter"><button data-copy title="Copy changed values as a tune block">Copy tune</button><button data-close aria-label="Close">x</button></header><div class="tags"></div><div class="count"></div><div class="list"></div>`;
  document.body.append(el);
  const search = el.querySelector('input')!;
  const list = el.querySelector('.list') as HTMLElement;
  const tagsBar = el.querySelector('.tags') as HTMLElement;
  const count = el.querySelector('.count') as HTMLElement;
  const changed = new Map<string, Record<string, ParamValue>>();
  const activeTags = new Set<string>();

  const control = (e: Entity, p: ParamSpec): HTMLElement => {
    const row = document.createElement('label');
    row.title = p.help ?? '';
    const name = document.createElement('span');
    name.textContent = `${p.label}${p.unit ? ` (${p.unit})` : ''}`;
    row.append(name);
    const commit = (v: ParamValue) => {
      registry.set(e.id, p.key, v);
      const c = changed.get(e.id) ?? {};
      c[p.key] = p.get();
      changed.set(e.id, c);
    };
    const v = p.get();
    let input: HTMLInputElement | HTMLSelectElement;
    if (p.type === 'number') {
      const wrap = document.createElement('span');
      const range = document.createElement('input');
      range.type = 'range';
      const n = Number(v);
      const span = Math.max(Math.abs(n), 1);
      range.min = String(p.min ?? n - span * 2);
      range.max = String(p.max ?? n + span * 2);
      range.step = String(p.step ?? (Number(range.max) - Number(range.min)) / 400);
      range.value = String(n);
      const out = document.createElement('output');
      out.textContent = n.toFixed(3);
      range.addEventListener('input', () => {
        commit(Number(range.value));
        out.textContent = Number(range.value).toFixed(3);
      });
      wrap.append(range, out);
      row.append(wrap);
      return row;
    } else if (p.type === 'boolean') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(v);
      input.addEventListener('change', () => commit((input as HTMLInputElement).checked));
    } else if (p.type === 'color') {
      input = document.createElement('input');
      input.type = 'color';
      input.value = String(v);
      input.addEventListener('input', () => commit(input.value));
    } else if (p.type === 'enum') {
      input = document.createElement('select');
      for (const o of p.options ?? []) input.append(new Option(o, o, false, o === v));
      input.addEventListener('change', () => commit(input.value));
    } else {
      input = document.createElement('input');
      input.value = Array.isArray(v) ? (v as number[]).join(', ') : String(v);
      input.addEventListener('change', () => {
        const raw = (input as HTMLInputElement).value;
        commit(p.type === 'vector3' || p.type === 'vector2' ? raw.split(',').map(Number) : raw);
      });
    }
    row.append(input);
    return row;
  };

  const render = () => {
    const words = search.value;
    let items = words.trim() ? registry.query(words) : registry.list();
    if (activeTags.size) items = items.filter((e) => [...activeTags].every((t) => e.tags.includes(t)));
    count.textContent = `${items.length} of ${registry.list().length} entities`;
    list.replaceChildren(
      ...items.slice(0, 400).map((e) => {
        const d = document.createElement('details');
        d.dataset.id = e.id;
        d.innerHTML = `<summary><b></b> <i></i></summary>`;
        d.querySelector('b')!.textContent = e.id;
        d.querySelector('i')!.textContent = `${e.kind} #${e.tags.join(' #')}`;
        d.addEventListener('toggle', () => {
          if (!d.open || d.childElementCount > 1) return;
          const desc = document.createElement('div');
          desc.className = 'desc';
          desc.textContent = [e.label, e.describe, e.source ? `source: ${e.source}` : ''].filter(Boolean).join(' · ');
          d.append(desc, ...e.params.map((p) => control(e, p)));
        });
        d.addEventListener('pointerenter', () => opts.onHover?.(e.id));
        d.addEventListener('pointerleave', () => opts.onHover?.(null));
        return d;
      }),
    );
  };

  const renderTags = () => {
    const all = new Map<string, number>();
    for (const e of registry.list()) for (const t of e.tags) all.set(t, (all.get(t) ?? 0) + 1);
    tagsBar.replaceChildren(
      ...[...all.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => {
        const b = document.createElement('button');
        b.textContent = `${t} ${n}`;
        b.setAttribute('aria-pressed', String(activeTags.has(t)));
        b.addEventListener('click', () => {
          activeTags.has(t) ? activeTags.delete(t) : activeTags.add(t);
          renderTags();
          render();
        });
        return b;
      }),
    );
  };

  search.addEventListener('input', render);
  el.querySelector('[data-copy]')!.addEventListener('click', async () => {
    const text = JSON.stringify({ tune: Object.fromEntries(changed) }, null, 2);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt('Copy this tune block', text);
    }
  });
  el.querySelector('[data-close]')!.addEventListener('click', () => (el.hidden = true));
  let pending = 0;
  const off = registry.on((ev) => {
    if (ev.type === 'change') return;
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      renderTags();
      render();
    });
  });
  renderTags();
  render();
  return {
    el,
    toggle: () => (el.hidden = !el.hidden),
    destroy: () => {
      off();
      el.remove();
      style.remove();
    },
  };
}
