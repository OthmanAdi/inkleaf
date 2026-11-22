/**
 * Energy visuals: quantity palette, store jars, streams, flows, sankey ribbons, stacked bars, glow routing, spill
 * light slots and the energy ledger.
 */
export { energyConfig, registerEnergy, type EnergyConfig } from './config';
export {
  Palette, ENERGY_STORES, ENERGY_PATHWAYS, PATTERNS, PATHWAY_MODES, defaultPalette, setDefaultPalette, drawPattern, modeIndex,
  type Quantity, type Pathway, type PathwayMode, type PatternKind,
} from './palette';
export { hueBlend, blendHalfWidth, hueDelta, rgbToHsv, hsvToRgb, flowBlendT, smoothstep, HUE_GLSL, type Rgb, type Hsv } from './hue';
export { Ledger, Neumaier, neumaierSum, matches, type Flow, type BoundaryFlow, type LedgerOptions, type LedgerJSON, type AccountMatch } from './ledger';
export { drawCard, cardFontsReady, CARD_W, CARD_H, type CardText, type CardLayout } from './card';
export { createLiquidMaterial, syncLiquidUniforms } from './liquid';
export {
  Jar, jarFill, jarLevel, easeLit, liquidAlpha, jarStrength, bubbleConstants, bubbleEnvelope, jarSchedule, ringPoints,
  type JarOptions, type JarFrame, type CardPlacement,
} from './jar';
export {
  Stream, archPoints, tubeGeometry, createTubeMaterial, streamRadius, streamSpeed, glowStep, glowRamp, beadsShown, beadAt,
  type StreamOptions, type StreamFrame, type ColorSource,
} from './stream';
export { FadingStream, PacketStream, flowPower, driveStream, packetOffsets } from './flow';
export { Ribbon, ribbonSpeed, ribbonWidth, type RibbonOptions } from './ribbon';
export { TotalBar, stackBar, type TotalBarOptions, type BarSegment } from './total-bar';
export { GlowRouter, routeGlow, SpillSlots, type BloomSelect, type SpillTarget, type SpillSlot } from './glow';
export { handText, addHandText, handTextWidth, inkArrow, GLYPHS, type HandTextOptions } from './handwriting';
