/**
 * Every number the energy package reads, as named, tunable parameter groups. The values live in `energyConfig`
 * from module load (so the pure math works without a registry); `registerEnergy(registry)` exposes each group
 * under `energy.<group>` and from then on edits made by name land in the same objects the code reads every frame.
 */
import { tunable, type Def, type Tuned } from '../core/tune';
import type { Registry, Tag } from '../core/registry';

export interface GroupDef<P extends Record<string, Def>> {
  id: string;
  label: string;
  kind: string;
  tags: readonly Tag[];
  describe: string;
  params: P;
}

const SOURCE = 'src/engine/energy/config.ts';

export function plain<P extends Record<string, Def>>(defs: P): Tuned<P> {
  const out: Record<string, unknown> = {};
  for (const [k, d] of Object.entries(defs)) out[k] = Array.isArray(d.value) ? [...d.value] : d.value;
  return out as Tuned<P>;
}

/** Registers a group with the current values as defaults and returns the live values object. */
export function exposeGroup<P extends Record<string, Def>>(registry: Registry, group: GroupDef<P>, current: Tuned<P>, source = SOURCE): Tuned<P> {
  if (registry.has(group.id)) return current;
  const params = {} as Record<string, Def>;
  for (const [k, d] of Object.entries(group.params)) {
    const v = (current as Record<string, unknown>)[k];
    params[k] = { ...d, value: Array.isArray(v) ? [...v] : v } as Def;
  }
  return tunable(registry, { id: group.id, label: group.label, kind: group.kind, tags: group.tags, describe: group.describe, source, params: params as P });
}

// ------------------------------------------------------------------------------------------------------------------

export const JAR_DEFS = {
  id: 'energy.jar',
  label: 'Energy store jars (shared)',
  kind: 'energy-jar-defaults',
  tags: ['energy', 'store', 'ink', 'animation'],
  describe: 'Shared numbers for every store jar: ink stroke schedule and widths, liquid level law, light-up rate and light strength.',
  params: {
    litRate: { value: 5, min: 0, max: 60, unit: '1/s', help: 'Light-up rate: lit += (target - lit) * min(1, rate * dt)' },
    step: { value: 0.05, min: 0, max: 0.5, unit: 's', help: 'Pen schedule spacing between strokes (times pace)' },
    dur: { value: 0.32, min: 0.01, max: 2, unit: 's', help: 'Duration of each ring, highlight and card stroke (times pace)' },
    tickDur: { value: 0.12, min: 0.01, max: 1, unit: 's', help: 'Duration of each graduation tick (not paced)' },
    holeDur: { value: 0.1, min: 0.01, max: 1, unit: 's', help: 'Duration of the tag hole stroke' },
    silDelay: { value: 0.08, min: 0, max: 1, unit: 's', help: 'Silhouette start after the jar t0 (times pace)' },
    silStagger: { value: 0.04, min: 0, max: 0.5, unit: 's', help: 'Delay between the two silhouette lines' },
    silDur: { value: 0.3, min: 0.01, max: 2, unit: 's', help: 'Silhouette stroke duration (times pace)' },
    lineWidthPx: { value: 1.45, min: 0.2, max: 6, unit: 'px', help: 'Pen width of rings, ticks and highlights (new jars)' },
    silWidthPx: { value: 1.6, min: 0.2, max: 6, unit: 'px', help: 'Pen width of the silhouette lines (new jars)' },
    cardWidthPx: { value: 1.3, min: 0.2, max: 6, unit: 'px', help: 'Pen width of the card border (new jars)' },
    baseWidth: { value: 1.05, min: 0, max: 4, help: 'Base ring width factor' },
    shoulderWidth: { value: 0.95, min: 0, max: 4, help: 'Shoulder ring width factor' },
    rimWidth: { value: 1.1, min: 0, max: 4, help: 'Rim ring width factor' },
    innerRimWidth: { value: 0.6, min: 0, max: 4, help: 'Inner rim width factor' },
    tickWidth: { value: 0.75, min: 0, max: 4, help: 'Graduation tick width factor' },
    highlight1Width: { value: 0.55, min: 0, max: 4, help: 'Long glass highlight width factor' },
    highlight2Width: { value: 0.5, min: 0, max: 4, help: 'Short glass highlight width factor' },
    silWidth: { value: 1.05, min: 0, max: 4, help: 'Silhouette width factor' },
    cardOuterWidth: { value: 0.95, min: 0, max: 4, help: 'Card outer border width factor' },
    cardInnerWidth: { value: 0.45, min: 0, max: 4, help: 'Card inner border width factor' },
    tagOutlineWidth: { value: 0.9, min: 0, max: 4, help: 'Luggage tag outline width factor' },
    tagThinWidth: { value: 0.6, min: 0, max: 4, help: 'Tag string and hole width factor' },
    shoulderDrop: { value: 3.2, min: 0, max: 20, unit: 'mm', help: 'Shoulder ring sits this far below the rim' },
    rimOut: { value: 0.9, min: 0, max: 5, unit: 'mm', help: 'Shoulder and rim radius beyond the body radius' },
    innerRimIn: { value: 1.2, min: 0, max: 5, unit: 'mm', help: 'Inner rim radius inside the body radius' },
    tickOut: { value: 0.05, min: 0, max: 2, unit: 'mm', help: 'Tick arc radius beyond the body radius' },
    tickAngle: { value: 0.62, min: 0, max: 2, unit: 'pi', help: 'Tick start angle (in units of pi)' },
    tickSpan: { value: 0.2, min: 0, max: 2, unit: 'rad', help: 'Tick arc span' },
    tickSpanTop: { value: 0.34, min: 0, max: 2, unit: 'rad', help: 'Top tick arc span' },
    liquidInset: { value: 1.3, min: 0, max: 5, unit: 'mm', help: 'Liquid radius inside the body radius' },
    liquidBase: { value: 0.9, min: 0, max: 5, unit: 'mm', help: 'Liquid starts this far above the base ring' },
    levelMargin: { value: 2.2, min: 0, max: 10, unit: 'mm', help: 'Full liquid height = shoulder height minus this' },
    minLevel: { value: 0.05, min: 0, max: 2, unit: 'mm', help: 'Smallest liquid height' },
    minFill: { value: 0.004, min: 0, max: 0.1, help: 'Liquid and light only show above this fill' },
    minLit: { value: 0.001, min: 0, max: 0.1, help: 'Liquid shows only above this lit value' },
    strengthFloor: { value: 0.25, min: 0, max: 1, help: 'Light strength = lit * min(1, floor + fill)' },
    qualitativeStrength: { value: 0.55, min: 0, max: 1, help: 'Light strength of a jar without a number (times lit)' },
    cardThrottle: { value: 70, min: 0, max: 1000, unit: 'ms', help: 'Card canvas redraws at most this often' },
  },
} satisfies GroupDef<Record<string, Def>>;

export const LIQUID_DEFS = {
  id: 'energy.jar-liquid',
  label: 'Glowing jar liquid',
  kind: 'shader',
  tags: ['energy', 'shader', 'material', 'effect'],
  describe: 'Shading of the glowing liquid: brighter with height, a rim glow, slow internal currents and a brighter top cap.',
  params: {
    base: { value: 0.58, min: 0, max: 3, help: 'Side brightness base' },
    height: { value: 0.34, min: 0, max: 3, help: 'Extra brightness toward the top' },
    rim: { value: 0.55, min: 0, max: 3, help: 'Rim (grazing angle) brightness' },
    rimPower: { value: 2.2, min: 0.1, max: 8, help: 'Rim falloff exponent' },
    current: { value: 0.16, min: 0, max: 2, help: 'Internal current brightness' },
    currentY: { value: 0.42, min: 0, max: 10, help: 'Current frequency along the unit height' },
    currentSpeed: { value: 1.1, min: 0, max: 10, unit: 'rad/s', help: 'Current travel speed' },
    swirl: { value: 1.6, min: 0, max: 10, help: 'Swirl amplitude' },
    swirlFreq: { value: 3, min: 0, max: 12, help: 'Swirl lobes around the jar' },
    swirlSpeed: { value: 0.6, min: 0, max: 10, unit: 'rad/s', help: 'Swirl speed' },
    capBase: { value: 1.25, min: 0, max: 4, help: 'Top cap brightness' },
    capGain: { value: 0.55, min: 0, max: 4, help: 'Extra cap brightness at the edge' },
    capRadius: { value: 11.7, min: 0.1, max: 100, unit: 'mm', help: 'Cap radius the edge brightening is measured against' },
    capEdge: { value: 0.55, min: 0, max: 1, help: 'Cap edge brightening starts at this radius fraction' },
  },
} satisfies GroupDef<Record<string, Def>>;

export const BUBBLE_DEFS = {
  id: 'energy.jar-bubbles',
  label: 'Rising bubbles',
  kind: 'animation',
  tags: ['energy', 'object', 'animation', 'effect'],
  describe: 'Seven small bright bubbles rise up the front of a lit liquid, grow in, wobble and shrink out at the top.',
  params: {
    count: { value: 7, min: 0, max: 7, step: 1, help: 'Bubbles shown per jar' },
    minLevel: { value: 3, min: 0, max: 50, unit: 'mm', help: 'Bubbles show only above this liquid height' },
    whiten: { value: 0.16, min: 0, max: 1, help: 'Bubble colour = mix(store colour, white, this)' },
    riseBase: { value: 0.5, min: 0, max: 5, help: 'Rise speed factor = base + lit' },
    grow: { value: 6, min: 0.1, max: 50, help: 'Grow-in envelope slope' },
    shrink: { value: 8, min: 0.1, max: 50, help: 'Shrink-out envelope slope' },
    wobble: { value: 0.06, min: 0, max: 1, unit: 'rad', help: 'Wobble amplitude' },
    wobbleFreq: { value: 9, min: 0, max: 50, help: 'Wobbles per rise' },
    bottom: { value: 1.6, min: 0, max: 10, unit: 'mm', help: 'Bubble start height' },
    topGap: { value: 1.2, min: 0, max: 10, unit: 'mm', help: 'Bubbles vanish this far below the surface' },
    orbitOut: { value: 0.25, min: -2, max: 2, unit: 'mm', help: 'Bubble orbit radius beyond the liquid radius' },
  },
} satisfies GroupDef<Record<string, Def>>;

export const CARD_DEFS = {
  id: 'energy.jar-card',
  label: 'Jar label card',
  kind: 'texture',
  tags: ['energy', 'text', 'texture', 'ui', 'paper'],
  describe: 'The paper card that leans in front of a jar: store name, pattern swatch, the joules in handwriting and a scale line.',
  params: {
    paper: { value: '#fbf6ea', help: 'Card paper colour' },
    ink: { value: '#1c2433', help: 'Text and swatch ink colour' },
    muted: { value: '#4a5161', help: 'Scale and sub line colour' },
    serif: { value: '"Source Serif 4 Variable", Georgia, serif', help: 'Font stack for the name and scale line' },
    hand: { value: '"Caveat Variable", "Segoe Print", cursive', help: 'Font stack for the handwritten value' },
    nameSize: { value: 36, min: 8, max: 80, unit: 'px', help: 'Store name size on the 384 x 240 canvas' },
    valueSize: { value: 88, min: 8, max: 160, unit: 'px', help: 'Value size' },
    valueSizeLong: { value: 64, min: 8, max: 160, unit: 'px', help: 'Value size when longer than the long threshold' },
    longChars: { value: 9, min: 1, max: 40, step: 1, help: 'Values longer than this use the long size' },
    scaleSize: { value: 26, min: 8, max: 60, unit: 'px', help: 'Scale line size' },
    w: { value: 26, min: 4, max: 80, unit: 'mm', help: 'Default card width' },
    h: { value: 15, min: 4, max: 80, unit: 'mm', help: 'Default card height' },
    tilt: { value: 0.32, min: -1.6, max: 1.6, unit: 'rad', help: 'Default backward lean of the card' },
    below: { value: 1.5, min: -20, max: 40, unit: 'mm', help: 'Default card centre below the jar middle' },
    front: { value: 3.5, min: -20, max: 40, unit: 'mm', help: 'Default card distance in front of the jar wall' },
    shade: { value: 0.05, min: 0, max: 1, help: 'Card paper shading' },
  },
} satisfies GroupDef<Record<string, Def>>;

export const SCALE_DEFS = {
  id: 'energy.jar-scale',
  label: 'Jar capacity rounding',
  kind: 'data',
  tags: ['energy', 'data'],
  describe: 'Picks a round jar capacity (1, 2 or 5 times a power of ten) so a value fills a jar to at most the target.',
  params: {
    target: { value: 0.9, min: 0.1, max: 1, help: 'Highest fill a scaled jar may reach' },
  },
} satisfies GroupDef<Record<string, Def>>;

export const HUE_DEFS = {
  id: 'energy.hue-blend',
  label: 'Hue-circle colour blend',
  kind: 'data',
  tags: ['energy', 'shader', 'data', 'flow'],
  describe: 'Streams blend from the source colour to the destination colour the short way round the hue circle; close hues blend over most of the flow, distant hues switch near the middle.',
  params: {
    hwMax: { value: 0.36, min: 0, max: 0.5, help: 'Blend half width for identical hues' },
    hwMin: { value: 0.05, min: 0, max: 0.5, help: 'Blend half width for distant hues' },
    hwGain: { value: 3.5, min: 0, max: 20, help: 'How fast the half width shrinks with hue distance' },
  },
} satisfies GroupDef<Record<string, Def>>;

export const GLOW_DEFS = {
  id: 'energy.glow',
  label: 'Glow gains',
  kind: 'effect',
  tags: ['energy', 'effect', 'post'],
  describe: 'HDR multipliers of every glowing part; values above 1 feed the selective bloom.',
  params: {
    liquid: { value: 1.2, min: 0, max: 8, help: 'Jar liquid colour gain' },
    tube: { value: 1.6, min: 0, max: 8, help: 'Stream tube colour gain' },
    beads: { value: 1.9, min: 0, max: 8, help: 'Stream bead colour gain' },
    bubbles: { value: 2, min: 0, max: 8, help: 'Jar bubble colour gain' },
    ribbon: { value: 1.5, min: 0, max: 8, help: 'Sankey ribbon gain (times glow, at least 1)' },
    core: { value: 1.35, min: 0, max: 8, help: 'Glowing core (battery cell) gain' },
  },
} satisfies GroupDef<Record<string, Def>>;

export const STREAM_DEFS = {
  id: 'energy.stream',
  label: 'Energy streams (shared)',
  kind: 'energy-stream-defaults',
  tags: ['energy', 'flow', 'shader', 'animation'],
  describe: 'Glowing tubes between stores: thickness grows with the square root of power, the ends taper, beads ride along.',
  params: {
    radiusBase: { value: 0.4, min: 0, max: 5, unit: 'mm', help: 'Tube radius at zero power' },
    radiusGain: { value: 1.35, min: 0, max: 10, unit: 'mm', help: 'Extra radius at full power (times sqrt(level))' },
    electricalMax: { value: 0.9, min: 0, max: 5, unit: 'mm', help: 'Electrical tubes stay at most this thick' },
    taperMin: { value: 0.45, min: 0, max: 1, help: 'Radius at the tube ends (fraction)' },
    taperSpan: { value: 0.06, min: 0.001, max: 0.5, help: 'Length fraction over which the ends taper' },
    glowRate: { value: 8, min: 0, max: 60, unit: '1/s', help: 'Glow in and out: glow += (target - glow) * (1 - exp(-rate dt))' },
    visibleGlow: { value: 0.01, min: 0, max: 0.5, help: 'Tube hidden below this glow' },
    fadeEdge0: { value: 0.01, min: 0, max: 1, help: 'Thickness ramp starts at this glow' },
    fadeEdge1: { value: 0.9, min: 0, max: 1, help: 'Thickness ramp is full at this glow' },
    beadScale: { value: 1, min: 0, max: 1, help: 'Quality scale of the bead count (0.5 on the low tier)' },
    heatingShare: { value: 0.4, min: 0, max: 1, help: 'Share of beads shown on heating streams' },
    beadRadius: { value: 1.12, min: 0, max: 5, help: 'Bead radius per tube radius' },
    beadAdd: { value: 0.35, min: 0, max: 5, unit: 'mm', help: 'Bead radius added to the scaled tube radius' },
    beadElectrical: { value: 1.1, min: 0, max: 5, unit: 'mm', help: 'Electrical bead radius' },
    beadEnd: { value: 0.12, min: 0.001, max: 0.5, help: 'Beads grow in over this length fraction' },
    beadCut: { value: 0.04, min: 0, max: 0.5, help: 'Beads hidden this close to the ends' },
    beadVary: { value: 0.25, min: 0, max: 1, help: 'Per-bead size variation' },
    lightFloor: { value: 0.3, min: 0, max: 1, help: 'Light strength = glow * min(1, floor + level)' },
    heatWaver: { value: 0.18, min: 0, max: 1, help: 'Heating radius waver (fraction)' },
    heatWaverFreq: { value: 40, min: 0, max: 200, help: 'Heating waver frequency along the tube' },
    heatWaverSpeed: { value: 1.6, min: 0, max: 20, unit: 'rad/s', help: 'Heating waver speed' },
  },
} satisfies GroupDef<Record<string, Def>>;

export const SPEED_DEFS = {
  id: 'energy.bead-speeds',
  label: 'Pathway speeds',
  kind: 'animation',
  tags: ['energy', 'flow', 'animation'],
  describe: 'How fast beads and patterns travel along a stream, per pathway (mm per second).',
  params: {
    mechanical: { value: 30, min: 0, max: 1000, unit: 'mm/s', help: 'Mechanical speed at zero power' },
    mechanicalGain: { value: 50, min: 0, max: 1000, unit: 'mm/s', help: 'Extra mechanical speed at full power' },
    electrical: { value: 140, min: 0, max: 1000, unit: 'mm/s', help: 'Electrical speed' },
    heating: { value: 18, min: 0, max: 1000, unit: 'mm/s', help: 'Heating speed' },
    radiation: { value: 160, min: 0, max: 1000, unit: 'mm/s', help: 'Radiation speed' },
  },
} satisfies GroupDef<Record<string, Def>>;

export const MODE_DEFS = {
  id: 'energy.stream-modes',
  label: 'Pathway motion patterns',
  kind: 'shader',
  tags: ['energy', 'flow', 'shader', 'animation'],
  describe: 'The travelling brightness pattern of each pathway: a mechanical wave, electrical pulses, a heating shimmer, radiation dashes.',
  params: {
    bodyBase: { value: 0.55, min: 0, max: 2, help: 'Tube brightness at the edge' },
    bodyGain: { value: 0.45, min: 0, max: 2, help: 'Extra brightness in the core' },
    mechFloor: { value: 0.82, min: 0, max: 2, help: 'Mechanical wave floor' },
    mechAmp: { value: 0.18, min: 0, max: 2, help: 'Mechanical wave amplitude' },
    mechFreq: { value: 0.45, min: 0, max: 5, unit: 'rad/mm', help: 'Mechanical wave frequency' },
    elecPeriod: { value: 18, min: 1, max: 200, unit: 'mm', help: 'Electrical pulse spacing' },
    elecSpeedMul: { value: 3, min: 0, max: 10, help: 'Electrical pattern speed multiplier' },
    elecFloor: { value: 0.35, min: 0, max: 2, help: 'Electrical floor brightness' },
    elecGain: { value: 1.4, min: 0, max: 4, help: 'Electrical pulse brightness' },
    elecRise: { value: 0.75, min: 0, max: 1, help: 'Pulse rise starts at this phase' },
    elecPeak: { value: 0.97, min: 0, max: 1, help: 'Pulse peak phase' },
    heatFloor: { value: 0.78, min: 0, max: 2, help: 'Heating shimmer floor' },
    heatAmp: { value: 0.22, min: 0, max: 2, help: 'Heating shimmer amplitude' },
    heatFreq: { value: 0.22, min: 0, max: 5, unit: 'rad/mm', help: 'Heating shimmer frequency' },
    heatSpeedMul: { value: 0.4, min: 0, max: 10, help: 'Heating shimmer speed multiplier' },
    heatWarp: { value: 0.07, min: 0, max: 2, help: 'Heating warp frequency' },
    radPeriod: { value: 9, min: 1, max: 200, unit: 'mm', help: 'Radiation dash period' },
    radSpeedMul: { value: 1.6, min: 0, max: 10, help: 'Radiation pattern speed multiplier' },
    radFloor: { value: 0.25, min: 0, max: 2, help: 'Radiation gap brightness' },
    radGain: { value: 1.1, min: 0, max: 4, help: 'Radiation dash brightness' },
    radDuty: { value: 0.45, min: 0, max: 1, help: 'Radiation dash starts at this phase' },
  },
} satisfies GroupDef<Record<string, Def>>;

export const FLOW_DEFS = {
  id: 'energy.flow',
  label: 'Fading and packet streams',
  kind: 'animation',
  tags: ['energy', 'flow', 'animation'],
  describe: 'Variants of the stream: one that fades and thins quickly when the flow stops, and one that marches one bead per energy packet.',
  params: {
    fadeOut: { value: 22, min: 0, max: 200, unit: '1/s', help: 'Extra decay of a fading stream when its power stops' },
    fadeRadius: { value: 1.25, min: 0.1, max: 10, help: 'Radius scale = min(1, this * glow)^2 while fading' },
    packet: { value: 1, min: 1e-9, max: 1e6, unit: 'J', help: 'Energy per bead of a packet stream' },
    spacing: { value: 18, min: 1, max: 200, unit: 'mm', help: 'Packet bead spacing (matches the electrical pulse period)' },
    clockRate: { value: 6, min: 0, max: 100, help: 'Packet clock advance per packet' },
    peak: { value: 0.97, min: 0, max: 1, help: 'Packet beads sit at this pulse phase' },
    size: { value: 1.15, min: 0, max: 5, unit: 'mm', help: 'Packet bead radius' },
    end: { value: 0.06, min: 0.001, max: 0.5, help: 'Packet beads grow in over this length fraction' },
  },
} satisfies GroupDef<Record<string, Def>>;

export const RIBBON_DEFS = {
  id: 'energy.ribbon',
  label: 'Sankey ribbons (shared)',
  kind: 'energy-ribbon-defaults',
  tags: ['energy', 'flow', 'shader', 'object'],
  describe: 'Flat glowing bands whose width is proportional to power, with taper, lanes, rays, heating waver and reveal.',
  params: {
    mmPerW: { value: 0.2, min: 0, max: 10, unit: 'mm/W', help: 'Band width per watt' },
    maxW: { value: 60, min: 1e-6, max: 1e6, unit: 'W', help: 'Power that counts as full level' },
    glowRate: { value: 7, min: 0, max: 60, unit: '1/s', help: 'Glow in and out rate' },
    blend0: { value: 0.12, min: 0, max: 1, help: 'Colour blend window start' },
    blend1: { value: 0.88, min: 0, max: 1, help: 'Colour blend window end' },
    blendNarrow: { value: 0.16, min: 0, max: 1, help: 'Blend window scale for distant hues' },
    widthGate: { value: 1.4, min: 0, max: 10, help: 'Width collapses with min(1, this * uGlow)' },
    mechanical: { value: 26, min: 0, max: 1000, unit: 'mm/s', help: 'Mechanical speed at zero power' },
    mechanicalGain: { value: 40, min: 0, max: 1000, unit: 'mm/s', help: 'Extra mechanical speed at full power' },
    electrical: { value: 120, min: 0, max: 1000, unit: 'mm/s', help: 'Electrical speed' },
    heating: { value: 16, min: 0, max: 1000, unit: 'mm/s', help: 'Heating speed' },
    radiation: { value: 150, min: 0, max: 1000, unit: 'mm/s', help: 'Radiation speed' },
    raySpeed: { value: 240, min: 0, max: 2000, unit: 'mm/s', help: 'Fixed radiation ray speed in the shader' },
    shimmer: { value: 6.4, min: 0, max: 100, unit: 'mm/s', help: 'Heating shimmer speed in the shader' },
    lightFloor: { value: 0.25, min: 0, max: 1, help: 'Light strength = glow * min(1, floor + level) * reveal' },
  },
} satisfies GroupDef<Record<string, Def>>;

export const BAR_DEFS = {
  id: 'energy.total-bar',
  label: 'Stacked energy bars (shared)',
  kind: 'energy-bar-defaults',
  tags: ['energy', 'object', 'ink'],
  describe: 'A thin inked box filled bottom-up with one coloured segment per store: the total stays constant while stores trade energy.',
  params: {
    base: { value: 0.3, min: 0, max: 5, unit: 'mm', help: 'First segment starts this far above the bar foot' },
    minVisible: { value: 0.05, min: 0, max: 5, unit: 'mm', help: 'Segments thinner than this are hidden' },
    widthPx: { value: 1.3, min: 0.2, max: 6, unit: 'px', help: 'Pen width (new bars)' },
    frontWidth: { value: 1, min: 0, max: 4, help: 'Front rectangle width factor' },
    sideWidth: { value: 0.8, min: 0, max: 4, help: 'Side and top outline width factor' },
    tickWidth: { value: 0.6, min: 0, max: 4, help: 'Tick width factor' },
    tickLen: { value: 2.4, min: 0, max: 20, unit: 'mm', help: 'Tick length' },
    frontDur: { value: 0.35, min: 0.01, max: 2, unit: 's', help: 'Front rectangle stroke duration' },
    sideDelay: { value: 0.1, min: 0, max: 2, unit: 's', help: 'Side outline delay after t0' },
    sideDur: { value: 0.3, min: 0.01, max: 2, unit: 's', help: 'Side outline duration' },
    tickDelay: { value: 0.2, min: 0, max: 2, unit: 's', help: 'First tick delay after t0' },
    tickStagger: { value: 0.03, min: 0, max: 1, unit: 's', help: 'Delay between ticks' },
    tickDur: { value: 0.08, min: 0.01, max: 1, unit: 's', help: 'Tick stroke duration' },
    shade: { value: 0.06, min: 0, max: 1, help: 'Segment paper shading' },
  },
} satisfies GroupDef<Record<string, Def>>;

export const SPILL_DEFS = {
  id: 'energy.spill-lights',
  label: 'Spill light slots',
  kind: 'light',
  tags: ['energy', 'light', 'effect', 'animation'],
  describe: 'The strongest glow sources drive three coloured point lights; incumbents get a bonus so lights do not flicker between sources, and slots fade in and out.',
  params: {
    gain: { value: 2600, min: 0, max: 20000, help: 'Point light intensity = gain * strength * slot fade' },
    hysteresis: { value: 0.2, min: 0, max: 2, help: 'Score bonus of a source already in a slot' },
    rate: { value: 12, min: 0, max: 100, unit: '1/s', help: 'Slot fade rate: 1 - exp(-rate dt)' },
    minStrength: { value: 0.01, min: 0, max: 1, help: 'Sources at or below this strength are dropped at once' },
    drop: { value: 0.02, min: 0, max: 1, help: 'A fading slot is cleared below this value' },
    decay: { value: 2, min: 0, max: 4, help: 'Point light decay (2 = physical)' },
  },
} satisfies GroupDef<Record<string, Def>>;

export const LEDGER_DEFS = {
  id: 'energy.ledger',
  label: 'Energy ledger',
  kind: 'data',
  tags: ['energy', 'physics', 'data'],
  describe: 'Bookkeeping of every joule: accounts per store and object, compensated sums, and power flows smoothed over a time constant.',
  params: {
    timeConstant: { value: 0.2, min: 0.001, max: 10, unit: 's', help: 'Power flow smoothing time constant (simulation seconds)' },
    logSize: { value: 240, min: 0, max: 10000, step: 1, help: 'Steps kept in the log' },
    minWatts: { value: 1e-6, min: 0, max: 1, unit: 'W', help: 'Smoothed flows below this are dropped' },
  },
} satisfies GroupDef<Record<string, Def>>;

export const energyConfig = {
  jar: plain(JAR_DEFS.params),
  liquid: plain(LIQUID_DEFS.params),
  bubbles: plain(BUBBLE_DEFS.params),
  card: plain(CARD_DEFS.params),
  scale: plain(SCALE_DEFS.params),
  hue: plain(HUE_DEFS.params),
  glow: plain(GLOW_DEFS.params),
  stream: plain(STREAM_DEFS.params),
  speeds: plain(SPEED_DEFS.params),
  modes: plain(MODE_DEFS.params),
  flow: plain(FLOW_DEFS.params),
  ribbon: plain(RIBBON_DEFS.params),
  bar: plain(BAR_DEFS.params),
  spill: plain(SPILL_DEFS.params),
  ledger: plain(LEDGER_DEFS.params),
};

export type EnergyConfig = typeof energyConfig;

const GROUPS = {
  jar: JAR_DEFS, liquid: LIQUID_DEFS, bubbles: BUBBLE_DEFS, card: CARD_DEFS, scale: SCALE_DEFS, hue: HUE_DEFS,
  glow: GLOW_DEFS, stream: STREAM_DEFS, speeds: SPEED_DEFS, modes: MODE_DEFS, flow: FLOW_DEFS, ribbon: RIBBON_DEFS,
  bar: BAR_DEFS, spill: SPILL_DEFS, ledger: LEDGER_DEFS,
} as const;

/**
 * Registers every shared energy group (`energy.jar`, `energy.stream`, `energy.glow`, ...). Safe to call more than
 * once; instances call it for you when given a registry.
 */
export function registerEnergy(registry: Registry): EnergyConfig {
  const cfg = energyConfig as Record<keyof typeof GROUPS, unknown>;
  for (const key of Object.keys(GROUPS) as (keyof typeof GROUPS)[]) {
    const g = GROUPS[key] as GroupDef<Record<string, Def>>;
    if (registry.has(g.id)) continue;
    cfg[key] = exposeGroup(registry, g, cfg[key] as Tuned<Record<string, Def>>);
  }
  return energyConfig;
}
