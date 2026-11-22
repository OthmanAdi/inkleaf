/**
 * The jar label canvas (384 x 240): store name, pattern swatch, the value in handwriting and a scale line. Two
 * layouts: the plain jar card or tag, and the label-jar card with an extra sub line.
 */
import { energyConfig } from './config';
import { drawPattern, type PatternKind } from './palette';

export const CARD_W = 384;
export const CARD_H = 240;

export interface CardText {
  name: string;
  pattern?: PatternKind;
  value: string;
  scale: string;
  /** Label-jar layout only: a line under the name. */
  sub?: string | null;
}

export interface CardLayout {
  /** 'jar' is the plain card or tag, 'label' the label-jar card with a sub line. */
  kind: 'jar' | 'label';
  /** Tags hang left (-1) or right (+1) of the jar; the hole side gets the wider margin. */
  tagSide?: 1 | -1;
  style?: 'card' | 'tag';
}

/** Left margin and swatch x of the plain layout. */
export function jarCardMetrics(layout: CardLayout): { left: number; swatchX: number } {
  if (layout.style === 'tag' && (layout.tagSide ?? 1) > 0) return { left: 52, swatchX: 292 };
  return { left: 26, swatchX: 300 };
}

const font = (style: string, weight: number, px: number, family: string) => `${style} ${weight} ${px}px ${family}`;

export function drawCard(ctx: CanvasRenderingContext2D, text: CardText, layout: CardLayout): void {
  const c = energyConfig.card;
  ctx.save();
  ctx.clearRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = c.paper;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.textBaseline = 'top';
  ctx.fillStyle = c.ink;
  const long = text.value.length > c.longChars;
  if (layout.kind === 'label' && layout.style !== 'tag') {
    ctx.font = font('normal', 600, 34, c.serif);
    ctx.fillText(text.name, 24, 18);
    drawPattern(ctx, text.pattern, 304, 18, 56, 36, c.ink);
    if (text.sub) {
      ctx.fillStyle = c.muted;
      ctx.font = font('italic', 400, 25, c.serif);
      ctx.fillText(text.sub, 24, 58);
    }
    ctx.fillStyle = c.ink;
    ctx.font = font('normal', 600, long ? 58 : 80, c.hand);
    ctx.fillText(text.value, 24, long ? 102 : 90);
    if (text.scale) {
      ctx.fillStyle = c.muted;
      ctx.font = font('italic', 400, 25, c.serif);
      ctx.fillText(text.scale, 24, CARD_H - 42);
    }
  } else {
    const { left, swatchX } = jarCardMetrics(layout);
    ctx.font = font('normal', 600, c.nameSize, c.serif);
    ctx.fillText(text.name, left, 26);
    drawPattern(ctx, text.pattern, swatchX, 26, 60, 40, c.ink);
    ctx.font = font('normal', 600, long ? c.valueSizeLong : c.valueSize, c.hand);
    ctx.fillText(text.value, left, long ? 84 : 70);
    if (text.scale) {
      ctx.fillStyle = c.muted;
      ctx.font = font('italic', 400, c.scaleSize, c.serif);
      ctx.fillText(text.scale, left, 186);
    }
  }
  ctx.restore();
}

let fontsReady: Promise<void> | null = null;

/** Resolves once the card fonts are loaded (or immediately where there is no FontFaceSet). */
export function cardFontsReady(): Promise<void> {
  if (fontsReady) return fontsReady;
  const fonts = typeof document !== 'undefined' ? (document as Document & { fonts?: FontFaceSet }).fonts : undefined;
  if (!fonts?.load) return (fontsReady = Promise.resolve());
  const c = energyConfig.card;
  fontsReady = Promise.all([
    fonts.load(font('normal', 600, 36, c.serif)),
    fonts.load(font('italic', 400, 26, c.serif)),
    fonts.load(font('normal', 600, 88, c.hand)),
  ]).then(
    () => undefined,
    () => undefined,
  );
  return fontsReady;
}
