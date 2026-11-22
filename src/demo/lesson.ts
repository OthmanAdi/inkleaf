export const lesson = {
  id: 'the-swing',
  bookTitle: 'Where Energy Goes',
  title: 'The swing',
  description: 'Lift the bob and you fill its gravitational store. Let go, and that energy moves into the kinetic store and back again.',
  prediction: {
    question: 'Release the bob from 0.10 m with air drag off. How high does it swing on the far side?',
    options: ['Higher than 0.10 m', 'Exactly 0.10 m', 'Lower than 0.10 m'],
    correct: 1,
    explanation: 'With drag off, all 0.196 J goes back into the gravitational store. The bob returns to 0.10 m. With drag on, some energy warms the air and the bob climbs back to a lower height.',
  },
  swing: {
    massKg: 0.2,
    lengthM: 0.4,
    startAngleDeg: Math.acos(1 - 0.1 / 0.4) * 180 / Math.PI,
    drag: 0.08,
  },
};
