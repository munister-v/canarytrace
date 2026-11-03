'use strict';
const { createRng, createCanaries, fuzzProjection } = require('../../src');

exports.run = () => fuzzProjection({
  cases: 3,
  rng: createRng(1),
  canaries: createCanaries,
  generate: ({ canaries }) => ({ input: { secret: canaries.plant('secret') }, views: [{ name: 'anyone' }] }),
  project: (input) => input,
});
