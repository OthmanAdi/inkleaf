export interface StudyLesson {
  n: number;
  id: string;
  title: string;
  misconception: string;
  discussion: string;
  curriculum: string;
  sources: readonly number[];
}

export interface StudyQuestion {
  lesson: number;
  question: string;
  options: readonly string[];
  answer: number;
  explanation: string;
}

export interface GlossaryTerm {
  term: string;
  definition: string;
  lessons: readonly number[];
}

export interface StudySource {
  n: number;
  title: string;
  publisher: string;
  url: string;
}

// Curated from the original Where Energy Goes teacher and source records.
export const studyLessons: readonly StudyLesson[] = [
  { n: 1, id: 'keeping-count', title: 'Keeping count', misconception: 'Energy gets used up or disappears when something stops moving or cools down.', discussion: 'A phone battery goes flat overnight. Where has its energy gone, and could you ever collect it back?', curriculum: 'AQA 8463 4.1.1.1 and 4.1.2.1; Cambridge 0625 1.7.1. Cambridge lists seven stores and leaves out magnetic, so mention that difference to IGCSE classes.', sources: [1, 2, 3, 4, 23, 24] },
  { n: 2, id: 'the-swing', title: 'The swing', misconception: 'A heavier bob swings faster. From the same release height, mass cancels from the speed calculation, although a heavier bob holds more energy.', discussion: 'Swap in a 0.40 kg bob released from the same height. What changes in the jars, and what stays the same?', curriculum: 'AQA 8463 4.1.1.2; Cambridge 0625 1.7.1 supplement 4 and 5.', sources: [1, 2, 5, 6] },
  { n: 3, id: 'the-catapult', title: 'The catapult', misconception: 'Doubling the stretch doubles the stored energy. Because extension is squared, it quadruples.', discussion: 'The model says the pom-pom reaches 1.3 m. A real pom-pom would fall far short. Which stores did the model leave out?', curriculum: 'AQA 8463 4.1.1.2 and 4.5.3; Cambridge 0625 1.7.1 core 1 and 2. The formula is not required by Cambridge.', sources: [1, 5, 6, 7] },
  { n: 4, id: 'drop-and-bounce', title: 'Drop and bounce', misconception: 'Energy is destroyed in a bounce, or the ball simply runs out of bounce.', discussion: 'Energy is conserved on both surfaces, so why does the ball bounce lower on carpet than on wood?', curriculum: 'AQA 8463 4.1.2.1; Cambridge 0625 1.7.1 core 2 and 3.', sources: [1, 2, 6] },
  { n: 5, id: 'warming-up', title: 'Warming up', misconception: 'Heat and temperature are the same thing, so equal energy must give an equal temperature rise.', discussion: 'Why is a hot-water bottle filled with water rather than the same mass of sand?', curriculum: 'AQA 8463 4.1.1.3 and 4.1.2.1; Cambridge 0625 2.2.2.', sources: [1, 2, 9, 10, 12, 13] },
  { n: 6, id: 'lifting-power', title: 'Lifting power', misconception: 'A more powerful machine transfers more energy for the same job. It transfers the same energy in less time.', discussion: 'Two students climb the same stairs, one running and one walking. Who does more work, and who has more power?', curriculum: 'AQA 8463 4.1.1.4; Cambridge 0625 1.7.2 and 1.7.4.', sources: [1, 2, 4, 6, 9] },
  { n: 7, id: 'where-it-goes', title: 'Where it goes', misconception: 'Wasted energy is destroyed, or an efficient lamp is one that produces no heat at all.', discussion: 'In a cold room in winter, is the waste from a filament lamp really wasted? When would it matter most?', curriculum: 'AQA 8463 4.1.2.2 and 4.2.4.2; Cambridge 0625 1.7.1 supplement 6 and 1.7.3 core 3.', sources: [1, 2, 8, 16, 17, 18, 19] },
  { n: 8, id: 'wind-to-kettle', title: 'From wind to kettle', misconception: 'A higher voltage sends more energy or makes electricity travel faster; a stronger wind does not always mean more electricity.', discussion: 'On a calm winter evening, millions of kettles go on at once. Where does the grid find the extra power?', curriculum: 'AQA 8463 4.2.4.1 and 4.2.4.3; Cambridge 0625 4.5.6 and 1.7.3.', sources: [1, 2, 10, 11, 14, 15, 20, 21] },
];

export const studyQuestions: readonly StudyQuestion[] = [
  { lesson: 1, question: 'Which object is the clearest example of a gravitational store?', options: ['A wound-up toy car', 'A kettlebell on a high shelf', 'A mug of hot cocoa'], answer: 1, explanation: 'Its height above the floor gives it a gravitational store. The toy car shows an elastic store and the cocoa a thermal one.' },
  { lesson: 2, question: 'A 0.20 kg bob is released from 0.10 m with no drag. How fast is it moving at the bottom?', options: ['0.98 m/s', '1.96 m/s', '1.4 m/s'], answer: 2, explanation: 'Its 0.196 J gravitational store becomes kinetic, so v = √(2 × 0.196 / 0.20) = 1.4 m/s.' },
  { lesson: 3, question: 'A band with k = 40 N/m is stretched by 0.05 m. How much energy does it store?', options: ['0.05 J', '1.0 J', '2.0 J'], answer: 0, explanation: 'Eₑ = ½ × 40 × 0.05² = 0.05 J. Forgetting to square the extension gives 1.0 J.' },
  { lesson: 4, question: 'A ball dropped from 1.00 m onto carpet keeps 0.40 of its energy at each bounce. How high is the second bounce?', options: ['0.40 m', '0.60 m', '0.16 m'], answer: 2, explanation: 'Height follows energy, so the second peak is 1.00 × 0.40 × 0.40 = 0.16 m.' },
  { lesson: 5, question: 'How much energy warms 2.0 kg of water by 10 °C? Use c = 4200 J/(kg °C).', options: ['84 000 J', '42 000 J', '8400 J'], answer: 0, explanation: 'ΔE = mcΔθ = 2.0 × 4200 × 10 = 84 000 J.' },
  { lesson: 6, question: 'A motor lifts a 2.0 kg crate through 0.50 m in 2.0 s. What is its useful power output?', options: ['9.8 W', '4.9 W', '19.6 W'], answer: 1, explanation: 'The crate gains 9.8 J. Dividing by 2.0 s gives 4.9 W.' },
  { lesson: 7, question: 'A lamp takes in 20 J and gives out 8 J as light. What is its efficiency?', options: ['8%', '60%', '40%'], answer: 2, explanation: 'Efficiency = useful output / total input = 8 / 20 = 0.40, or 40%. The other 12 J warms the room.' },
  { lesson: 8, question: 'A 2000 W kettle runs on 230 V mains. What current does it draw?', options: ['8.7 A', '0.115 A', '460 000 A'], answer: 0, explanation: 'I = P / V = 2000 / 230 ≈ 8.7 A. At 400 000 V, the same power needs about 0.005 A.' },
];

export const glossary: readonly GlossaryTerm[] = [
  { term: 'bob', definition: 'The weight on the end of a pendulum.', lessons: [2] },
  { term: 'chemical store', definition: 'Energy held in fuels, food and batteries, released by reactions such as burning.', lessons: [1, 6] },
  { term: 'closed system', definition: 'Objects with no energy entering or leaving, so the total energy stays fixed.', lessons: [1] },
  { term: 'conservation of energy', definition: 'Energy cannot be created or destroyed, only transferred, stored or dissipated.', lessons: [1, 2, 4] },
  { term: 'current', definition: 'The rate of flow of electric charge, measured in amperes (A).', lessons: [8] },
  { term: 'dissipation', definition: 'Energy spreading out into the surroundings, usually by heating, where it is less useful.', lessons: [4, 7] },
  { term: 'drag', definition: 'A force from air or water that opposes motion and warms the air or water.', lessons: [2] },
  { term: 'efficiency', definition: 'The fraction of total input energy that is transferred usefully.', lessons: [7] },
  { term: 'elastic store', definition: 'Energy held in an object that is stretched, squashed or twisted.', lessons: [1, 3] },
  { term: 'electrical pathway', definition: 'Energy transferred by an electric current, also called electrical work.', lessons: [6, 7, 8] },
  { term: 'extension', definition: 'How much longer a spring or band gets when stretched, written e and measured in metres.', lessons: [3] },
  { term: 'gravitational field strength', definition: 'The force of gravity on each kilogram, written g and about 9.8 N/kg near Earth’s surface.', lessons: [2, 3, 4, 6] },
  { term: 'gravitational store', definition: 'Energy an object has because of its height in a gravitational field.', lessons: [1, 2, 3, 4, 6] },
  { term: 'heating', definition: 'The pathway that transfers energy from a hotter object to a cooler one.', lessons: [1, 4, 5, 7, 8] },
  { term: 'Hooke’s law', definition: 'Force is proportional to extension, F = ke, up to the limit of proportionality.', lessons: [3] },
  { term: 'joule', definition: 'The SI unit of energy and work. One joule equals one newton metre.', lessons: [1, 2, 3, 4, 5, 6, 7, 8] },
  { term: 'kinetic store', definition: 'Energy an object has because it is moving; faster or heavier means more.', lessons: [1, 2, 3, 4, 8] },
  { term: 'mechanical pathway', definition: 'Energy transferred when a force moves an object, also called mechanical work.', lessons: [2, 3, 4, 6, 8] },
  { term: 'power', definition: 'The rate of energy transfer: energy transferred divided by the time taken.', lessons: [5, 6, 7, 8] },
  { term: 'radiation', definition: 'The pathway that transfers energy as waves such as light and infrared, even across empty space.', lessons: [7] },
  { term: 'specific heat capacity', definition: 'The energy needed to raise the temperature of 1 kg of a material by 1 °C.', lessons: [5, 8] },
  { term: 'spring constant', definition: 'How stiff a spring or band is, written k and measured in newtons per metre.', lessons: [3] },
  { term: 'surroundings', definition: 'Everything outside the system being studied, such as the air and the floor.', lessons: [1, 4, 5, 7] },
  { term: 'thermal store', definition: 'Energy held by the moving particles of an object; the hotter it is, the more it holds.', lessons: [1, 2, 4, 5, 7, 8] },
  { term: 'transformer', definition: 'A device that changes the voltage of an alternating-current supply.', lessons: [8] },
  { term: 'watt', definition: 'The unit of power, equal to one joule per second.', lessons: [5, 6, 7, 8] },
  { term: 'work done', definition: 'Energy transferred when a force moves an object through a distance.', lessons: [3, 6] },
];

export const sources: readonly StudySource[] = [
  { n: 1, title: 'GCSE Physics (8463) specification, version 1.1', publisher: 'AQA', url: 'https://filestore.aqa.org.uk/resources/physics/specifications/AQA-8463-SP-2016.PDF' },
  { n: 2, title: 'Cambridge IGCSE Physics 0625 syllabus for examination in 2026, 2027 and 2028', publisher: 'Cambridge International', url: 'https://www.cambridgeinternational.org/Images/697209-2026-2028-syllabus.pdf' },
  { n: 3, title: 'Types of energy store: Changes in energy stores', publisher: 'BBC Bitesize', url: 'https://www.bbc.co.uk/bitesize/guides/z8hsrwx/revision/1' },
  { n: 4, title: 'The International System of Units (SI), 9th edition', publisher: 'BIPM', url: 'https://www.bipm.org/documents/20126/41483022/SI-Brochure-9-EN.pdf' },
  { n: 5, title: 'College Physics 2e: Kinetic Energy and the Work-Energy Theorem', publisher: 'OpenStax', url: 'https://openstax.org/books/college-physics-2e/pages/7-2-kinetic-energy-and-the-work-energy-theorem' },
  { n: 6, title: 'College Physics 2e: Gravitational Potential Energy', publisher: 'OpenStax', url: 'https://openstax.org/books/college-physics-2e/pages/7-3-gravitational-potential-energy' },
  { n: 7, title: 'College Physics 2e: Conservative Forces and Potential Energy', publisher: 'OpenStax', url: 'https://openstax.org/books/college-physics-2e/pages/7-4-conservative-forces-and-potential-energy' },
  { n: 8, title: 'College Physics 2e: Conservation of Energy', publisher: 'OpenStax', url: 'https://openstax.org/books/college-physics-2e/pages/7-6-conservation-of-energy' },
  { n: 9, title: 'College Physics 2e: Power', publisher: 'OpenStax', url: 'https://openstax.org/books/college-physics-2e/pages/7-7-power' },
  { n: 10, title: 'College Physics 2e: Temperature Change and Heat Capacity', publisher: 'OpenStax', url: 'https://openstax.org/books/college-physics-2e/pages/14-2-temperature-change-and-heat-capacity' },
  { n: 11, title: 'College Physics 2e: Transformers', publisher: 'OpenStax', url: 'https://openstax.org/books/college-physics-2e/pages/23-7-transformers' },
  { n: 12, title: 'Metals: Specific Heats', publisher: 'The Engineering ToolBox', url: 'https://www.engineeringtoolbox.com/specific-heat-metals-d_152.html' },
  { n: 13, title: 'Water: Specific Heat Capacity', publisher: 'The Engineering ToolBox', url: 'https://www.engineeringtoolbox.com/specific-heat-capacity-water-d_660.html' },
  { n: 14, title: 'What is a transformer?', publisher: 'BBC Bitesize', url: 'https://www.bbc.co.uk/bitesize/articles/z2yjywx' },
  { n: 15, title: 'The National Grid and mains electricity', publisher: 'BBC Bitesize', url: 'https://www.bbc.co.uk/bitesize/guides/zcfm8mn/revision/1' },
  { n: 16, title: 'Incandescent light bulb', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Incandescent_light_bulb' },
  { n: 17, title: 'Thermal Management of White LEDs', publisher: 'U.S. Department of Energy', url: 'https://www1.eere.energy.gov/buildings/publications/pdfs/ssl/thermal_led_feb07_2.pdf' },
  { n: 18, title: 'LED Lighting Efficacy: Status and Directions', publisher: 'U.S. Department of Energy, via OSTI.gov', url: 'https://www.osti.gov/servlets/purl/1421610' },
  { n: 19, title: 'Energy Efficiency of LEDs', publisher: 'U.S. Department of Energy', url: 'https://www1.eere.energy.gov/buildings/publications/pdfs/ssl/led_energy_efficiency.pdf' },
  { n: 20, title: 'Explore a Wind Turbine: Text Version', publisher: 'U.S. Department of Energy', url: 'https://www.energy.gov/cmei/systems/explore-wind-turbine-text-version' },
  { n: 21, title: 'How much electricity is lost in transmission and distribution?', publisher: 'U.S. Energy Information Administration', url: 'https://www.eia.gov/tools/faqs/faq.php?id=105&t=3' },
  { n: 23, title: 'Uranium: More energy, fewer emissions', publisher: 'International Atomic Energy Agency', url: 'https://www.iaea.org/sites/default/files/uranium_more-energy-fewer-emissions.pdf' },
  { n: 24, title: 'Sun: Facts', publisher: 'NASA Science', url: 'https://science.nasa.gov/sun/facts/' },
];
