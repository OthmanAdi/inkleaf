/**
 * The magnifier: a round reading glass centred on the pointer (the glass post effect magnifies what is under it,
 * with a chromatic rim) and a frosted glass card that explains the block being read. Both are transparent DOM
 * boxes marked `data-glass`; the post effect draws the glass. While shown, the card's content and placement are
 * rebuilt every frame so live numbers update and the card tracks camera motion.
 */
import { Box3, Vector3, type Object3D } from 'three';
import type { EngineContext, Side, Unsubscribe } from '../contracts';
import { tunable } from '../core/tune';
import { ensureStyle, h, setVars } from '../ui/dom';
import { cardHtml, type LensContent, type LensTarget } from './content';
import { placeCard } from './placement';

export interface LensDeps {
  ctx: EngineContext;
  /** The fixed UI overlay (`#ui`). */
  root: HTMLElement;
  /** Card content for what is being read; null hides the lens. */
  content(target: LensTarget): LensContent | null;
  /** Page geometry, to project a region's corners for placement. */
  book?(): { pageToWorld(spread: number, side: Side, u: number, v: number, out?: Vector3): Vector3 } | null;
}

export interface Lens {
  readonly visible: boolean;
  readonly target: LensTarget | null;
  readonly disc: HTMLElement;
  readonly card: HTMLElement;
  /** Shows the lens for a target at the pointer (CSS px). Returns false (and hides) when there is no content. */
  show(target: LensTarget, x: number, y: number): boolean;
  move(x: number, y: number): void;
  hide(): void;
  update(): void;
  dispose(): void;
}

const CSS = `
#ui .lensDisc, #ui .lensCard { position: fixed; left: 0; top: 0; pointer-events: none; opacity: 0;
  transition: opacity var(--ikl-lens-fade, .18s) ease; will-change: transform, opacity; }
#ui .lensDisc.show, #ui .lensCard.show { opacity: 1; }
#ui .lensDisc { width: var(--ikl-lens-d, 132px); height: var(--ikl-lens-d, 132px); border-radius: 50%; }
#ui .lensCard { width: min(var(--ikl-card-w, 360px), calc(100vw - 32px)); padding: 14px 16px 15px; box-sizing: border-box;
  color: var(--ikl-ink, #1c2433); overflow-wrap: anywhere; max-height: calc(100vh - 170px); overflow: hidden;
  border-radius: var(--ikl-card-r, 20px); font-family: var(--ikl-serif, "Source Serif 4 Variable", "Source Serif 4", Georgia, serif); }
#ui .lensCard .k { font-weight: 650; font-size: var(--ikl-card-kicker, 11.5px); line-height: 1; text-transform: uppercase;
  letter-spacing: .08em; color: var(--ikl-accent, #9a3b2a); margin-bottom: 7px; }
#ui .lensCard h3 { font-weight: 600; font-size: var(--ikl-card-title, 21px); line-height: 1.15; margin: 0 0 6px; }
#ui .lensCard p { font-weight: 400; font-size: var(--ikl-card-text, 16.5px); line-height: 1.42; margin: 0 0 6px; }
#ui .lensCard .eq { font-weight: 400; font-size: var(--ikl-card-eq, 26px); line-height: 1.2; margin: 2px 0 6px; }
#ui .lensCard .eq sub, #ui .lensCard .eq sup { font-size: .6em; }
#ui .lensCard .hand { font-family: var(--ikl-hand, "Caveat Variable", "Caveat", cursive); font-weight: 560;
  font-size: var(--ikl-card-hand, 24px); line-height: 1.15; color: var(--ikl-pen, #273463); }
#ui .lensCard dl { margin: 0; }
#ui .lensCard dt { font-weight: 650; font-size: 16px; line-height: 1.3; }
#ui .lensCard dd { font-weight: 400; font-size: 15.5px; line-height: 1.38; margin: 0 0 6px; }
#ui .lensCard ul { list-style: none; margin: 0; padding: 0; }
#ui .lensCard li { font-weight: 400; font-size: 16px; line-height: 1.5; }
#ui .lensCard li.on::before { content: "\\2713  "; color: var(--ikl-pen, #273463); font-weight: 700; }
#ui .lensCard ol { padding-left: 22px; margin: 0 0 6px; }
#ui .lensCard .done { color: var(--ikl-accent, #9a3b2a); }
#ui .lensCard .pg { color: var(--ikl-ink2, rgba(28,36,51,.62)); font-size: .85em; }
#ui .lensCard > :last-child { margin-bottom: 0; }
body.still #ui .lensDisc, body.still #ui .lensCard { transition: none; }
`;

const _v = new Vector3(), _box = new Box3();
const CORNERS: readonly [number, number, number][] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];

const sameTarget = (a: LensTarget | null, b: LensTarget) =>
  !!a && (a.kind === 'region' && b.kind === 'region' ? a.spread === b.spread && a.side === b.side && a.region.id === b.region.id : a.kind === 'object' && b.kind === 'object' && a.object === b.object);

export function createLens(deps: LensDeps, opts: { autoUpdate?: boolean } = {}): Lens {
  const { ctx, root } = deps;
  ensureStyle('ikl-lens-css', CSS);
  const disc = h('div', { class: 'glass lensDisc', id: 'lensDisc', 'data-glass': true, 'aria-hidden': 'true' });
  const body = h('div', { id: 'lensBody' });
  const card = h('aside', { class: 'glass lensCard', id: 'lensCard', 'data-glass': true, 'aria-hidden': 'true' }, body);
  root.append(disc, card);

  let ready = false;
  const applyDisc = () => {
    if (!ready) return;
    disc.dataset.r = String(dcfg.diameter / 2);
    disc.dataset.zoom = String(dcfg.zoom);
    disc.dataset.tint = String(dcfg.tint);
    setVars(root, { '--ikl-lens-d': dcfg.diameter, '--ikl-lens-fade': `${dcfg.fade}s` });
  };
  const applyCard = () => {
    if (!ready) return;
    card.dataset.r = String(ccfg.radius);
    card.dataset.tint = String(ccfg.tint);
    setVars(root, {
      '--ikl-card-w': ccfg.width, '--ikl-card-r': ccfg.radius, '--ikl-card-kicker': ccfg.kickerSize, '--ikl-card-title': ccfg.titleSize,
      '--ikl-card-text': ccfg.textSize, '--ikl-card-eq': ccfg.equationSize, '--ikl-card-hand': ccfg.handSize,
    });
    lastHtml = '';
  };
  const dcfg = tunable(ctx.registry, {
    id: 'lens.disc', label: 'Reading glass', kind: 'lens', tags: ['lens', 'ui', 'effect', 'post'],
    describe: 'The round magnifier that follows the pointer over readable text (touch: after a long press). The glass effect magnifies the page under it with a chromatic rim.',
    source: 'src/engine/lens/lens.ts',
    params: {
      diameter: { value: 132, min: 40, max: 400, step: 1, unit: 'px', help: 'Disc diameter' },
      zoom: { value: 1.75, min: 1, max: 4, step: 0.01, help: 'Magnification of the page under the disc' },
      tint: { value: 0.02, min: 0, max: 1, step: 0.01, help: 'Warm white tint of the glass' },
      fade: { value: 0.18, min: 0, max: 2, step: 0.01, unit: 's', help: 'Fade in and out time' },
    },
    onChange: () => applyDisc(),
  });
  let lastHtml = '';
  const ccfg = tunable(ctx.registry, {
    id: 'lens.card', label: 'Term card', kind: 'lens-card', tags: ['lens', 'ui', 'text'],
    describe: 'The frosted glass card that explains the block under the magnifier; placed above the block when it fits, else beside it, never under the toolbar.',
    source: 'src/engine/lens/lens.ts',
    params: {
      width: { value: 360, min: 160, max: 720, step: 1, unit: 'px', help: 'Card width (at most the screen width minus 32 px)' },
      gap: { value: 14, min: 0, max: 80, step: 1, unit: 'px', help: 'Space between the card and the block or disc' },
      margin: { value: 12, min: 0, max: 80, step: 1, unit: 'px', help: 'Space kept to the screen edges' },
      reserveLandscape: { value: 84, min: 0, max: 400, step: 1, unit: 'px', help: 'Bottom space kept free for the toolbar (landscape)' },
      reservePortrait: { value: 146, min: 0, max: 400, step: 1, unit: 'px', help: 'Bottom space kept free (portrait: toolbar and sheet)' },
      fallbackHeight: { value: 160, min: 40, max: 600, step: 1, unit: 'px', help: 'Card height assumed before it is measured' },
      radius: { value: 20, min: 0, max: 60, step: 1, unit: 'px', help: 'Corner radius of the glass card' },
      tint: { value: 0.38, min: 0, max: 1, step: 0.01, help: 'Frost tint of the card glass' },
      kickerSize: { value: 11.5, min: 6, max: 30, step: 0.5, unit: 'px', help: 'Kicker font size' },
      titleSize: { value: 21, min: 10, max: 48, step: 0.5, unit: 'px', help: 'Title font size' },
      textSize: { value: 16.5, min: 10, max: 32, step: 0.5, unit: 'px', help: 'Paragraph font size' },
      equationSize: { value: 26, min: 12, max: 60, step: 0.5, unit: 'px', help: 'Equation font size' },
      handSize: { value: 24, min: 12, max: 60, step: 0.5, unit: 'px', help: 'Handwritten line font size' },
    },
    onChange: () => applyCard(),
  });
  ready = true;
  applyDisc();
  applyCard();

  let visible = false;
  let target: LensTarget | null = null;
  let px = 0, py = 0;
  let cardH = 0;

  function project(world: Vector3, cw: number, ch: number, rect: { x0: number; y0: number; x1: number; y1: number }): void {
    _v.copy(world).project(ctx.camera);
    const sx = ((_v.x + 1) / 2) * cw, sy = ((1 - _v.y) / 2) * ch;
    rect.x0 = Math.min(rect.x0, sx); rect.x1 = Math.max(rect.x1, sx);
    rect.y0 = Math.min(rect.y0, sy); rect.y1 = Math.max(rect.y1, sy);
  }

  const rect = { x0: 0, y0: 0, x1: 0, y1: 0 };
  function targetRect(): typeof rect | null {
    if (!target) return null;
    const cr = ctx.canvas.getBoundingClientRect();
    rect.x0 = Infinity; rect.y0 = Infinity; rect.x1 = -Infinity; rect.y1 = -Infinity;
    if (target.kind === 'region') {
      const b = deps.book?.();
      if (!b) return null;
      const r = target.region;
      for (const [cu, cv] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) project(b.pageToWorld(target.spread, target.side, r.u + cu * r.w, r.v + cv * r.h, _v), cr.width, cr.height, rect);
    } else {
      _box.setFromObject(target.object as Object3D);
      if (_box.isEmpty()) return null;
      for (const [a, b2, c] of CORNERS) {
        _v.set(a ? _box.max.x : _box.min.x, b2 ? _box.max.y : _box.min.y, c ? _box.max.z : _box.min.z);
        project(_v, cr.width, cr.height, rect);
      }
    }
    rect.x0 += cr.left; rect.x1 += cr.left; rect.y0 += cr.top; rect.y1 += cr.top;
    return rect;
  }

  function layout(): void {
    disc.style.transform = `translate(${px - dcfg.diameter / 2}px, ${py - dcfg.diameter / 2}px)`;
    const vw = innerWidth, vh = innerHeight;
    const w = Math.min(ccfg.width, vw - 32);
    const { u, v } = placeCard({
      x: px, y: py, rect: targetRect(), w, h: cardH || ccfg.fallbackHeight, vw, vh, r: dcfg.diameter / 2,
      gap: ccfg.gap, margin: ccfg.margin, reserve: vw < vh ? ccfg.reservePortrait : ccfg.reserveLandscape,
    });
    card.style.transform = `translate(${u}px, ${v}px)`;
  }

  /** Re-reads the content; returns false when there is none. */
  function refresh(): boolean {
    if (!target) return false;
    const c = deps.content(target);
    if (!c) return false;
    const html = cardHtml(c);
    if (html !== lastHtml) {
      body.innerHTML = html;
      lastHtml = html;
      cardH = card.offsetHeight;
    }
    return true;
  }

  const lens: Lens = {
    get visible() {
      return visible;
    },
    get target() {
      return target;
    },
    disc,
    card,
    show(t, x, y) {
      px = x;
      py = y;
      if (!sameTarget(target, t)) target = t;
      if (!refresh()) {
        lens.hide();
        return false;
      }
      if (!visible) {
        visible = true;
        disc.classList.add('show');
        card.classList.add('show');
        card.setAttribute('aria-hidden', 'false');
      }
      layout();
      return true;
    },
    move(x, y) {
      px = x;
      py = y;
      if (visible) layout();
    },
    hide() {
      target = null;
      if (!visible) return;
      visible = false;
      disc.classList.remove('show');
      card.classList.remove('show');
      card.setAttribute('aria-hidden', 'true');
    },
    update() {
      if (!visible) return;
      if (!refresh()) lens.hide();
      else layout();
    },
    dispose() {
      for (const u of unsubs) u();
      disc.remove();
      card.remove();
      ctx.registry.remove('lens.disc');
      ctx.registry.remove('lens.card');
    },
  };
  const unsubs: Unsubscribe[] = [];
  if (opts.autoUpdate !== false) unsubs.push(ctx.onFrame('lens', () => lens.update()));
  unsubs.push(ctx.events.on('turn-start', () => lens.hide()));
  return lens;
}
