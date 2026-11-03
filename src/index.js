'use strict';

const { createRng } = require('./rng');
const { createCanaries } = require('./canary');
const { fuzzProjection } = require('./projection');
const { applyMutant, loadModuleFromSource, runMutationAnalysis } = require('./mutation');
const { createCaptureStore, fuzzSink } = require('./sink');
const { runLoad, percentile, summarise } = require('./load');

module.exports = {
  createRng,
  createCanaries,
  fuzzProjection,
  applyMutant,
  loadModuleFromSource,
  runMutationAnalysis,
  createCaptureStore,
  fuzzSink,
  runLoad,
  percentile,
  summarise,
};
