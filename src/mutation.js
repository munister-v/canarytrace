'use strict';
// Source-level mutation analysis: how good is a test oracle at noticing a
// broken filter? Each mutant is one textual edit of the module under test
// (remove a check, invert a condition). The same campaign runs against the
// original and every mutant; a mutant is killed by an oracle when that oracle
// reports more failures on it than on the original. Counting relative to the
// original keeps a known issue of the original from killing every mutant.

const fs = require('fs');
const path = require('path');
const Module = require('module');

/** Replace the single occurrence of `from` with `to`; fail if not unique. */
function applyMutant(code, from, to) {
  const parts = code.split(from);
  if (parts.length !== 2) {
    throw new Error(`mutation point must occur exactly once (found ${parts.length - 1}): ${JSON.stringify(from.slice(0, 60))}`);
  }
  return parts[0] + to + parts[1];
}

/** Load a CommonJS module from source text as if it lived at `file`. */
function loadModuleFromSource(file, code) {
  const abs = path.resolve(file);
  const m = new Module(abs, module);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  m._compile(code, abs);
  return m.exports;
}

/**
 * @param {object} opts
 * @param {string} opts.file                          module under test
 * @param {Record<string, [string, string]>} opts.mutants  name -> [from, to]
 * @param {(mod) => Record<string, number>} opts.evaluate
 *        runs the campaign on a loaded module and returns failure counts per
 *        oracle, e.g. { guard: 3, canary: 120 }
 */
function runMutationAnalysis({ file, mutants, evaluate }) {
  const source = fs.readFileSync(file, 'utf8');
  const original = evaluate(loadModuleFromSource(file, source));
  const oracles = Object.keys(original);
  const results = {};
  for (const [name, [from, to]] of Object.entries(mutants)) {
    let counts;
    try {
      counts = evaluate(loadModuleFromSource(file, applyMutant(source, from, to)));
    } catch (e) {
      results[name] = { crashed: true, error: e.message, killedBy: [...oracles] };
      continue;
    }
    const killedBy = oracles.filter((o) => (counts[o] || 0) > (original[o] || 0));
    results[name] = { counts, killedBy };
  }
  const score = {};
  const total = Object.keys(mutants).length;
  for (const o of oracles) {
    const killed = Object.values(results).filter((r) => r.killedBy.includes(o)).length;
    score[o] = { killed, total };
  }
  return { original, mutants: results, score };
}

module.exports = { applyMutant, loadModuleFromSource, runMutationAnalysis };
