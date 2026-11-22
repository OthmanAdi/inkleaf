/**
 * Tunable physics constants and model defaults (`physics.*`). Values live in `physicsConfig` from module load;
 * `registerPhysics(registry)` exposes them by name.
 */
import type { Def, Tuned } from '../core/tune';
import type { Registry } from '../core/registry';
import { exposeGroup, plain, type GroupDef } from '../energy/config';

const SOURCE = 'src/engine/physics/config.ts';

export const INTEGRATOR_DEFS = {
  id: 'physics.integrator',
  label: 'Simulation stepper',
  kind: 'physics',
  tags: ['physics'],
  describe: 'Fixed-step RK4 that splits each frame into equal sub-steps and stops exactly on events (impacts, peaks, turns).',
  params: {
    maxSubstep: { value: 0.001, min: 1e-5, max: 0.05, unit: 's', help: 'Longest sub-step' },
    maxFrame: { value: 0.25, min: 0.001, max: 5, unit: 's', help: 'Longest frame a simulation accepts; longer frames are cut' },
    rootIterations: { value: 80, min: 1, max: 500, step: 1, help: 'Event root finder iterations' },
    rootTolerance: { value: 1e-13, min: 0, max: 1e-3, help: 'Event root bracket width (times max(1, h))' },
  },
} satisfies GroupDef<Record<string, Def>>;

export const CONSTANTS_DEFS = {
  id: 'physics.constants',
  label: 'Physical constants',
  kind: 'data',
  tags: ['physics', 'data'],
  describe: 'Gravitational field strength, water heat capacity and reference temperatures the models use.',
  params: {
    g: { value: 9.8, min: 0, max: 30, unit: 'N/kg', help: 'Gravitational field strength' },
    cWater: { value: 4200, min: 0, max: 10000, unit: 'J/kg °C', help: 'Specific heat capacity of water' },
    room: { value: 20, min: -50, max: 60, unit: '°C', help: 'Room temperature' },
    boil: { value: 100, min: 0, max: 400, unit: '°C', help: 'Boiling point of water' },
    kelvin: { value: 273.15, min: 0, max: 300, unit: 'K', help: 'Zero Celsius in kelvin' },
    soundShare: { value: 0.01, min: 0, max: 0.2, help: 'Default share of impact energy that leaves as sound' },
  },
} satisfies GroupDef<Record<string, Def>>;

export const FALL_DEFS = {
  id: 'physics.fall',
  label: 'Falling object (defaults)',
  kind: 'physics-model',
  tags: ['physics', 'energy'],
  describe: 'An object leaves a shelf, falls freely and lands: gravitational to kinetic, then kinetic to thermal and sound.',
  params: {
    m: { value: 1, min: 0.2, max: 3, unit: 'kg', help: 'Mass' },
    h: { value: 1.5, min: 0.3, max: 2, unit: 'm', help: 'Drop height' },
    u: { value: 0, min: 0, max: 1, unit: 'm/s', help: 'Speed off the edge' },
    splits: { value: 4, min: 1, max: 20, step: 1, help: 'Event splits per sub-step' },
    slideTime: { value: 0.6, min: 0, max: 5, unit: 's', help: 'Drop sequence: slide toward the edge before falling' },
    slide: { value: 14, min: 0, max: 200, unit: 'mm', help: 'Drop sequence: slide distance in model millimetres' },
    slow: { value: 4, min: 1, max: 20, help: 'Drop sequence: slow-motion divisor' },
    afterTime: { value: 6, min: 0, max: 60, unit: 's', help: 'Drop sequence: flows stop after this many seconds' },
  },
} satisfies GroupDef<Record<string, Def>>;

export const SPRING_DEFS = {
  id: 'physics.spring',
  label: 'Spring launcher (defaults)',
  kind: 'physics-model',
  tags: ['physics', 'energy'],
  describe: 'A ball on an inclined rail is pushed by a compressed spring, flies, peaks and lands.',
  params: {
    angle: { value: 55, min: 5, max: 85, unit: 'deg', help: 'Rail angle' },
    launchX: { value: 0.22, min: -5, max: 5, unit: 'm', help: 'Launch point x' },
    launchY: { value: 0.6, min: 0, max: 5, unit: 'm', help: 'Launch point height' },
    floor: { value: 0.02, min: 0, max: 1, unit: 'm', help: 'Floor contact height' },
    bell: { value: 0.9, min: 0, max: 5, unit: 'm', help: 'Target height' },
    bellTol: { value: 0.03, min: 0, max: 1, unit: 'm', help: 'Target tolerance' },
    pushDiv: { value: 8, min: 1, max: 64, step: 1, help: 'Sub-divisions per step while the spring pushes' },
    k: { value: 100, min: 1, max: 10000, unit: 'N/m', help: 'Spring constant' },
    m: { value: 0.05, min: 0.001, max: 10, unit: 'kg', help: 'Ball mass' },
    limit: { value: 0.08, min: 0, max: 1, unit: 'm', help: 'Largest compression' },
    splits: { value: 4, min: 1, max: 20, step: 1, help: 'Event splits per sub-step' },
  },
} satisfies GroupDef<Record<string, Def>>;

export const BOUNCE_DEFS = {
  id: 'physics.bounce',
  label: 'Bouncing ball (defaults)',
  kind: 'physics-model',
  tags: ['physics', 'energy'],
  describe: 'A ball dropped onto a floor rebounds with a coefficient of restitution; each impact turns kinetic energy into heat and sound.',
  params: {
    h0: { value: 1, min: 0.2, max: 1.2, unit: 'm', help: 'Drop height' },
    minBounce: { value: 5e-4, min: 0, max: 0.1, unit: 'm', help: 'Rebounds lower than this end in rest' },
    history: { value: 40, min: 1, max: 1000, step: 1, help: 'Impacts and peaks kept' },
    splits: { value: 6, min: 1, max: 20, step: 1, help: 'Event splits per sub-step' },
    target: { value: 0.3, min: 0, max: 2, unit: 'm', help: 'Challenge: second peak height' },
    targetTol: { value: 0.02, min: 0, max: 1, unit: 'm', help: 'Challenge tolerance' },
  },
} satisfies GroupDef<Record<string, Def>>;

export const RAMP_DEFS = {
  id: 'physics.ramp',
  label: 'Ball on a curved track (defaults)',
  kind: 'physics-model',
  tags: ['physics', 'energy'],
  describe: 'A ball rolls on a smooth curved track (natural cubic spline, exact arc length); friction and drag warm the track and air.',
  params: {
    m: { value: 0.5, min: 0.1, max: 2, unit: 'kg', help: 'Ball mass' },
    friction: { value: false, help: 'Friction and drag on' },
    mu: { value: 0.05, min: 0, max: 0.3, help: 'Rolling friction coefficient' },
    drag: { value: 0.001, min: 0, max: 0.01, unit: 'kg/m', help: 'Air drag coefficient' },
    glSub: { value: 512, min: 1, max: 8192, step: 1, help: 'Gauss-Legendre sub-intervals per knot interval' },
    startHeight: { value: 1, min: 0, max: 5, unit: 'm', help: 'Start height on the left side' },
    flag: { value: 0.8, min: 0, max: 5, unit: 'm', help: 'Flag height on the right side' },
    flagTol: { value: 0.03, min: 0, max: 1, unit: 'm', help: 'Challenge tolerance' },
    splits: { value: 8, min: 1, max: 20, step: 1, help: 'Event splits per sub-step' },
  },
} satisfies GroupDef<Record<string, Def>>;

export const PENDULUM_DEFS = {
  id: 'physics.pendulum',
  label: 'Pendulum (defaults)',
  kind: 'physics-model',
  tags: ['physics', 'energy'],
  describe: 'A bob on a light rod swings; gravitational and kinetic stores trade energy, air drag slowly warms the air.',
  params: {
    L: { value: 1, min: 0.05, max: 10, unit: 'm', help: 'Length' },
    m: { value: 0.5, min: 0.01, max: 20, unit: 'kg', help: 'Bob mass' },
    theta0: { value: 0.5, min: -3, max: 3, unit: 'rad', help: 'Start angle' },
    drag: { value: 0.002, min: 0, max: 1, unit: 'kg/m', help: 'Quadratic air drag coefficient' },
    damping: { value: 0, min: 0, max: 10, unit: 'kg/s', help: 'Linear damping (pivot friction)' },
    splits: { value: 4, min: 1, max: 20, step: 1, help: 'Event splits per sub-step' },
  },
} satisfies GroupDef<Record<string, Def>>;

export const physicsConfig = {
  integrator: plain(INTEGRATOR_DEFS.params),
  constants: plain(CONSTANTS_DEFS.params),
  fall: plain(FALL_DEFS.params),
  spring: plain(SPRING_DEFS.params),
  bounce: plain(BOUNCE_DEFS.params),
  ramp: plain(RAMP_DEFS.params),
  pendulum: plain(PENDULUM_DEFS.params),
};

const GROUPS = {
  integrator: INTEGRATOR_DEFS, constants: CONSTANTS_DEFS, fall: FALL_DEFS, spring: SPRING_DEFS, bounce: BOUNCE_DEFS,
  ramp: RAMP_DEFS, pendulum: PENDULUM_DEFS,
} as const;

/** Registers `physics.integrator`, `physics.constants` and the model defaults. Safe to call more than once. */
export function registerPhysics(registry: Registry): typeof physicsConfig {
  const cfg = physicsConfig as Record<keyof typeof GROUPS, unknown>;
  for (const key of Object.keys(GROUPS) as (keyof typeof GROUPS)[]) {
    const g = GROUPS[key] as GroupDef<Record<string, Def>>;
    if (registry.has(g.id)) continue;
    cfg[key] = exposeGroup(registry, g, cfg[key] as Tuned<Record<string, Def>>, SOURCE);
  }
  return physicsConfig;
}
