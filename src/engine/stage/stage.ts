/**
 * The stage: background, room environment, the window key light with its cookie and shadow, the sky/ground fill,
 * three spill point lights, the oak desk and the lino pad. Everything is registered under `stage.*` and `light.*`
 * with every number as a live parameter.
 */
import {
  Color, DataTexture, HemisphereLight, Mesh, MeshStandardMaterial, PointLight, RGBAFormat, SpotLight, SRGBColorSpace,
  UnsignedByteType, Vector2, Vector3,
  type IUniform, type PerspectiveCamera, type Scene, type WebGLRenderer, type WebGLRenderTarget, type Texture,
} from 'three';
import type { Registry } from '../core/registry';
import { tunable } from '../core/tune';
import type { GlowSource, StageApi } from '../contracts';
import { COOKIE_DEFAULTS, applyWindowCookie, type CookieOptions } from './cookie';
import { deskGeometry, padGeometry } from './desk';
import { ROOM_DEFAULTS, buildEnvironment, type RoomOptions } from './environment';
import { LINO_DEFAULTS, type LinoOptions } from './lino';
import { OAK_DEFAULTS, type OakOptions, type TextureBuffers } from './oak';
import { SpillSlots } from './spill-lights';
import { LINO_WRAP, OAK_WRAP, generate, toTextures, type MaterialTextures } from './textures';

const SRC = 'src/engine/stage/stage.ts';

export interface StageOptions {
  registry: Registry;
  renderer: WebGLRenderer;
  scene: Scene;
  /** Shared uniforms written every frame by `update(camera)`. */
  uniforms: { uKeyDir: IUniform<Vector3>; uKeyColor: IUniform<Color> };
  /** Skip worker texture generation and build flat placeholders only (tests, thumbnails). */
  placeholdersOnly?: boolean;
}

export interface Stage extends StageApi {
  /** Resolves when the oak and lino textures are generated and uploaded. */
  readonly ready: Promise<void>;
  /** Base key-shadow intensity the turn easing returns to. */
  readonly keyShadowBase: number;
  /** Shadow map size of the key light (quality tiers change it). */
  setShadowMapSize(size: number): void;
  readonly environment: Texture | null;
  dispose(): void;
}

const hexBytes = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const bytesHex = (b: readonly number[]) => '#' + b.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const v3 = (a: readonly number[]) => [a[0]!, a[1]!, a[2]!] as [number, number, number];

function placeholder(rgb: readonly [number, number, number], srgb: boolean): DataTexture {
  const t = new DataTexture(new Uint8ClampedArray([rgb[0], rgb[1], rgb[2], 255]), 1, 1, RGBAFormat, UnsignedByteType);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export function createStage(opts: StageOptions): Stage {
  const { registry, renderer, scene, uniforms } = opts;
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  // Overrides queued in the registry apply while an entity registers, before the closures below exist; handlers
  // run only once everything is wired, and the final block applies the current values once.
  let wired = false;
  const on = <K extends string>(fn: (k: K) => void) => (k: K) => {
    if (wired) fn(k);
  };

  // ------------------------------------------------------------------ scene and environment
  const sceneCfg = tunable(registry, {
    id: 'stage.scene', label: 'Scene and background', kind: 'scene', tags: ['environment', 'layout'],
    describe: 'Background colour behind the desk and the strength of the room reflections on every lit material.',
    source: SRC,
    params: {
      background: { value: '#b9b0a2', help: 'Clear colour seen past the desk edges (sRGB)' },
      environmentIntensity: { value: 0.75, min: 0, max: 3, step: 0.01, help: 'Room reflection strength for every standard material' },
    },
    onChange: on(() => applyScene()),
  });
  const bg = new Color();
  const applyScene = () => {
    scene.background = bg.set(sceneCfg.background);
    scene.environmentIntensity = sceneCfg.environmentIntensity;
  };
  applyScene();

  const room = tunable(registry, {
    id: 'stage.environment', label: 'Room environment map', kind: 'environment-map', tags: ['environment', 'light', 'texture'],
    describe: 'A procedural room rendered into a PMREM cube: walls, floor, a bright window at the key light and a warm bounce panel. Linear colours; above 1 is an emitter.',
    source: 'src/engine/stage/environment.ts',
    params: {
      wallPosX: { value: v3(ROOM_DEFAULTS.walls[0]), help: 'Right wall colour (linear)' },
      wallNegX: { value: v3(ROOM_DEFAULTS.walls[1]), help: 'Left wall colour (linear)' },
      ceiling: { value: v3(ROOM_DEFAULTS.walls[2]), help: 'Ceiling colour (linear)' },
      floorWall: { value: v3(ROOM_DEFAULTS.walls[3]), help: 'Room floor face colour (linear)' },
      wallPosZ: { value: v3(ROOM_DEFAULTS.walls[4]), help: 'Wall behind the reader (linear)' },
      wallNegZ: { value: v3(ROOM_DEFAULTS.walls[5]), help: 'Far wall colour (linear)' },
      roomHalf: { value: ROOM_DEFAULTS.roomHalf, min: 500, max: 8000, unit: 'mm', help: 'Half size of the room box' },
      floorColor: { value: v3(ROOM_DEFAULTS.floorColor), help: 'Floor plane under the desk (linear)' },
      floorY: { value: ROOM_DEFAULTS.floorY, min: -2000, max: 0, unit: 'mm', help: 'Height of the floor plane' },
      floorSize: { value: ROOM_DEFAULTS.floorSize, min: 500, max: 8000, unit: 'mm', help: 'Floor plane size' },
      windowDir: { value: v3(ROOM_DEFAULTS.windowDir), help: 'Direction from the desk to the window' },
      windowDistance: { value: ROOM_DEFAULTS.windowDistance, min: 500, max: 2900, unit: 'mm', help: 'Distance of the window from the desk' },
      windowWidth: { value: ROOM_DEFAULTS.windowWidth, min: 200, max: 4000, unit: 'mm', help: 'Window opening width' },
      windowHeight: { value: ROOM_DEFAULTS.windowHeight, min: 200, max: 4000, unit: 'mm', help: 'Window opening height' },
      frameMargin: { value: ROOM_DEFAULTS.frameMargin, min: 0, max: 800, unit: 'mm', help: 'Backing frame beyond the opening' },
      frameColor: { value: v3(ROOM_DEFAULTS.frameColor), help: 'Window frame colour (linear)' },
      mullion: { value: ROOM_DEFAULTS.mullion, min: 0, max: 400, unit: 'mm', help: 'Width of the mullion cross between panes' },
      paneLow: { value: v3(ROOM_DEFAULTS.paneLow), help: 'Lower pane emission (linear HDR)' },
      paneHigh: { value: v3(ROOM_DEFAULTS.paneHigh), help: 'Upper pane emission (linear HDR)' },
      bounceDir: { value: v3(ROOM_DEFAULTS.bounceDir), help: 'Direction of the warm bounce panel' },
      bounceDistance: { value: ROOM_DEFAULTS.bounceDistance, min: 500, max: 2900, unit: 'mm', help: 'Distance of the bounce panel' },
      bounceWidth: { value: ROOM_DEFAULTS.bounceWidth, min: 100, max: 4000, unit: 'mm', help: 'Bounce panel width' },
      bounceHeight: { value: ROOM_DEFAULTS.bounceHeight, min: 100, max: 4000, unit: 'mm', help: 'Bounce panel height' },
      bounceColor: { value: v3(ROOM_DEFAULTS.bounceColor), help: 'Bounce panel emission (linear HDR)' },
      sigma: { value: ROOM_DEFAULTS.sigma, min: 0, max: 0.5, step: 0.005, help: 'PMREM blur of the room render' },
    },
    onChange: on(() => (envDirty = true)),
  });
  let envTarget: WebGLRenderTarget | null = null;
  let envDirty = true;
  const rebuildEnvironment = () => {
    envDirty = false;
    const o: RoomOptions = {
      ...ROOM_DEFAULTS,
      roomHalf: room.roomHalf,
      walls: [v3(room.wallPosX), v3(room.wallNegX), v3(room.ceiling), v3(room.floorWall), v3(room.wallPosZ), v3(room.wallNegZ)],
      floorSize: room.floorSize, floorY: room.floorY, floorColor: v3(room.floorColor),
      windowDir: v3(room.windowDir), windowDistance: room.windowDistance, windowWidth: room.windowWidth, windowHeight: room.windowHeight,
      frameMargin: room.frameMargin, frameColor: v3(room.frameColor), mullion: room.mullion,
      paneLow: v3(room.paneLow), paneHigh: v3(room.paneHigh),
      bounceDir: v3(room.bounceDir), bounceDistance: room.bounceDistance, bounceWidth: room.bounceWidth, bounceHeight: room.bounceHeight,
      bounceColor: v3(room.bounceColor), sigma: room.sigma,
    };
    const prev = envTarget;
    const env = buildEnvironment(renderer, o);
    envTarget = env.target;
    scene.environment = env.texture;
    prev?.dispose();
  };

  // ------------------------------------------------------------------ desk geometry level
  const level = tunable(registry, {
    id: 'stage.level', label: 'Desk level', kind: 'layout', tags: ['desk', 'layout'],
    describe: 'Height of the pad top where the book rests. The desk sits one pad thickness lower.',
    source: SRC,
    params: { deskTop: { value: -12.575, min: -200, max: 200, step: 0.005, unit: 'mm', help: 'y of the pad top surface (book bottom board)' } },
    onChange: on(() => {
      placeMeshes();
      cookieDirty = true;
    }),
  });

  // ------------------------------------------------------------------ key light
  const key = new SpotLight('#f3f7ff', 4.2, 0, 0.36, 0.35, 0);
  key.castShadow = true;
  key.layers.enableAll();
  key.target.layers.enableAll();
  scene.add(key, key.target);
  const keyCfg = tunable(registry, {
    id: 'light.key', label: 'Window key light', kind: 'spot-light', tags: ['light', 'shadow', 'desk'],
    describe: 'Cool daylight from a high window at back-left. No distance falloff; casts the soft PCF shadows and carries the window cookie.',
    object: key, source: SRC,
    params: {
      color: { value: '#f3f7ff', help: 'Light colour (sRGB)' },
      intensity: { value: 4.2, min: 0, max: 20, step: 0.01, help: 'Light intensity (decay 0, so no falloff)' },
      direction: { value: [-0.6, 0.66, -0.48], help: 'Direction from the target to the light (normalised)' },
      distance: { value: 2300, min: 400, max: 6000, unit: 'mm', help: 'Distance of the light from its target' },
      target: { value: [0, -12.575, 20], unit: 'mm', help: 'Point the light aims at' },
      angle: { value: 0.36, min: 0.05, max: 1.5, step: 0.001, unit: 'rad', help: 'Cone half angle' },
      penumbra: { value: 0.35, min: 0, max: 1, step: 0.01, help: 'Soft fraction of the cone edge' },
      decay: { value: 0, min: 0, max: 2, step: 0.1, help: 'Distance falloff exponent (0 = none)' },
    },
    onChange: on(() => applyKey()),
  });
  const shadowCfg = tunable(registry, {
    id: 'light.key.shadow', label: 'Key light shadow', kind: 'shadow', tags: ['shadow', 'light'], parent: 'light.key',
    describe: 'PCF shadow of the window light. Intensity is the resting strength; page turns ease it toward the turn target.',
    source: SRC,
    params: {
      intensity: { value: 1, min: 0, max: 1, step: 0.01, help: 'Resting shadow strength (1 = full)' },
      mapSize: { value: 2048, min: 256, max: 4096, step: 256, unit: 'px', help: 'Shadow map resolution (low tier uses 1024)' },
      near: { value: 1400, min: 1, max: 5000, unit: 'mm', help: 'Shadow camera near plane' },
      far: { value: 3300, min: 100, max: 9000, unit: 'mm', help: 'Shadow camera far plane' },
      bias: { value: -0.0002, min: -0.01, max: 0.01, step: 0.00005, help: 'Depth bias' },
      normalBias: { value: 0.8, min: 0, max: 5, step: 0.05, unit: 'mm', help: 'Offset along the surface normal' },
      radius: { value: 2.4, min: 0, max: 10, step: 0.1, unit: 'texel', help: 'PCF filter radius' },
    },
    onChange: on((k) => applyShadow(k)),
  });
  const cookieCfg = tunable(registry, {
    id: 'light.key.cookie', label: 'Window frame shadow pattern', kind: 'light-cookie', tags: ['shadow', 'texture', 'light'], parent: 'light.key',
    describe: 'Grey mask projected by the key light: a four-pane window with a mullion cross and an outer frame, defined on the desk plane per light ray.',
    source: 'src/engine/stage/cookie.ts',
    params: {
      enabled: { value: true, help: 'Project the window pattern' },
      size: { value: COOKIE_DEFAULTS.size, min: 64, max: 2048, step: 64, unit: 'px', help: 'Cookie texture size' },
      crossX: { value: COOKIE_DEFAULTS.crossX, min: -3000, max: 3000, unit: 'mm', help: 'Desk x where the bars cross' },
      crossZ: { value: COOKIE_DEFAULTS.crossZ, min: -3000, max: 3000, unit: 'mm', help: 'Desk z where the bars cross' },
      tMin: { value: COOKIE_DEFAULTS.tMin, min: -4000, max: 0, unit: 'mm', help: 'Window edge across the light, near side' },
      tMax: { value: COOKIE_DEFAULTS.tMax, min: 0, max: 4000, unit: 'mm', help: 'Window edge across the light, far side' },
      aMin: { value: COOKIE_DEFAULTS.aMin, min: -4000, max: 0, unit: 'mm', help: 'Window edge along the light, back' },
      aMax: { value: COOKIE_DEFAULTS.aMax, min: 0, max: 4000, unit: 'mm', help: 'Window edge along the light, front' },
      softness: { value: COOKIE_DEFAULTS.softness, min: 0, max: 300, unit: 'mm', help: 'Blur of the outer frame edges' },
      barAlong: { value: COOKIE_DEFAULTS.barAlong, min: 0, max: 300, unit: 'mm', help: 'Width of the bar along the light axis' },
      barAcross: { value: COOKIE_DEFAULTS.barAcross, min: 0, max: 300, unit: 'mm', help: 'Width of the bar across the light axis' },
      barSoftness: { value: COOKIE_DEFAULTS.barSoftness, min: 0, max: 200, unit: 'mm', help: 'Blur of the bar edges' },
    },
    onChange: on(() => (cookieDirty = true)),
  });
  let cookieTex: DataTexture | undefined;
  let cookieDirty = true;
  const dir = new Vector3();
  const applyKey = () => {
    key.color.set(keyCfg.color);
    key.intensity = keyCfg.intensity;
    key.angle = keyCfg.angle;
    key.penumbra = keyCfg.penumbra;
    key.decay = keyCfg.decay;
    const t = keyCfg.target;
    key.target.position.set(t[0]!, t[1]!, t[2]!);
    dir.set(keyCfg.direction[0]!, keyCfg.direction[1]!, keyCfg.direction[2]!).normalize();
    key.position.copy(key.target.position).addScaledVector(dir, keyCfg.distance);
    cookieDirty = true;
  };
  const applyShadow = (k?: string) => {
    const s = key.shadow;
    if (k === undefined || k === 'mapSize') setShadowMapSize(shadowCfg.mapSize);
    s.camera.near = shadowCfg.near;
    s.camera.far = shadowCfg.far;
    s.camera.updateProjectionMatrix();
    s.bias = shadowCfg.bias;
    s.normalBias = shadowCfg.normalBias;
    s.radius = shadowCfg.radius;
    if (k === undefined || k === 'intensity') s.intensity = shadowCfg.intensity;
    cookieDirty = true;
  };
  const setShadowMapSize = (size: number) => {
    const s = key.shadow;
    if (s.mapSize.x === size && s.mapSize.y === size) return;
    s.map?.dispose();
    s.map = null;
    s.mapSize.set(size, size);
  };
  applyKey();
  applyShadow();
  const refreshCookie = () => {
    cookieDirty = false;
    if (!cookieCfg.enabled) {
      key.map = null;
      return;
    }
    const o: CookieOptions = {
      size: cookieCfg.size, crossX: cookieCfg.crossX, crossZ: cookieCfg.crossZ, tMin: cookieCfg.tMin, tMax: cookieCfg.tMax,
      aMin: cookieCfg.aMin, aMax: cookieCfg.aMax, softness: cookieCfg.softness, barAlong: cookieCfg.barAlong,
      barAcross: cookieCfg.barAcross, barSoftness: cookieCfg.barSoftness,
    };
    cookieTex = applyWindowCookie(key, level.deskTop, o, cookieTex);
  };
  refreshCookie();

  // ------------------------------------------------------------------ hemisphere fill and page back-light
  const hemi = new HemisphereLight('#dce7f6', '#c9ad8a', 0.35);
  hemi.position.set(0, 1, 0);
  hemi.layers.enableAll();
  scene.add(hemi);
  const hemiCfg = tunable(registry, {
    id: 'light.hemi', label: 'Sky and ground fill', kind: 'hemisphere-light', tags: ['light', 'environment'],
    describe: 'Soft fill: cool sky from above, warm bounce from below.',
    object: hemi, source: SRC,
    params: {
      sky: { value: '#dce7f6', help: 'Sky colour (sRGB)' },
      ground: { value: '#c9ad8a', help: 'Ground colour (sRGB)' },
      intensity: { value: 0.35, min: 0, max: 5, step: 0.01, help: 'Fill strength' },
    },
    onChange: on(() => applyHemi()),
  });
  const applyHemi = () => {
    hemi.color.set(hemiCfg.sky);
    hemi.groundColor.set(hemiCfg.ground);
    hemi.intensity = hemiCfg.intensity;
  };
  const backlight = tunable(registry, {
    id: 'light.page-backlight', label: 'Key light through turning pages', kind: 'light-uniform', tags: ['light', 'paper', 'book'],
    describe: 'Colour of the key light shining through a turning leaf: key colour x intensity x factor, sent to page shaders as uKeyColor.',
    source: SRC,
    params: { factor: { value: 0.22, min: 0, max: 2, step: 0.01, help: 'Fraction of the key light that reaches the page back' } },
  });

  // ------------------------------------------------------------------ spill point lights
  const spillLights: PointLight[] = [];
  for (let i = 0; i < 3; i++) {
    const p = new PointLight(0xffffff, 0, 0, 2);
    p.castShadow = false;
    p.layers.enableAll();
    scene.add(p);
    spillLights.push(p);
    registry.add({
      id: `light.spill.slot-${i}`, label: `Spill light ${i + 1}`, kind: 'point-light', tags: ['light', 'energy'], parent: 'light.spill',
      object: p, source: 'src/engine/stage/spill-lights.ts',
      describe: 'A point light that follows one of the three strongest glow sources; its colour, position and intensity are set every frame by the spill slots.',
    });
  }
  const slots = new SpillSlots(spillLights);
  const spillCfg = tunable(registry, {
    id: 'light.spill', label: 'Glow light on nearby objects', kind: 'light-slots', tags: ['light', 'energy', 'animation'],
    describe: 'Three point lights take the three strongest glow sources. Incumbents keep their slot by a score bonus; newcomers fade in and losers fade out at the slot rate.',
    source: 'src/engine/stage/spill-lights.ts',
    params: {
      gain: { value: 2600, min: 0, max: 20000, step: 10, help: 'Intensity per unit source strength (mm units, decay 2)' },
      minStrength: { value: 0.01, min: 0, max: 1, step: 0.005, help: 'Sources at or below this are ignored' },
      hysteresis: { value: 0.2, min: 0, max: 2, step: 0.01, help: 'Score bonus for a source that holds a slot' },
      rate: { value: 12, min: 0.1, max: 60, step: 0.1, unit: '1/s', help: 'Fade rate of a slot weight' },
      release: { value: 0.02, min: 0, max: 0.5, step: 0.005, help: 'A fading slot frees below this weight' },
      decay: { value: 2, min: 0, max: 3, step: 0.1, help: 'Distance falloff exponent of the spill lights' },
    },
    onChange: on(() => applySpill()),
  });
  const applySpill = () => {
    slots.params = { gain: spillCfg.gain, minStrength: spillCfg.minStrength, hysteresis: spillCfg.hysteresis, rate: spillCfg.rate, release: spillCfg.release };
    for (const p of spillLights) p.decay = spillCfg.decay;
  };

  // ------------------------------------------------------------------ desk
  const oakMean = hexBytes('#c9bda7');
  const deskMat = new MeshStandardMaterial({
    map: placeholder(oakMean, true), roughnessMap: placeholder([149, 149, 149], false), normalMap: placeholder([128, 128, 255], false),
    roughness: 1, metalness: 0, normalScale: new Vector2(0.35, 0.35), envMapIntensity: 0.8,
  });
  deskMat.name = 'stage.desk.material';
  const oakCfg = tunable(registry, {
    id: 'stage.desk.oak', label: 'Oak grain texture', kind: 'procedural-texture', tags: ['texture', 'desk'], parent: 'stage.desk',
    describe: 'Seeded oak planks along world X: growth rings, latewood bands, pores, ray flecks and seams. One tile covers width x depth mm and mirrors.',
    source: 'src/engine/stage/oak.ts',
    params: {
      seed: { value: OAK_DEFAULTS.seed, min: 0, max: 100000, step: 1, help: 'Random seed of the plank layout and grain' },
      px: { value: OAK_DEFAULTS.px, min: 0.25, max: 4, step: 0.05, unit: 'px/mm', help: 'Texels per mm' },
      width: { value: OAK_DEFAULTS.width, min: 100, max: 4000, unit: 'mm', help: 'Tile length along the planks' },
      depth: { value: OAK_DEFAULTS.depth, min: 100, max: 4000, unit: 'mm', help: 'Tile depth across the planks' },
      plankMin: { value: OAK_DEFAULTS.plankMin, min: 10, max: 600, unit: 'mm', help: 'Narrowest plank' },
      plankRange: { value: OAK_DEFAULTS.plankRange, min: 0, max: 600, unit: 'mm', help: 'Random extra plank width' },
      base: { value: bytesHex(OAK_DEFAULTS.base), help: 'Base wood colour (sRGB)' },
      light: { value: bytesHex(OAK_DEFAULTS.light), help: 'Light wood colour (sRGB)' },
      dark: { value: bytesHex(OAK_DEFAULTS.dark), help: 'Latewood colour (sRGB)' },
      fleck: { value: OAK_DEFAULTS.fleck, min: 0, max: 255, help: 'Ray fleck brightness (byte)' },
      ringPhase: { value: OAK_DEFAULTS.ringPhase, min: 0, max: 1, step: 0.01, help: 'Latewood position inside a ring' },
      ringWidth: { value: OAK_DEFAULTS.ringWidth, min: 0.01, max: 1, step: 0.01, help: 'Latewood half width' },
      ringWidthVar: { value: OAK_DEFAULTS.ringWidthVar, min: 0, max: 1, step: 0.01, help: 'Noise added to the latewood width' },
      latewoodMix: { value: OAK_DEFAULTS.latewoodMix, min: 0, max: 1, step: 0.01, help: 'How dark the latewood gets' },
      porePhase: { value: OAK_DEFAULTS.porePhase, min: 0, max: 1, step: 0.01, help: 'Pore band position inside a ring' },
      poreWidth: { value: OAK_DEFAULTS.poreWidth, min: 0.01, max: 1, step: 0.01, help: 'Pore band half width' },
      poreThreshold: { value: OAK_DEFAULTS.poreThreshold, min: -1, max: 1, step: 0.01, help: 'Noise level above which pores show' },
      poreDarken: { value: OAK_DEFAULTS.poreDarken, min: 0, max: 1, step: 0.01, help: 'Pore darkening' },
      rayThreshold: { value: OAK_DEFAULTS.rayThreshold, min: -1, max: 1, step: 0.01, help: 'Noise level above which ray flecks show' },
      rayGain: { value: OAK_DEFAULTS.rayGain, min: 0, max: 20, step: 0.1, help: 'Ray fleck strength' },
      rayChance: { value: OAK_DEFAULTS.rayChance, min: 0, max: 1, step: 0.01, help: 'Share of planks with ray flecks' },
      fleckMax: { value: OAK_DEFAULTS.fleckMax, min: 0, max: 1, step: 0.01, help: 'Maximum fleck blend' },
      seamWidth: { value: OAK_DEFAULTS.seamWidth, min: 0, max: 5, step: 0.1, unit: 'mm', help: 'Dark seam width at plank edges' },
      seamDarken: { value: OAK_DEFAULTS.seamDarken, min: 0, max: 1, step: 0.01, help: 'Seam brightness factor' },
      coolShift: { value: v3(OAK_DEFAULTS.coolShift), help: 'Per-channel colour shift of cool versus warm planks (bytes)' },
    },
    onChange: on(() => scheduleOak()),
  });
  const desk = new Mesh(deskGeometry({ size: 8000, tileWidth: oakCfg.width, tileDepth: oakCfg.depth }), deskMat);
  desk.rotation.x = -Math.PI / 2;
  desk.receiveShadow = true;
  scene.add(desk);
  const deskCfg = tunable(registry, {
    id: 'stage.desk', label: 'Oak desk', kind: 'object', tags: ['object', 'desk', 'material'],
    describe: 'An 8 m oak plane under everything; receives the window shadows.',
    object: desk, source: SRC,
    params: {
      size: { value: 8000, min: 1000, max: 20000, unit: 'mm', help: 'Desk plane size' },
      color: { value: '#ffffff', help: 'Tint multiplied with the oak texture' },
      roughness: { value: 1, min: 0, max: 1, step: 0.01, help: 'Roughness multiplier on the texture' },
      metalness: { value: 0, min: 0, max: 1, step: 0.01, help: 'Metalness' },
      normalScale: { value: 0.35, min: 0, max: 3, step: 0.01, help: 'Grain relief strength' },
      envMapIntensity: { value: 0.8, min: 0, max: 3, step: 0.01, help: 'Unused while the scene environment drives reflections (stage.scene.environmentIntensity applies)' },
    },
    onChange: on((k) => {
      if (k === 'size') rebuildDeskGeometry();
      applyDeskMaterial();
    }),
  });
  const applyDeskMaterial = () => {
    deskMat.roughness = deskCfg.roughness;
    deskMat.metalness = deskCfg.metalness;
    deskMat.normalScale.setScalar(deskCfg.normalScale);
    deskMat.envMapIntensity = deskCfg.envMapIntensity;
    if (deskTex) deskMat.color.set(deskCfg.color);
  };
  const rebuildDeskGeometry = () => {
    desk.geometry.dispose();
    desk.geometry = deskGeometry({ size: deskCfg.size, tileWidth: oakCfg.width, tileDepth: oakCfg.depth });
  };

  // ------------------------------------------------------------------ pad
  const linoMat = new MeshStandardMaterial({
    map: placeholder(LINO_DEFAULTS.base, true), roughnessMap: placeholder([210, 210, 210], false), normalMap: placeholder([128, 128, 255], false),
    roughness: 1, metalness: 0, normalScale: new Vector2(0.5, 0.5), envMapIntensity: 0.7,
  });
  linoMat.name = 'stage.pad.lino-material';
  const edgeMat = new MeshStandardMaterial({ color: '#6f6a5d', roughness: 0.9, metalness: 0 });
  edgeMat.name = 'stage.pad.edge-material';
  const linoCfg = tunable(registry, {
    id: 'stage.pad.lino', label: 'Lino speckle texture', kind: 'procedural-texture', tags: ['texture', 'desk'], parent: 'stage.pad',
    describe: 'A seamless sage lino tile with soft mottling and fine light and dark speckles, repeating every `tile` mm on the pad.',
    source: 'src/engine/stage/lino.ts',
    params: {
      seed: { value: LINO_DEFAULTS.seed, min: 0, max: 100000, step: 1, help: 'Random seed' },
      tile: { value: LINO_DEFAULTS.tile, min: 8, max: 1000, unit: 'mm', help: 'Tile size on the pad' },
      size: { value: LINO_DEFAULTS.size, min: 64, max: 2048, step: 64, unit: 'px', help: 'Texture size' },
      base: { value: bytesHex(LINO_DEFAULTS.base), help: 'Base lino colour (sRGB)' },
      mottle: { value: LINO_DEFAULTS.mottle, min: 0, max: 0.5, step: 0.005, help: 'Colour modulation by the mottle noise' },
      greenLift: { value: LINO_DEFAULTS.greenLift, min: -10, max: 10, step: 0.1, help: 'Extra green per unit mottle (bytes)' },
      speckleDensity: { value: LINO_DEFAULTS.speckleDensity, min: 0, max: 0.05, step: 0.0005, help: 'Speckles per texel' },
      speckleMin: { value: LINO_DEFAULTS.speckleMin, min: 0, max: 2, step: 0.01, unit: 'mm', help: 'Smallest speckle radius' },
      speckleRange: { value: LINO_DEFAULTS.speckleRange, min: 0, max: 2, step: 0.01, unit: 'mm', help: 'Random extra speckle radius' },
      lightShare: { value: LINO_DEFAULTS.lightShare, min: 0, max: 1, step: 0.01, help: 'Share of light speckles' },
      lightValue: { value: LINO_DEFAULTS.lightValue, min: 0, max: 255, help: 'Light speckle grey (byte)' },
      darkValue: { value: LINO_DEFAULTS.darkValue, min: 0, max: 255, help: 'Dark speckle grey (byte)' },
      blendMin: { value: LINO_DEFAULTS.blendMin, min: 0, max: 1, step: 0.01, help: 'Weakest speckle blend' },
      blendRange: { value: LINO_DEFAULTS.blendRange, min: 0, max: 1, step: 0.01, help: 'Random extra speckle blend' },
      roughBase: { value: LINO_DEFAULTS.roughBase, min: 0, max: 255, help: 'Roughness byte' },
      roughGain: { value: LINO_DEFAULTS.roughGain, min: -100, max: 100, help: 'Roughness change per unit mottle' },
      normalStrength: { value: LINO_DEFAULTS.normalStrength, min: 0, max: 10, step: 0.05, help: 'Relief of the mottle in the normal map' },
    },
    onChange: on((k) => {
      if (k === 'tile') applyLinoRepeat();
      scheduleLino();
    }),
  });
  const pad = new Mesh(padGeometry(), [linoMat, edgeMat]);
  pad.castShadow = true;
  pad.receiveShadow = true;
  scene.add(pad);
  const padCfg = tunable(registry, {
    id: 'stage.pad', label: 'Lino desk pad', kind: 'object', tags: ['object', 'desk', 'material'],
    describe: 'A sage linoleum pad with rounded corners and a soft bevel; the book rests on its top surface.',
    object: pad, source: SRC,
    params: {
      width: { value: 640, min: 100, max: 3000, unit: 'mm', help: 'Pad width (x)' },
      depth: { value: 430, min: 100, max: 3000, unit: 'mm', help: 'Pad depth (z)' },
      thickness: { value: 2.5, min: 1.1, max: 30, step: 0.1, unit: 'mm', help: 'Pad thickness' },
      corner: { value: 7, min: 0, max: 100, step: 0.5, unit: 'mm', help: 'Corner radius' },
      bevel: { value: 0.5, min: 0, max: 0.5, step: 0.05, unit: 'mm', help: 'Edge bevel size' },
      centerX: { value: 0, min: -1000, max: 1000, unit: 'mm', help: 'Pad centre x' },
      centerZ: { value: 12, min: -1000, max: 1000, unit: 'mm', help: 'Pad centre z' },
      roughness: { value: 1, min: 0, max: 1, step: 0.01, help: 'Roughness multiplier on the lino texture' },
      normalScale: { value: 0.5, min: 0, max: 3, step: 0.01, help: 'Lino relief strength' },
      edgeColor: { value: '#6f6a5d', help: 'Colour of the pad edges (sRGB)' },
      edgeRoughness: { value: 0.9, min: 0, max: 1, step: 0.01, help: 'Edge roughness' },
    },
    onChange: on((k) => {
      if (k === 'width' || k === 'depth' || k === 'thickness' || k === 'corner' || k === 'bevel') rebuildPad();
      applyPadMaterial();
      placeMeshes();
    }),
  });
  const buildPadGeometry = () => padGeometry({
    width: padCfg.width, depth: padCfg.depth, thickness: padCfg.thickness, corner: padCfg.corner,
    bevel: Math.min(padCfg.bevel, padCfg.thickness / 2 - 0.05), bevelSegments: 2, curveSegments: 5,
  });
  const rebuildPad = () => {
    pad.geometry.dispose();
    pad.geometry = buildPadGeometry();
  };
  const applyPadMaterial = () => {
    linoMat.roughness = padCfg.roughness;
    linoMat.normalScale.setScalar(padCfg.normalScale);
    edgeMat.color.set(padCfg.edgeColor);
    edgeMat.roughness = padCfg.edgeRoughness;
  };
  const placeMeshes = () => {
    const base = level.deskTop - padCfg.thickness;
    desk.position.set(0, base, 0);
    pad.position.set(padCfg.centerX, base, padCfg.centerZ);
  };
  placeMeshes();

  // ------------------------------------------------------------------ textures (worker)
  let deskTex: MaterialTextures | null = null;
  let linoTex: MaterialTextures | null = null;
  let oakJob = 0, linoJob = 0;
  let disposed = false;
  const swap = (mat: MeshStandardMaterial, t: MaterialTextures, old: MaterialTextures | null) => {
    const prev = [mat.map, mat.roughnessMap, mat.normalMap];
    mat.map = t.map;
    mat.roughnessMap = t.roughness;
    mat.normalMap = t.normal;
    if (old) [old.map, old.roughness, old.normal].forEach((x) => x.dispose());
    else prev.forEach((x) => x?.dispose());
  };
  const applyLinoRepeat = () => {
    if (linoTex) for (const t of [linoTex.map, linoTex.roughness, linoTex.normal]) t.repeat.set(1 / linoCfg.tile, 1 / linoCfg.tile);
  };
  const oakOptions = (): Partial<OakOptions> => ({
    seed: oakCfg.seed, px: oakCfg.px, width: oakCfg.width, depth: oakCfg.depth, plankMin: oakCfg.plankMin, plankRange: oakCfg.plankRange,
    base: hexBytes(oakCfg.base), light: hexBytes(oakCfg.light), dark: hexBytes(oakCfg.dark), fleck: oakCfg.fleck,
    ringPhase: oakCfg.ringPhase, ringWidth: oakCfg.ringWidth, ringWidthVar: oakCfg.ringWidthVar, latewoodMix: oakCfg.latewoodMix,
    porePhase: oakCfg.porePhase, poreWidth: oakCfg.poreWidth, poreThreshold: oakCfg.poreThreshold, poreDarken: oakCfg.poreDarken,
    rayThreshold: oakCfg.rayThreshold, rayGain: oakCfg.rayGain, rayChance: oakCfg.rayChance, fleckMax: oakCfg.fleckMax,
    seamWidth: oakCfg.seamWidth, seamDarken: oakCfg.seamDarken, coolShift: v3(oakCfg.coolShift),
  });
  const linoOptions = (): Partial<LinoOptions> => ({
    seed: linoCfg.seed, tile: linoCfg.tile, size: linoCfg.size, base: hexBytes(linoCfg.base), mottle: linoCfg.mottle, greenLift: linoCfg.greenLift,
    speckleDensity: linoCfg.speckleDensity, speckleMin: linoCfg.speckleMin, speckleRange: linoCfg.speckleRange, lightShare: linoCfg.lightShare,
    lightValue: linoCfg.lightValue, darkValue: linoCfg.darkValue, blendMin: linoCfg.blendMin, blendRange: linoCfg.blendRange,
    roughBase: linoCfg.roughBase, roughGain: linoCfg.roughGain, normalStrength: linoCfg.normalStrength,
  });
  const loadOak = (): Promise<void> => {
    const job = ++oakJob;
    return generate('oak', oakOptions()).then((b: TextureBuffers) => {
      if (disposed || job !== oakJob) return;
      const t = toTextures(b, OAK_WRAP, anisotropy, 'stage.desk.oak');
      swap(deskMat, t, deskTex);
      deskTex = t;
      rebuildDeskGeometry();
      deskMat.color.set(deskCfg.color);
    });
  };
  const loadLino = (): Promise<void> => {
    const job = ++linoJob;
    return generate('lino', linoOptions()).then((b: TextureBuffers) => {
      if (disposed || job !== linoJob) return;
      const t = toTextures(b, LINO_WRAP, anisotropy, 'stage.pad.lino');
      swap(linoMat, t, linoTex);
      linoTex = t;
      applyLinoRepeat();
    });
  };
  let oakTimer: ReturnType<typeof setTimeout> | undefined, linoTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleOak = () => {
    clearTimeout(oakTimer);
    oakTimer = setTimeout(() => void loadOak(), 120);
  };
  const scheduleLino = () => {
    clearTimeout(linoTimer);
    linoTimer = setTimeout(() => void loadLino(), 60);
  };
  wired = true;
  applyScene();
  applyHemi();
  applySpill();
  applyKey();
  applyShadow();
  applyDeskMaterial();
  rebuildDeskGeometry();
  rebuildPad();
  applyPadMaterial();
  placeMeshes();
  const ready = opts.placeholdersOnly ? Promise.resolve() : Promise.all([loadOak(), loadLino()]).then(() => undefined);

  // ------------------------------------------------------------------ per frame
  const tmpDir = new Vector3();
  const stage: Stage = {
    key, hemi, spillLights, desk, pad,
    get deskTop() {
      return level.deskTop;
    },
    ready,
    get keyShadowBase() {
      return shadowCfg.intensity;
    },
    get environment() {
      return envTarget?.texture ?? null;
    },
    setShadowMapSize,
    update(camera: PerspectiveCamera) {
      if (envDirty) rebuildEnvironment();
      if (cookieDirty) refreshCookie();
      tmpDir.subVectors(key.position, key.target.position).normalize().transformDirection(camera.matrixWorldInverse);
      uniforms.uKeyDir.value.copy(tmpDir);
      uniforms.uKeyColor.value.copy(key.color).multiplyScalar(key.intensity * backlight.factor);
    },
    updateSpill(sources: readonly GlowSource[], dt: number) {
      slots.update(sources, dt);
    },
    dispose() {
      disposed = true;
      clearTimeout(oakTimer);
      clearTimeout(linoTimer);
      envTarget?.dispose();
      cookieTex?.dispose();
      for (const m of [deskMat, linoMat]) [m.map, m.roughnessMap, m.normalMap].forEach((t) => t?.dispose());
      deskMat.dispose();
      linoMat.dispose();
      edgeMat.dispose();
      desk.geometry.dispose();
      pad.geometry.dispose();
      scene.remove(key, key.target, hemi, desk, pad, ...spillLights);
      key.shadow.dispose();
    },
  };
  return stage;
}
