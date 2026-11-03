# canarytrace

Canary-oracle fuzzing and mutation analysis for code that must not pass data
on: **projections** (the part of a record one audience may see: a student's
view of a teacher's board, a patient's view of a chart) and **analytics
sinks** (telemetry and logging pipelines that must not store personal text).

Most such code is guarded by a check that looks for forbidden field names.
canarytrace tests it differently: it plants unique marker strings
(*canaries*) in every place a channel must not carry, runs the real code on
many random inputs, and searches the serialised output for them. A canary
found where it is not allowed is a leak, whatever field it rode on. Mutation
analysis then measures how many injected faults an existing guard notices
compared with the canary oracle.

## Install

```bash
npm install canarytrace        # Node.js 18 or later, no runtime dependencies
```

The PostgreSQL load example also needs `pg` (`npm install pg`).

## Quick start

```js
const { createRng, createCanaries, fuzzProjection } = require('canarytrace');

const report = fuzzProjection({
  cases: 1000,
  rng: createRng(7),                 // every run repeats from its seed
  canaries: createCanaries,
  generate: ({ rng, canaries }) => ({
    input: {
      title: canaries.plant('title', { allowedIn: ['student'] }),
      notes: canaries.plant('teacherNotes'),           // allowed nowhere
    },
    views: [{ name: 'student' }],
  }),
  project: (record, view) => ({ title: record.title }), // the code under test
  positive: ['title'],               // must appear where allowed
});
// report.leaks === 0, report.missingPositive === 0, report.byClass.teacherNotes
```

`allowedIn` is a list of view names or a predicate `(view, context) => boolean`,
so a canary can be allowed in one student's own view only, or in a presented
frame only.

## What is in the box

| Module | Purpose |
| --- | --- |
| `createRng(seed)` | Seeded generator (int, pick, chance, uuid, exp) for repeatable campaigns |
| `createCanaries()` | Plant canaries with their allowed views; `scan(text)` finds them |
| `fuzzProjection(opts)` | Canary oracle for projections, with positive controls and a guard comparison |
| `createCaptureStore()`, `fuzzSink(opts)` | Canary oracle for analytics sinks: capture what reaches storage |
| `runMutationAnalysis(opts)` | Source-level mutants; kills counted per oracle, relative to the original |
| `runLoad(opts)` | Closed-loop load emulation with latency percentiles and sampled gauges |
| `canarytrace run <campaign.js>` | CLI: runs a campaign, prints JSON, exits 1 on any leak (for CI) |
| `canarytrace summary <report.json>` | Leaks per canary class and mutation scores as text |

## Examples

* `examples/gradebook/`: a student's view of a course gradebook; a small,
  complete campaign to copy.

  ```bash
  npx canarytrace run examples/gradebook/campaign.js 2000
  ```

* `examples/teaching-board/`: the two-channel sensing layer of a deployed
  online teaching board (the learner projection and the telemetry filter
  with its coalescing pipeline), as studied in Munister (2026). The campaign
  reproduces the study's privacy results: no leak in either channel, and the
  built-in `leakCheck` guard kills 1 of 9 projection mutants against 8 of 9
  for the canary oracle (the ninth is equivalent). `load.js` repeats the
  autosave load experiment against a local PostgreSQL.

  ```bash
  npx canarytrace run examples/teaching-board/campaign.js 2000 20000
  ```

## Using it in CI

A campaign module exports `run(args)`; `canarytrace run` exits with status 1
when the report contains a leak, so a privacy regression fails the build:

```yaml
- run: npx canarytrace run test/privacy-campaign.js 500
```

## Tests

```bash
npm test
```

The suite covers the library and checks that the examples still produce the
published numbers.

## Citing

If you use canarytrace in research, please cite the software (see
`CITATION.cff`) and the study it comes from:

> Munister, V. (2026). *Default-Deny by Construction: A Two-Channel Sensing
> Layer for Behaviour Analytics on an Interactive Teaching Board* [Preprint].
> Zenodo. https://doi.org/10.5281/zenodo.23897129

## Contributing and support

Issues and pull requests are welcome; see `CONTRIBUTING.md`. Questions go to
the issue tracker.

## License

MIT, see `LICENSE`.
