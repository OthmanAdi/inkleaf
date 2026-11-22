/**
 * Checks a world manifest before it is built, with messages an agent can act on. Returns problems instead of
 * throwing so a skill run can list them all at once.
 */
import type { WorldManifest } from './types';

export interface Problem {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

const HEX = /^#[0-9a-f]{6}$/i;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateWorld(w: WorldManifest, figureModules: readonly string[] = []): Problem[] {
  const out: Problem[] = [];
  const err = (path: string, message: string) => out.push({ path, message, severity: 'error' });
  const warn = (path: string, message: string) => out.push({ path, message, severity: 'warning' });

  if (!ID.test(w.id)) err('id', `"${w.id}" must be kebab-case`);
  if (!w.title.trim()) err('title', 'a book needs a title');
  for (const [k, v] of Object.entries(w.theme)) if (typeof v === 'string' && k !== 'desk' && !HEX.test(v)) err(`theme.${k}`, `"${v}" must be a #rrggbb colour`);

  const qIds = new Set<string>();
  w.quantities.forEach((q, i) => {
    if (!ID.test(q.id)) err(`quantities[${i}].id`, `"${q.id}" must be kebab-case`);
    if (qIds.has(q.id)) err(`quantities[${i}].id`, `"${q.id}" is used twice`);
    qIds.add(q.id);
    if (!HEX.test(q.color)) err(`quantities[${i}].color`, `"${q.color}" must be a #rrggbb colour`);
  });

  const spreads = w.spreads;
  if (spreads.length < 2) err('spreads', 'a book needs at least two spreads');
  if (spreads.length > 24) warn('spreads', `${spreads.length} spreads make a thick book; the block is sized for up to 24`);
  const lessonIds = new Set<string>();
  const sourceNs = new Set(w.sources.map((s) => s.n));
  const terms = new Set(w.glossary.map((g) => g.term.toLowerCase()));
  let expectN = 1;
  spreads.forEach((s, i) => {
    if (s.kind !== 'lesson') return;
    const L = s.lesson;
    const p = `spreads[${i}].lesson`;
    if (!ID.test(L.id)) err(`${p}.id`, `"${L.id}" must be kebab-case`);
    if (lessonIds.has(L.id)) err(`${p}.id`, `"${L.id}" is used twice`);
    lessonIds.add(L.id);
    if (L.n !== expectN) warn(`${p}.n`, `lesson numbers should run 1, 2, 3...; expected ${expectN}, found ${L.n}`);
    expectN = L.n + 1;
    if (L.intro.length < 1 || L.intro.length > 3) warn(`${p}.intro`, 'one to three short sentences fit the page');
    if (L.predict.options.length < 2 || L.predict.options.length > 4) err(`${p}.predict.options`, 'two to four options');
    if (L.predict.answer < 0 || L.predict.answer >= L.predict.options.length) err(`${p}.predict.answer`, 'answer must index one of the options');
    if (L.keyWords.length > 4) warn(`${p}.keyWords`, 'more than four key words crowd the page');
    for (const k of L.keyWords) if (!terms.has(k.term.toLowerCase())) warn(`${p}.keyWords`, `"${k.term}" is not in the glossary`);
    if (L.tour.length && (L.tour.length < 3 || L.tour.length > 7)) warn(`${p}.tour`, 'a tour reads best with three to seven shots');
    for (const n of L.sources ?? []) if (!sourceNs.has(n)) err(`${p}.sources`, `source ${n} is not in the sources list`);
    if (figureModules.length && !figureModules.includes(L.figureModule)) err(`${p}.figureModule`, `no figure module named "${L.figureModule}"; known: ${figureModules.join(', ')}`);
    for (const sw of L.figure.switches ?? []) if (!sw.options.includes(sw.value)) err(`${p}.figure.switches.${sw.id}`, `value "${sw.value}" is not one of its options`);
  });
  spreads.forEach((s, i) => {
    if (s.kind !== 'quiz') return;
    s.questions.forEach((q, j) => {
      if (q.answer < 0 || q.answer >= q.options.length) err(`spreads[${i}].questions[${j}].answer`, 'answer must index one of the options');
    });
  });
  w.sources.forEach((s, i) => {
    if (!/^https?:\/\//.test(s.url)) err(`sources[${i}].url`, 'a source needs a full http(s) address');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.checked)) warn(`sources[${i}].checked`, 'record the date the link was opened as YYYY-MM-DD');
  });
  return out;
}
