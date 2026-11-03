'use strict';
// The examples double as regression tests: the published numbers of the
// teaching-board study must come out of the shipped code.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const path = require('path');
const { summary, countLeaks } = require('../bin/canarytrace');

test('gradebook: no leak; the canary oracle kills every mutant, the guard two', () => {
  const r = require('../examples/gradebook/campaign').run(['300', '7']);
  assert.equal(r.fuzz.leaks, 0);
  assert.equal(r.fuzz.missingPositive, 0);
  assert.deepEqual(r.mutation.score.canary, { killed: 5, total: 5 });
  assert.deepEqual(r.mutation.score.guard, { killed: 2, total: 5 });
});

test('teaching board: both channels clean; leakCheck 1 of 9, canary 8 of 9', async () => {
  const r = await require('../examples/teaching-board/campaign').run(['300', '5000', '20261102']);
  assert.equal(r.learner.leaks, 0);
  assert.equal(r.learner.missingPositive, 0);
  assert.equal(r.analytics.leaks, 0);
  assert.ok(r.analytics.byClass.codeUnderSafe.stored > 0, 'the accepted residual channel is exercised');
  assert.deepEqual(r.mutation.score.leakCheck, { killed: 1, total: 9 });
  assert.deepEqual(r.mutation.score.canary, { killed: 8, total: 9 });
  assert.deepEqual(r.mutation.mutants.M9_top_level_filter_removed.killedBy, []); // equivalent mutant
});

test('CLI: run prints a report and exits 0 when clean; summary renders it', () => {
  const bin = path.join(__dirname, '..', 'bin', 'canarytrace.js');
  const out = execFileSync(process.execPath, [bin, 'run', path.join(__dirname, '..', 'examples', 'gradebook', 'campaign.js'), '50'], { encoding: 'utf8' });
  const report = JSON.parse(out);
  assert.equal(countLeaks(report), 0);
  assert.match(summary(report), /canary\s+killed 5 of 5/);
});

test('CLI: exits 1 when the report has leaks, 2 on bad usage', () => {
  const bin = path.join(__dirname, '..', 'bin', 'canarytrace.js');
  const leaky = path.join(__dirname, 'fixtures', 'leaky-campaign.js');
  assert.throws(() => execFileSync(process.execPath, [bin, 'run', leaky], { stdio: 'pipe' }), (e) => e.status === 1);
  assert.throws(() => execFileSync(process.execPath, [bin], { stdio: 'pipe' }), (e) => e.status === 2);
});
