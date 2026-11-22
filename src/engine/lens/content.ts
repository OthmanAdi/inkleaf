/**
 * What the magnifier's glass card shows, and how it turns into HTML: a kicker, a title, paragraphs, an equation,
 * handwritten lines (live numbers), a definition list, a checklist (a tick on chosen options) and ordered steps.
 * All text is escaped; equations get light math typesetting (single letters italic, `_x` subscripts, `^2` powers).
 */
import type { Object3D } from 'three';
import type { PageRegion, Side } from '../contracts';

/** What the pointer reads: a page region (in page mm) or a figure object. */
export type LensTarget =
  | { kind: 'region'; spread: number; side: Side; region: PageRegion }
  | { kind: 'object'; object: Object3D };

export interface LensContent {
  kicker?: string;
  title?: string;
  text?: string | readonly string[];
  equation?: string;
  /** Handwritten lines, for live numbers. */
  hand?: readonly string[];
  terms?: readonly { term: string; def: string }[];
  checklist?: readonly { label: string; on?: boolean }[];
  steps?: readonly string[];
  /** A small grey note at the end (page numbers, sources). */
  note?: string;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);

const FRACTIONS: Record<string, string> = { '1/2': '½', '1/3': '⅓', '2/3': '⅔', '1/4': '¼', '3/4': '¾', '1/5': '⅕', '1/8': '⅛' };

/** Light math typesetting of a plain equation string such as `E_k = 1/2 m v^2` or `E_p = m g h`. */
export function formatEquation(src: string): string {
  let out = '';
  const re = /(\d+\/\d+)|([A-Za-z\u0370-\u03ff]+)(?:_(\{[^}]*\}|[A-Za-z0-9]+))?(?:\^(\{[^}]*\}|-?[A-Za-z0-9.]+))?|(\d+(?:\.\d+)?)(?:\^(\{[^}]*\}|-?[A-Za-z0-9.]+))?|(\*)|(\s+)|(.)/g;
  const strip = (s: string) => (s.startsWith('{') ? s.slice(1, -1) : s);
  const word = (w: string) => (w.length === 1 ? `<i>${escapeHtml(w)}</i>` : escapeHtml(w));
  for (const m of src.matchAll(re)) {
    const [, frac, ident, sub, sup, num, numSup, star, space, other] = m;
    if (frac) out += FRACTIONS[frac] ?? escapeHtml(frac);
    else if (ident) {
      out += word(ident);
      if (sub) out += `<sub>${escapeHtml(strip(sub))}</sub>`;
      if (sup) out += `<sup>${escapeHtml(strip(sup))}</sup>`;
    } else if (num) {
      out += escapeHtml(num);
      if (numSup) out += `<sup>${escapeHtml(strip(numSup))}</sup>`;
    } else if (star) out += ' · ';
    else if (space) out += ' ';
    else if (other) out += other === '-' ? '−' : escapeHtml(other);
  }
  return out;
}

/** The card's inner HTML. */
export function cardHtml(c: LensContent): string {
  const parts: string[] = [];
  if (c.kicker) parts.push(`<div class="k">${escapeHtml(c.kicker)}</div>`);
  if (c.title) parts.push(`<h3>${escapeHtml(c.title)}</h3>`);
  const text = typeof c.text === 'string' ? [c.text] : c.text ?? [];
  for (const p of text) parts.push(`<p>${escapeHtml(p)}</p>`);
  if (c.equation) parts.push(`<div class="eq">${formatEquation(c.equation)}</div>`);
  for (const h of c.hand ?? []) parts.push(`<div class="hand">${escapeHtml(h)}</div>`);
  if (c.terms?.length) parts.push(`<dl>${c.terms.map((t) => `<dt>${escapeHtml(t.term)}</dt><dd>${escapeHtml(t.def)}</dd>`).join('')}</dl>`);
  if (c.checklist?.length) parts.push(`<ul>${c.checklist.map((i) => `<li${i.on ? ' class="on"' : ''}>${escapeHtml(i.label)}</li>`).join('')}</ul>`);
  if (c.steps?.length) parts.push(`<ol>${c.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>`);
  if (c.note) parts.push(`<p class="pg">${escapeHtml(c.note)}</p>`);
  return parts.join('');
}
