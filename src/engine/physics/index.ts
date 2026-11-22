/**
 * Physics: a fixed-step RK4 integrator that stops exactly on events, a simulation base with an energy ledger, the
 * falling object, spring launcher, bouncing ball, curved track and pendulum models, and number formatting.
 */
export { physicsConfig, registerPhysics } from './config';
export { Rk4, EventStepper, findEventRoot, crosses, splitFrame, type Derivative, type EventSpec, type EventStepResult } from './integrator';
export { Simulation, HAND, G, type SimParam, type SimValue } from './simulation';
export { Fall, DropSequence, type FallState, type FallOptions, type Vec3Like } from './fall';
export { SpringLauncher, type SpringState } from './spring';
export { Bounce, BALLS, restitution, type Ball, type BounceState } from './bounce';
export { Track, gaussLegendre5, GL5_NODES, GL5_WEIGHTS } from './track';
export { Ramp, DEFAULT_TRACK, type RampState } from './ramp';
export { Pendulum, agm, type PendulumState } from './pendulum';
export {
  roundSig, formatJoules, jarScale, sigDecimals, joules, printNumber, percent, sigFigs, minSigFigs, workedExample, numberWord,
  superscript, sciParts, MINUS, TIMES, type WorkedExample,
} from './format';
