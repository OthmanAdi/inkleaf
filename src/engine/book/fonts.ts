/**
 * Page fonts: Source Serif 4 (variable, roman and italic) for print and Caveat (variable) for handwriting, both
 * under the SIL Open Font License and bundled through Fontsource. Pages are painted only after these load.
 */
import '@fontsource-variable/source-serif-4/wght.css';
import '@fontsource-variable/source-serif-4/wght-italic.css';
import '@fontsource-variable/caveat/wght.css';
import { DEFAULT_FAMILIES, type FontFamilies } from './typography/measure';

export { DEFAULT_FAMILIES };

/** Waits for the faces the pages use: serif 400, 500, 600 and italic 400, hand 560. Never rejects. */
export async function loadBookFonts(fam: FontFamilies = DEFAULT_FAMILIES, timeoutMs = 4000): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const loads = [
    `400 16px ${fam.serif}`, `500 16px ${fam.serif}`, `600 16px ${fam.serif}`, `italic 400 16px ${fam.serif}`,
    `560 16px ${fam.hand}`,
  ].map((f) => document.fonts.load(f).catch(() => []));
  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, timeoutMs))]);
}
