'use strict';
// Canary oracle for projections: functions that take a full record (a board,
// a gradebook, a patient chart) and return the part one audience may see.
//
// The generator builds a random input and plants canaries in it, each with
// the views where it may appear. The projection runs for every view; its
// serialised output is scanned, and a canary seen outside its allowed views
// is a leak. Canaries marked as positive controls must appear where allowed,
// so an over-strict projection is caught too.

/**
 * @param {object} opts
 * @param {number} opts.cases                 number of random inputs
 * @param {(ctx) => {input, views}} opts.generate
 *        builds one input with canaries planted through ctx.canaries.plant();
 *        `views` lists the views to project it for: [{ name, args?, context? }]
 * @param {(input, view) => any} opts.project  the projection under test
 * @param {(output) => boolean} [opts.guard]   an existing runtime check to
 *        compare with the oracle; returns true when it accepts the output
 * @param {string[]} [opts.positive]           canary classes that must appear
 *        wherever they are allowed
 * @param {object} opts.rng                    from createRng()
 * @param {() => object} opts.canaries         factory, e.g. createCanaries
 */
function fuzzProjection({ cases, generate, project, guard, positive = [], rng, canaries: makeCanaries }) {
  const byClass = {};
  const leaks = [];
  let projections = 0;
  let guardRejected = 0;
  let outputsWithLeak = 0;
  let missingPositive = 0;

  for (let i = 0; i < cases; i++) {
    const canaries = makeCanaries();
    const { input, views } = generate({ rng, canaries, index: i });
    for (const view of views) {
      const output = project(input, view);
      projections++;
      if (guard && !guard(output)) guardRejected++;
      const seen = canaries.scan(JSON.stringify(output));
      let leaked = false;
      for (const [c, info] of canaries.planted) {
        const stat = (byClass[info.cls] = byClass[info.cls] || { planted: 0, leaked: 0, missing: 0 });
        stat.planted++;
        const allowed = canaries.isAllowed(c, view.name, { view, input, data: info.data });
        if (seen.has(c) && !allowed) {
          stat.leaked++;
          leaked = true;
          if (leaks.length < 20) leaks.push({ case: i, view: view.name, cls: info.cls, canary: c });
        } else if (!seen.has(c) && allowed && positive.includes(info.cls)) {
          stat.missing++;
          missingPositive++;
        }
      }
      if (leaked) outputsWithLeak++;
    }
  }
  const totalLeaks = Object.values(byClass).reduce((a, s) => a + s.leaked, 0);
  return { cases, projections, leaks: totalLeaks, outputsWithLeak, missingPositive, guardRejected, byClass, examples: leaks };
}

module.exports = { fuzzProjection };
