/**
 * The post chain: RenderPass -> N8AO ambient occlusion (high tier) -> one merged EffectPass with SMAA, selective
 * bloom, vignette, the hue-preserving tone map and the liquid glass, then the sRGB encode. Half-float buffers keep
 * HDR values until the tone map. Every effect parameter is registered under `post.*`.
 */
import {
  BlendFunction, EffectComposer, EffectPass, RenderPass, SelectiveBloomEffect, SMAAEffect, SMAAPreset, VignetteEffect,
  VignetteTechnique, type Effect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { Color, HalfFloatType, Vector2, type Object3D, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three';
import type { Registry } from '../core/registry';
import { tunable } from '../core/tune';
import { LAYERS, type GlassRect, type PostApi } from '../contracts';
import { GLASS_DEFAULTS, LiquidGlassEffect, type GlassParams } from './glass';
import { SPILL_MAP_DEFAULTS, SpillMapRenderer } from './spill-map';
import { HueToneEffect, TONE_DEFAULTS } from './tone';

const SRC = 'src/engine/post/composer.ts';

export interface PostOptions {
  registry: Registry;
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  /** Create the ambient-occlusion pass at all (false with `?noao`). */
  ao?: boolean;
}

export interface Post extends PostApi {
  readonly composer: EffectComposer;
  readonly ao: N8AOPostPass | null;
  readonly smaa: SMAAEffect;
  readonly bloom: SelectiveBloomEffect;
  readonly vignette: VignetteEffect;
  readonly tone: HueToneEffect;
  readonly glass: LiquidGlassEffect;
  readonly spill: SpillMapRenderer;
  readonly built: boolean;
  /** Queue an extra effect before the vignette, or after the tone map with `{ after: 'tone' }`. Only before the first render. */
  addEffect(effect: Effect, opts?: { after?: 'tone' }): void;
  /** Quality tier switch for the AO pass (the `post.ao.enabled` parameter must also allow it). */
  setAOAllowed(on: boolean): void;
  setBloomResolutionScale(scale: number): void;
  dispose(): void;
}

const SMAA_PRESETS = ['low', 'medium', 'high', 'ultra'] as const;
const SMAA_MAP: Record<(typeof SMAA_PRESETS)[number], SMAAPreset> = {
  low: SMAAPreset.LOW, medium: SMAAPreset.MEDIUM, high: SMAAPreset.HIGH, ultra: SMAAPreset.ULTRA,
};

export function createPost(opts: PostOptions): Post {
  const { registry, renderer, scene, camera } = opts;
  // Registry overrides queued before creation apply during registration; handlers wait until everything exists.
  let wired = false;
  const on = <K extends string>(fn: (k: K) => void) => (k: K) => {
    if (wired) fn(k);
  };
  const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: 0, depthBuffer: true, stencilBuffer: false });
  composer.autoRenderToScreen = true;
  registry.add({
    id: 'post.composer', label: 'Post chain', kind: 'post-chain', tags: ['post', 'effect'],
    describe: 'RenderPass, then ambient occlusion (high tier), then one merged pass: SMAA, bloom, vignette, tone map, glass. Half-float HDR buffers, no MSAA.',
    source: SRC,
  });
  composer.addPass(new RenderPass(scene, camera));

  // ------------------------------------------------------------------ ambient occlusion
  let ao: N8AOPostPass | null = null;
  let aoTierAllowed = true;
  const aoCfg = tunable(registry, {
    id: 'post.ao', label: 'Ambient occlusion', kind: 'post-effect', tags: ['post', 'shadow', 'effect', 'quality'],
    describe: 'Screen-space contact shadows (N8AO) where the book meets the pad and pop-ups meet the page. Static noise, no accumulation. Only on the high tier.',
    source: SRC,
    params: {
      enabled: { value: true, help: 'Allow AO (the quality tier may still turn it off)' },
      samples: { value: 8, min: 1, max: 64, step: 1, help: 'Hemisphere samples per pixel' },
      radius: { value: 14, min: 0.5, max: 200, step: 0.5, unit: 'mm', help: 'World-space occlusion radius' },
      distanceFalloff: { value: 2, min: 0, max: 10, step: 0.1, help: 'Range-check falloff (times radius x 0.2)' },
      intensity: { value: 2, min: 0, max: 10, step: 0.05, help: 'Exponent on the occlusion term' },
      color: { value: '#2a2622', help: 'Occlusion tint (linearised twice by the pass, so it ends almost black)' },
      halfRes: { value: true, help: 'Compute at half resolution with depth-aware upsampling' },
      denoiseSamples: { value: 4, min: 1, max: 32, step: 1, help: 'Denoise taps' },
      denoiseRadius: { value: 6, min: 0, max: 48, step: 0.5, unit: 'px', help: 'Denoise radius' },
      denoiseIterations: { value: 2, min: 0, max: 8, step: 1, help: 'Denoise passes' },
    },
    onChange: on((k) => applyAO(k)),
  });
  const aoColor = new Color();
  const applyAO = (k?: string) => {
    if (!ao) return;
    const c = ao.configuration;
    if (k === undefined || k === 'samples') c.aoSamples = aoCfg.samples;
    if (k === undefined || k === 'radius') c.aoRadius = aoCfg.radius;
    if (k === undefined || k === 'distanceFalloff') c.distanceFalloff = aoCfg.distanceFalloff;
    if (k === undefined || k === 'intensity') c.intensity = aoCfg.intensity;
    if (k === undefined || k === 'color') c.color = aoColor.set(aoCfg.color).clone();
    if (k === undefined || k === 'halfRes') c.halfRes = aoCfg.halfRes;
    if (k === undefined || k === 'denoiseSamples') c.denoiseSamples = aoCfg.denoiseSamples;
    if (k === undefined || k === 'denoiseRadius') c.denoiseRadius = aoCfg.denoiseRadius;
    if (k === undefined || k === 'denoiseIterations') c.denoiseIterations = aoCfg.denoiseIterations;
    ao.enabled = aoCfg.enabled && aoTierAllowed;
  };
  if (opts.ao !== false) {
    const size = renderer.getDrawingBufferSize(new Vector2());
    ao = new N8AOPostPass(scene, camera, size.x, size.y);
    const c = ao.configuration;
    c.gammaCorrection = false;
    c.screenSpaceRadius = false;
    c.colorMultiply = true;
    c.accumulate = false;
    c.aoTones = 0;
    c.biasOffset = 0;
    c.biasMultiplier = 0;
    c.renderMode = 0;
    applyAO();
    composer.addPass(ao);
  }

  // ------------------------------------------------------------------ effects
  const smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
  const bloom = new SelectiveBloomEffect(scene, camera, {
    mipmapBlur: true, luminanceThreshold: 0, luminanceSmoothing: 0.2, intensity: 2, radius: 0.7, levels: 8,
  });
  bloom.ignoreBackground = true;
  bloom.selection.layer = LAYERS.bloom;
  const vignette = new VignetteEffect({ technique: VignetteTechnique.DEFAULT, offset: 0.24, darkness: 0.52 });
  const tone = new HueToneEffect(TONE_DEFAULTS);
  const glass = new LiquidGlassEffect(GLASS_DEFAULTS);
  const blendOf = new Map<Effect, BlendFunction>([
    [smaa, smaa.blendMode.blendFunction], [bloom, bloom.blendMode.blendFunction], [vignette, vignette.blendMode.blendFunction],
    [tone, tone.blendMode.blendFunction], [glass, glass.blendMode.blendFunction],
  ]);
  const toggle = (e: Effect, on: boolean) => {
    const want = on ? blendOf.get(e)! : BlendFunction.SKIP;
    if (e.blendMode.blendFunction !== want) e.blendMode.blendFunction = want;
  };

  const smaaCfg = tunable(registry, {
    id: 'post.smaa', label: 'Anti-aliasing', kind: 'post-effect', tags: ['post', 'effect', 'quality'],
    describe: 'SMAA on colour edges of the HDR frame; the only anti-aliasing (no MSAA).',
    source: SRC,
    params: {
      enabled: { value: true, help: 'Anti-alias edges' },
      preset: { value: 'high', options: SMAA_PRESETS, help: 'Search quality preset' },
    },
    onChange: on(() => applySmaa()),
  });
  const applySmaa = () => {
    smaa.applyPreset(SMAA_MAP[smaaCfg.preset as (typeof SMAA_PRESETS)[number]] ?? SMAAPreset.HIGH);
    toggle(smaa, smaaCfg.enabled);
  };
  const bloomCfg = tunable(registry, {
    id: 'post.bloom', label: 'Glow bloom', kind: 'post-effect', tags: ['post', 'effect', 'energy'],
    describe: 'Selective mipmap bloom: only visible pixels of selected glow objects bleed light, screen-blended over the frame.',
    source: SRC,
    params: {
      enabled: { value: true, help: 'Bloom on glow objects' },
      intensity: { value: 2, min: 0, max: 20, step: 0.05, help: 'Bloom strength' },
      threshold: { value: 0, min: 0, max: 2, step: 0.01, help: 'Luminance threshold' },
      smoothing: { value: 0.2, min: 0, max: 2, step: 0.01, help: 'Luminance smoothing above the threshold' },
      radius: { value: 0.7, min: 0, max: 1, step: 0.01, help: 'Spread of the mip chain blur' },
      levels: { value: 8, min: 1, max: 10, step: 1, help: 'Mip levels in the blur chain' },
      resolutionScale: { value: 0.5, min: 0.1, max: 1, step: 0.05, help: 'Set by quality tiers; no visible effect with the mipmap blur' },
    },
    onChange: on(() => applyBloom()),
  });
  const applyBloom = () => {
    bloom.intensity = bloomCfg.intensity;
    bloom.luminanceMaterial.threshold = bloomCfg.threshold;
    bloom.luminanceMaterial.smoothing = bloomCfg.smoothing;
    bloom.mipmapBlurPass.radius = bloomCfg.radius;
    if (bloom.mipmapBlurPass.levels !== bloomCfg.levels) bloom.mipmapBlurPass.levels = bloomCfg.levels;
    bloom.resolution.scale = bloomCfg.resolutionScale;
    toggle(bloom, bloomCfg.enabled);
  };
  const vigCfg = tunable(registry, {
    id: 'post.vignette', label: 'Vignette', kind: 'post-effect', tags: ['post', 'effect'],
    describe: 'Darkens the screen corners in linear HDR before the tone map: corners about 40 %, edge midpoints about 77 %.',
    source: SRC,
    params: {
      enabled: { value: true, help: 'Darken the corners' },
      offset: { value: 0.24, min: 0, max: 1, step: 0.01, help: 'Start of the falloff' },
      darkness: { value: 0.52, min: 0, max: 2, step: 0.01, help: 'Strength of the falloff' },
    },
    onChange: on(() => applyVignette()),
  });
  const applyVignette = () => {
    vignette.offset = vigCfg.offset;
    vignette.darkness = vigCfg.darkness;
    toggle(vignette, vigCfg.enabled);
  };
  const toneCfg = tunable(registry, {
    id: 'post.tone', label: 'Tone map', kind: 'post-effect', tags: ['post', 'effect'],
    describe: 'Hue-preserving neutral tone map: exposure, a quadratic toe, linear midtones and a highlight roll-off that keeps hue. The glass refraction uses the same curve.',
    source: 'src/engine/post/tone.ts',
    params: {
      enabled: { value: true, help: 'Apply the tone map (off shows clipped linear values)' },
      exposure: { value: TONE_DEFAULTS.exposure, min: 0, max: 4, step: 0.01, help: 'Exposure multiplier before the curve' },
      desaturation: { value: TONE_DEFAULTS.desaturation, min: 0, max: 1, step: 0.005, help: 'How much highlights fade toward white' },
      start: { value: TONE_DEFAULTS.start, min: 0.1, max: 0.99, step: 0.01, help: 'Peak value where highlight compression starts' },
      toe: { value: TONE_DEFAULTS.toe, min: 0.001, max: 0.3, step: 0.001, help: 'Darkest values below this are crushed quadratically' },
    },
    onChange: on(() => applyTone()),
  });
  const applyTone = () => {
    tone.exposure = toneCfg.exposure;
    tone.desaturation = toneCfg.desaturation;
    tone.start = toneCfg.start;
    tone.toe = toneCfg.toe;
    toggle(tone, toneCfg.enabled);
  };
  const glassCfg = tunable(registry, {
    id: 'post.glass', label: 'Glass refraction', kind: 'post-effect', tags: ['post', 'effect', 'ui', 'lens'],
    describe: 'Refracts the frame under up to 8 UI rectangles (capsule, cards, lens disc): edge refraction, chromatic split, frost blur or lens zoom, frost tint, a top-left rim light and a soft drop shadow.',
    source: 'src/engine/post/glass.ts',
    params: {
      enabled: { value: true, help: 'Draw glass under the UI rects' },
      refraction: { value: GLASS_DEFAULTS.refraction, min: 0, max: 200, step: 0.5, unit: 'px', help: 'Refraction offset at the rim' },
      bandMax: { value: GLASS_DEFAULTS.bandMax, min: 1, max: 200, step: 0.5, unit: 'px', help: 'Widest refracting rim band' },
      bandFraction: { value: GLASS_DEFAULTS.bandFraction, min: 0, max: 1, step: 0.01, help: 'Band limit as a fraction of the smaller half size' },
      chroma: { value: GLASS_DEFAULTS.chroma, min: 0, max: 30, step: 0.1, unit: 'px', help: 'Chromatic split at the rim' },
      lensChroma: { value: GLASS_DEFAULTS.lensChroma, min: 0, max: 5, step: 0.05, help: 'Chromatic split multiplier for the magnifier' },
      lensRefraction: { value: GLASS_DEFAULTS.lensRefraction, min: 0, max: 3, step: 0.05, help: 'Rim refraction mixed into the magnified view' },
      press: { value: GLASS_DEFAULTS.press, min: 0, max: 3, step: 0.05, help: 'Extra rim refraction while pressed' },
      blurStep: { value: GLASS_DEFAULTS.blurStep, min: 0, max: 20, step: 0.1, unit: 'px', help: 'Tap spacing of the 5x5 frost blur' },
      blurFalloff: { value: GLASS_DEFAULTS.blurFalloff, min: 0, max: 0.125, step: 0.005, help: 'Blur weight falloff (1 - k r^2)' },
      shadowOffset: { value: GLASS_DEFAULTS.shadowOffset, min: -50, max: 50, step: 0.5, unit: 'px', help: 'Drop shadow offset below the glass' },
      shadowBlur: { value: GLASS_DEFAULTS.shadowBlur, min: 0.5, max: 100, step: 0.5, unit: 'px', help: 'Drop shadow falloff' },
      shadowAlpha: { value: GLASS_DEFAULTS.shadowAlpha, min: 0, max: 1, step: 0.01, help: 'Drop shadow strength' },
      frostTint: { value: [...GLASS_DEFAULTS.frostTint], help: 'Frost colour mixed in by each rect tint (linear)' },
      frostGain: { value: GLASS_DEFAULTS.frostGain, min: 0, max: 2, step: 0.01, help: 'Brightness gain of the frosted glass' },
      frostLift: { value: GLASS_DEFAULTS.frostLift, min: 0, max: 0.5, step: 0.005, help: 'Brightness lift of the frosted glass' },
      rimOffset: { value: GLASS_DEFAULTS.rimOffset, min: 0, max: 10, step: 0.1, unit: 'px', help: 'Rim line inset from the edge' },
      rimWidth: { value: GLASS_DEFAULTS.rimWidth, min: 0.1, max: 10, step: 0.1, unit: 'px', help: 'Rim line width' },
      rimSpec: { value: GLASS_DEFAULTS.rimSpec, min: 0, max: 2, step: 0.01, help: 'Rim highlight strength' },
      rimSpecBase: { value: GLASS_DEFAULTS.rimSpecBase, min: 0, max: 1, step: 0.01, help: 'Rim highlight on the side away from the light' },
      rimDark: { value: GLASS_DEFAULTS.rimDark, min: 0, max: 1, step: 0.01, help: 'Rim darkening on the shadow side' },
      inner: { value: GLASS_DEFAULTS.inner, min: 0, max: 0.5, step: 0.005, help: 'Shading of the lower inner band' },
      chromaR: { value: GLASS_DEFAULTS.chromaR, min: 0.5, max: 1.5, step: 0.01, help: 'Red refraction factor' },
      chromaB: { value: GLASS_DEFAULTS.chromaB, min: 0.5, max: 1.5, step: 0.01, help: 'Blue refraction factor' },
      light: { value: [...GLASS_DEFAULTS.light], help: 'Rim light direction in screen pixels (y down)' },
      edgeAA: { value: GLASS_DEFAULTS.edgeAA, min: 0.1, max: 4, step: 0.1, unit: 'px', help: 'Anti-aliased edge half width' },
      defaultTint: { value: 0.38, min: 0, max: 1, step: 0.01, help: 'Frost tint UI elements use unless they set their own' },
      defaultRadius: { value: 20, min: 0, max: 100, step: 1, unit: 'px', help: 'Corner radius UI elements use unless they set their own' },
    },
    onChange: on(() => applyGlass()),
  });
  const applyGlass = () => {
    const p: GlassParams = {
      ...GLASS_DEFAULTS,
      refraction: glassCfg.refraction, bandMax: glassCfg.bandMax, bandFraction: glassCfg.bandFraction, chroma: glassCfg.chroma,
      lensChroma: glassCfg.lensChroma, lensRefraction: glassCfg.lensRefraction, press: glassCfg.press, blurStep: glassCfg.blurStep,
      blurFalloff: glassCfg.blurFalloff, shadowOffset: glassCfg.shadowOffset, shadowBlur: glassCfg.shadowBlur, shadowAlpha: glassCfg.shadowAlpha,
      frostTint: [glassCfg.frostTint[0]!, glassCfg.frostTint[1]!, glassCfg.frostTint[2]!], frostGain: glassCfg.frostGain, frostLift: glassCfg.frostLift,
      rimOffset: glassCfg.rimOffset, rimWidth: glassCfg.rimWidth, rimSpec: glassCfg.rimSpec, rimSpecBase: glassCfg.rimSpecBase,
      rimDark: glassCfg.rimDark, inner: glassCfg.inner, chromaR: glassCfg.chromaR, chromaB: glassCfg.chromaB,
      light: [glassCfg.light[0]!, glassCfg.light[1]!], edgeAA: glassCfg.edgeAA,
    };
    glass.setParams(p);
    toggle(glass, glassCfg.enabled);
  };

  // ------------------------------------------------------------------ spill map
  const spill = new SpillMapRenderer(renderer, scene, { ...SPILL_MAP_DEFAULTS });
  const spillCfg = tunable(registry, {
    id: 'post.spill-map', label: 'Glow printed onto the page', kind: 'render-texture', tags: ['light', 'energy', 'texture', 'paper', 'post'],
    describe: 'Top-down render of the glow layer into a small half-float map, blurred three times; page materials add it after lighting so glow shows under glowing objects. Keeps rendering a tail of frames after the glow stops.',
    source: 'src/engine/post/spill-map.ts',
    params: {
      x0: { value: SPILL_MAP_DEFAULTS.x0, min: -2000, max: 2000, unit: 'mm', help: 'World x of the map rect left edge' },
      z0: { value: SPILL_MAP_DEFAULTS.z0, min: -2000, max: 2000, unit: 'mm', help: 'World z of the map rect far edge' },
      width: { value: SPILL_MAP_DEFAULTS.width, min: 10, max: 4000, unit: 'mm', help: 'Map rect width (x)' },
      depth: { value: SPILL_MAP_DEFAULTS.depth, min: 10, max: 4000, unit: 'mm', help: 'Map rect depth (z)' },
      resX: { value: SPILL_MAP_DEFAULTS.resX, min: 8, max: 2048, step: 1, unit: 'px', help: 'Map width in texels' },
      resY: { value: SPILL_MAP_DEFAULTS.resY, min: 8, max: 2048, step: 1, unit: 'px', help: 'Map height in texels' },
      spread: { value: SPILL_MAP_DEFAULTS.spread, min: 0, max: 10, step: 0.05, unit: 'texel', help: 'Blur step of the first iteration (grows 1x, 2x, 3x)' },
      iterations: { value: SPILL_MAP_DEFAULTS.iterations, min: 0, max: 8, step: 1, help: 'Blur iterations (horizontal + vertical each)' },
      gain: { value: SPILL_MAP_DEFAULTS.gain, min: 0, max: 20, step: 0.05, help: 'Strength on the page (page materials read it)' },
      tail: { value: SPILL_MAP_DEFAULTS.tail, min: 0, max: 600, step: 1, unit: 'frames', help: 'Frames rendered after the glow stops being live' },
      cameraHeight: { value: SPILL_MAP_DEFAULTS.cameraHeight, min: 10, max: 5000, unit: 'mm', help: 'Height of the top-down camera' },
      near: { value: SPILL_MAP_DEFAULTS.near, min: 0.1, max: 1000, unit: 'mm', help: 'Top-down camera near plane' },
      far: { value: SPILL_MAP_DEFAULTS.far, min: 10, max: 9000, unit: 'mm', help: 'Top-down camera far plane' },
      w0: { value: SPILL_MAP_DEFAULTS.w0, min: 0, max: 1, step: 0.001, help: 'Blur centre weight' },
      w1: { value: SPILL_MAP_DEFAULTS.w1, min: 0, max: 1, step: 0.001, help: 'Blur inner pair weight' },
      w2: { value: SPILL_MAP_DEFAULTS.w2, min: 0, max: 1, step: 0.001, help: 'Blur outer pair weight' },
      o1: { value: SPILL_MAP_DEFAULTS.o1, min: 0, max: 10, step: 0.01, unit: 'step', help: 'Blur inner pair offset' },
      o2: { value: SPILL_MAP_DEFAULTS.o2, min: 0, max: 10, step: 0.01, unit: 'step', help: 'Blur outer pair offset' },
    },
    onChange: on(() => applySpill()),
  });
  const applySpill = () => {
    spill.params = { ...spillCfg };
    spill.gain = spillCfg.gain;
    spill.configure();
  };

  wired = true;
  applyAO();
  applySmaa();
  applyBloom();
  applyVignette();
  applyTone();
  applyGlass();
  applySpill();

  // ------------------------------------------------------------------ build and render
  const before: Effect[] = [];
  const after: Effect[] = [];
  let pass: EffectPass | null = null;
  const build = () => {
    pass = new EffectPass(camera, smaa, bloom, ...before, vignette, tone, ...after, glass);
    pass.dithering = false;
    composer.addPass(pass);
  };
  const size = new Vector2();
  const post: Post = {
    composer, ao, smaa, bloom, vignette, tone, glass, spill, spillMap: spill,
    get built() {
      return pass !== null;
    },
    get exposure() {
      return toneCfg.exposure;
    },
    set exposure(v: number) {
      registry.set('post.tone', 'exposure', v);
    },
    addEffect(effect, o) {
      if (pass) throw new Error('inkleaf: post effects must be added before the first render');
      (o?.after === 'tone' ? after : before).push(effect);
    },
    setAOAllowed(on) {
      aoTierAllowed = on;
      if (ao) ao.enabled = aoCfg.enabled && on;
    },
    setBloomResolutionScale(scale) {
      registry.set('post.bloom', 'resolutionScale', scale);
    },
    bloomSelect(obj: Object3D, on: boolean) {
      if (on) bloom.selection.add(obj);
      else bloom.selection.delete(obj);
    },
    setGlassRects(rects: readonly GlassRect[]) {
      glass.setRects(rects);
    },
    setSize(width: number, height: number) {
      composer.setSize(width, height, false);
      renderer.getDrawingBufferSize(size);
      glass.setResolution(size.x, size.y);
    },
    render(dt: number) {
      if (!pass) build();
      glass.setTone(tone.exposure, tone.desaturation, tone.start, tone.toe);
      composer.render(dt);
    },
    dispose() {
      composer.dispose();
      spill.dispose();
      for (const e of [smaa, bloom, vignette, tone, glass, ...before, ...after]) e.dispose();
    },
  };
  renderer.getDrawingBufferSize(size);
  glass.setResolution(size.x, size.y);
  return post;
}
