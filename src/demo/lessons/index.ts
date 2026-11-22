import type { InteractiveLesson, LessonSample } from '../lesson-contract';

const g = 9.8; // N/kg, numerically equal to free-fall acceleration in m/s².
const clamp = (value: number, max = 1): number => Math.min(max, Math.max(0, Number.isFinite(value) ? value : 0));
const progress = (seconds: number, duration: number): number => clamp(seconds, duration) / duration;
const choice = (setting: number, count: number): number => Math.floor(clamp(setting, count - 1));
const reading = (label: string, value: number, unit: string, digits = 2) => {
  const [integer, decimal] = value.toFixed(digits).split('.');
  const grouped = integer!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const number = `${integer!.length >= 5 ? grouped : integer}${decimal === undefined ? '' : `.${decimal}`}`;
  return { label, value: `${number} ${unit}` };
};

/**
 * Figure channels (all 0…1):
 * stores: object index/7, cocoa transfer progress, jar illumination.
 * catapult: height/1.5 m, band extension/0.08 m, kinetic/initial energy.
 * bounce: height/1 m, dissipated/initial energy, impact pulse.
 * heating: water rise/40 °C, aluminium rise/40 °C, heater state.
 * lifting: slow height/0.5 m, fast height/0.5 m, selected motor (fast=1).
 * lamps: filament light fraction, LED light fraction, LED input/20 W.
 * grid: rotor turn, water rise/80 °C, powered state.
 * Samples depend only on elapsed playback seconds and the selected option.
 */

const objects = [
  ['Rolling skateboard', 'kinetic', 'Moving objects hold a kinetic store. Faster motion means more energy.'],
  ['Kettlebell on a shelf', 'gravitational', 'Raising an object fills its gravitational store.'],
  ['Wound-up toy car', 'elastic', 'The twisted spring holds an elastic store.'],
  ['Hot cocoa', 'thermal', 'The cocoa cools as energy transfers by heating to the desk and air.'],
  ['Match', 'chemical', 'The match head holds a chemical store, released when it burns.'],
  ['Separated magnets', 'magnetic', 'Pulling attracting magnets apart fills a magnetic store.'],
  ['Rubbed comb', 'electrostatic', 'Rubbing separates charge between the comb and jumper.'],
  ['Uranium fuel pellet', 'nuclear', 'The nuclei hold a nuclear store, released by fission.'],
] as const;

const stores: InteractiveLesson = {
  id: 'keeping-count', kind: 'stores', title: 'Keeping count',
  description: 'Eight objects, eight ways to hold energy. Select an object and light its store.',
  prediction: {
    question: 'A hot mug of cocoa cools on the desk. Where does its energy go?',
    options: ['It is used up and vanishes', 'It warms the desk and the air', "It turns into the cocoa’s chemical store"], correct: 1,
    explanation: 'Energy is never used up. The thermal store of the cocoa falls while the thermal stores of the desk and air rise by the same amount.',
  },
  term: { label: 'energy store', definition: 'A way an object or system holds energy, like thermal.' },
  settings: { label: 'Object to investigate', options: objects.map(object => object[0]) },
  action: 'Light this store', duration: 6,
  sample(seconds, setting): LessonSample {
    const selected = choice(setting, objects.length);
    const object = objects[selected]!;
    const p = progress(seconds, 6);
    return {
      pose: { primary: selected / 7, secondary: selected === 3 ? p : 0, highlight: p },
      readings: [{ label: 'Object', value: object[0] }, { label: 'Main store', value: object[1] }, { label: 'Energy rule', value: 'total before = total after' }],
      note: `${object[2]} Real objects hold several stores at once. The jar light identifies a store; it does not measure joules.`,
    };
  },
};

/** Ideal vertical launch; energy from the band becomes kinetic instantaneously. */
export function catapultState(fraction: number, extensionM: number) {
  const initialJ = 0.5 * 40 * extensionM ** 2;
  const launchSpeed = Math.sqrt(2 * initialJ / 0.01);
  const flightSeconds = clamp(fraction) * launchSpeed / g;
  const speed = Math.max(0, launchSpeed - g * flightSeconds);
  const heightM = launchSpeed * flightSeconds - 0.5 * g * flightSeconds ** 2;
  return { initialJ, speed, heightM, kineticJ: 0.5 * 0.01 * speed ** 2, gravitationalJ: 0.01 * g * heightM, flightSeconds };
}

const catapult: InteractiveLesson = {
  id: 'the-catapult', kind: 'catapult', title: 'The catapult',
  description: 'Stretch a band, then launch a 0.010 kg pom-pom. What does doubling the stretch do?',
  prediction: {
    question: 'Double the stretch from 0.04 m to 0.08 m. What happens to the elastic store?',
    options: ['It doubles', 'It stays the same', 'It becomes four times bigger'], correct: 2,
    explanation: 'Extension is squared in E = ½ke². The band stores 0.032 J at 0.04 m and 0.128 J at 0.08 m, so the ideal launch height also quadruples.',
  },
  term: { label: 'spring constant', definition: 'How stiff a spring or band is, in newtons per metre.' },
  settings: { label: 'Band extension · k = 40 N/m', options: ['0.04 m', '0.08 m'] },
  action: 'Release the band', duration: 3,
  sample(seconds, setting) {
    const extension = choice(setting, 2) === 0 ? 0.04 : 0.08;
    const p = progress(seconds, 3);
    const s = catapultState(p, extension);
    return {
      pose: { primary: clamp(s.heightM / 1.5), secondary: extension / 0.08 * Math.max(0, 1 - p * 10), highlight: clamp(s.kineticJ / s.initialJ) },
      readings: [reading('Band energy at release', s.initialJ, 'J', 3), reading('Height above launch', s.heightM, 'm', 3), reading('Kinetic store', s.kineticJ, 'J', 3), reading('Gravitational store', s.gravitationalJ, 'J', 3)],
      note: 'E = ½ke². Slow-motion ascent ends at the highest point. Ideal instantaneous release, no arm energy or air drag. A real pom-pom rises less high.',
    };
  },
};

/** Analytic ballistic flights avoid frame-rate-dependent impact integration. */
export function bounceState(seconds: number, kept: number) {
  const initialJ = 0.05 * g;
  const dropTime = Math.sqrt(2 / g);
  let time = clamp(seconds, 8);
  if (time < dropTime) {
    const heightM = 1 - 0.5 * g * time ** 2;
    return { heightM, gravitationalJ: initialJ * heightM, kineticJ: initialJ * (1 - heightM), dissipatedJ: 0, impacts: 0, impact: 0 };
  }
  time -= dropTime;
  let peak = kept;
  let impacts = 1;
  while (peak >= 0.01) {
    const velocity = Math.sqrt(2 * g * peak);
    const flightDuration = 2 * velocity / g;
    if (time < flightDuration) {
      const heightM = Math.max(0, velocity * time - 0.5 * g * time ** 2);
      const remainingJ = initialJ * peak;
      const gravitationalJ = initialJ * heightM;
      return { heightM, gravitationalJ, kineticJ: Math.max(0, remainingJ - gravitationalJ), dissipatedJ: initialJ - remainingJ, impacts, impact: Math.max(0, 1 - time / 0.08) };
    }
    time -= flightDuration;
    peak *= kept;
    impacts++;
  }
  // Once the next peak is under 1 cm, its small remaining energy warms the surroundings.
  return { heightM: 0, gravitationalJ: 0, kineticJ: 0, dissipatedJ: initialJ, impacts, impact: 0 };
}

const bounce: InteractiveLesson = {
  id: 'drop-and-bounce', kind: 'bounce', title: 'Drop and bounce',
  description: 'Drop a 0.050 kg ball from 1.00 m. Follow the energy through every bounce.',
  prediction: {
    question: 'On wood the ball rises to only 75% of its drop height. Where did the rest of the energy go?',
    options: ['It warms the ball, floor and air', 'It is destroyed in the impact', 'It is saved for the next bounce'], correct: 0,
    explanation: 'At each impact energy enters the thermal stores of the ball, floor and air. Sound also carries energy away and soon warms the air. Carpet dissipates more per impact.',
  },
  term: { label: 'dissipation', definition: 'Energy spreading out into the surroundings, where it is less useful.' },
  settings: { label: 'Landing surface', options: ['Wood · keeps 75%', 'Carpet · keeps 40%'] },
  action: 'Drop the ball', duration: 8,
  sample(seconds, setting) {
    const s = bounceState(seconds, choice(setting, 2) === 0 ? 0.75 : 0.4);
    return {
      pose: { primary: clamp(s.heightM), secondary: clamp(s.dissipatedJ / 0.49), highlight: s.impact },
      readings: [reading('Height', s.heightM, 'm'), reading('Gravitational store', s.gravitationalJ, 'J', 3), reading('Kinetic store', s.kineticJ, 'J', 3), reading('Dissipated to surroundings', s.dissipatedJ, 'J', 3)],
      note: 'Total energy stays 0.490 J. Each impact keeps a fixed teaching fraction; flights ignore air drag. Below a 1 cm next peak the ball settles and the remaining energy dissipates.',
    };
  },
};

export function heatingState(fraction: number, lidOn: boolean) {
  const simulatedSeconds = clamp(fraction) * 600;
  const inputJ = 50 * simulatedSeconds; // 50 W = 50 J/s, for EACH heater.
  const retainedJ = inputJ * (lidOn ? 0.98 : 0.8);
  return { simulatedSeconds, inputJ, retainedJ, lossJ: inputJ - retainedJ, waterC: 20 + retainedJ / 4200, aluminiumC: 20 + retainedJ / 900 };
}

const heating: InteractiveLesson = {
  id: 'warming-up', kind: 'heating', title: 'Warming up',
  description: 'Two 50 W heaters warm equal 1.0 kg masses of water and aluminium.',
  prediction: {
    question: 'Same 50 W heater, same 1.0 kg, same 10 minutes. Which thermometer rises more?',
    options: ['The water', 'The aluminium block', 'Both rise by the same amount'], correct: 1,
    explanation: 'Aluminium needs 900 J/(kg °C), water needs 4200 J/(kg °C). With the same energy retained, aluminium has the larger temperature rise. Insulation reduces energy lost to the room.',
  },
  term: { label: 'specific heat capacity', definition: 'Energy needed to warm 1 kg of a material by 1 °C.' },
  settings: { label: 'Insulation on both heaters', options: ['Lid off · 20% loss', 'Lid on · 2% loss'] },
  action: 'Switch on both heaters', duration: 12,
  sample(seconds, setting) {
    const s = heatingState(progress(seconds, 12), choice(setting, 2) === 1);
    return {
      pose: { primary: clamp((s.waterC - 20) / 40), secondary: clamp((s.aluminiumC - 20) / 40), highlight: seconds > 0 && seconds < 12 ? 1 : 0 },
      readings: [reading('Simulated time', s.simulatedSeconds, 's', 0), reading('Water', s.waterC, '°C', 1), reading('Aluminium', s.aluminiumC, '°C', 1), reading('Retained by each material', s.retainedJ, 'J', 0), reading('Room gain from each heater', s.lossJ, 'J', 0)],
      note: 'ΔE = mcΔθ. Playback runs at 50× time. Each heater supplies 50 J/s. Fixed loss fractions are teaching values; beakers and heaters do not warm in this model. Lid-on still loses 2%.',
    };
  },
};

const lifting: InteractiveLesson = {
  id: 'lifting-power', kind: 'lifting', title: 'Lifting power',
  description: 'Two winches each raise a 2.0 kg crate through 0.50 m. Compare their energy and power.',
  prediction: {
    question: 'The slow motor lifts the crate in 4 s, the fast one in 1 s. Which gives the crate more energy?',
    options: ['The fast motor', 'The slow motor', 'Both give the same energy'], correct: 2,
    explanation: 'Both put mgh = 2.0 × 9.8 × 0.50 = 9.8 J into the gravitational store. The fast motor transfers it four times as quickly: 9.8 W rather than 2.45 W.',
  },
  term: { label: 'power', definition: 'How fast energy is transferred; one watt is one joule per second.' },
  settings: { label: 'Inspect this motor', options: ['Slow · 4 s', 'Fast · 1 s'] },
  action: 'Start both winches', duration: 4,
  sample(seconds, setting) {
    const fast = choice(setting, 2) === 1;
    const duration = fast ? 1 : 4;
    const fraction = progress(seconds, duration);
    return {
      pose: { primary: progress(seconds, 4), secondary: progress(seconds, 1), highlight: fast ? 1 : 0 },
      readings: [reading('Selected crate height', fraction * 0.5, 'm'), reading('Energy transferred', fraction * 9.8, 'J'), reading('Power while lifting', 9.8 / duration, 'W'), reading('Selected lift time', duration, 's', 0)],
      note: `${fast ? 'Fast' : 'Slow'} motor selected. P = E/t. Both finish with 9.80 J. Ideal steady-speed winches are 100% efficient; acceleration and stopping are ignored. Power stops when each crate reaches the top.`,
    };
  },
};

const lamps: InteractiveLesson = {
  id: 'where-it-goes', kind: 'lamps', title: 'Where it goes',
  description: 'Compare a 60 W filament lamp with a dimmable LED. Match the visible light output.',
  prediction: {
    question: 'Of every 100 J a filament lamp takes in, how much leaves as light?',
    options: ['About 90 J', 'About 50 J', 'About 5 J'], correct: 2,
    explanation: 'About 5 J leaves as visible light. Most output is infrared and heating. A representative LED package turns about 40% into light, needing 7.5 W to match the filament’s 3 W of light.',
  },
  term: { label: 'efficiency', definition: 'The fraction of input energy that is usefully transferred.' },
  settings: { label: 'LED input power', options: ['7.5 W · equal light', '15 W', '20 W'] },
  action: 'Switch on the lamps', duration: 5,
  sample(seconds, setting) {
    const inputW = [7.5, 15, 20][choice(setting, 3)]!;
    const on = clamp(seconds, 5) > 0;
    const lightW = 0.4 * inputW;
    return {
      pose: { primary: on ? 0.05 : 0, secondary: on ? 0.4 : 0, highlight: on ? inputW / 20 : 0 },
      readings: [reading('Filament light / input', on ? 3 : 0, 'W / 60 W', 1), reading('Filament heating', on ? 57 : 0, 'W', 1), reading('LED visible light', on ? lightW : 0, 'W', 1), reading('LED heating', on ? inputW - lightW : 0, 'W', 1), { label: 'Light compared with filament', value: on ? `${(lightW / 3).toFixed(1)}×` : 'off' }],
      note: 'The readouts use rounded efficiencies of 5% for the filament and 40% for the LED package. A real LED driver has further losses. Equal light power approximates equal brightness. Light eventually warms the room too.',
    };
  },
};

const grid: InteractiveLesson = {
  id: 'wind-to-kettle', kind: 'grid', title: 'From wind to kettle',
  description: 'Follow moving air through a turbine, transformers and cables into a kettle.',
  prediction: {
    question: 'Why does the grid step the voltage up to 400 000 V?',
    options: ['So electricity travels faster', 'So the current is smaller', 'Because kettles need high voltage'], correct: 1,
    explanation: 'P = IV: the same power at higher voltage needs less current. Cable heating is I²R, so reducing current tenfold reduces heating a hundredfold. Homes receive 230 V after a step-down transformer.',
  },
  term: { label: 'transformer', definition: 'A device that changes the voltage of an alternating current supply.' },
  settings: { label: 'Wind speed', options: ['Calm · 2 m/s', 'Breezy · 10 m/s', 'Storm · 30 m/s'] },
  action: 'Run the wind-to-kettle model', duration: 12,
  sample(seconds, setting) {
    const wind = choice(setting, 3);
    const powered = wind === 1;
    const elapsed = progress(seconds, 12) * 168;
    const energyJ = powered ? 2000 * elapsed : 0;
    const riseC = energyJ / 4200;
    return {
      pose: { primary: powered ? (clamp(seconds, 12) * 0.4) % 1 : 0, secondary: clamp(riseC / 80), highlight: powered && seconds > 0 ? 1 : 0 },
      readings: [reading('Simulated time', elapsed, 's', 0), reading('Power to kettle', powered ? 2000 : 0, 'W', 0), reading('Water temperature', 20 + riseC, '°C', 1), reading('Transmission current · 400 000 V', powered ? 2000 / 400000 : 0, 'A', 3), reading('Home current · 230 V', powered ? 2000 / 230 : 0, 'A', 2)],
      note: `${wind === 0 ? 'Below start-up speed: blades stay still.' : wind === 2 ? 'Above cut-out speed: the controller stops the turbine for protection.' : 'Breezy supplies 2000 W; 1.0 kg water reaches 100 °C in 168 s.'} Playback runs at 14× time. Ideal transformers, cables and kettle; no boiling phase change. Other generators support a real grid when wind drops.`,
    };
  },
};

export const interactiveLessons: readonly InteractiveLesson[] = [stores, catapult, bounce, heating, lifting, lamps, grid];
