'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  createRng, createCanaries, fuzzProjection, applyMutant, loadModuleFromSource,
  runMutationAnalysis, createCaptureStore, fuzzSink, runLoad, percentile,
} = require('../src');

test('rng is repeatable from its seed', () => {
  const a = createRng(42); const b = createRng(42); const c = createRng(43);
  const xs = Array.from({ length: 5 }, () => a.next());
  assert.deepEqual(xs, Array.from({ length: 5 }, () => b.next()));
  assert.notDeepEqual(xs, Array.from({ length: 5 }, () => c.next()));
  const r = createRng(1);
  for (let i = 0; i < 1000; i++) { const n = r.int(3, 5); assert.ok(n >= 3 && n <= 5); }
  assert.match(r.uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('canaries are unique, scannable and carry their allowed views', () => {
  const k = createCanaries();
  const a = k.plant('secret');
  const b = k.plant('visible', { allowedIn: ['student'] });
  const c = k.plant('own', { allowedIn: (view) => view === 's1' });
  assert.notEqual(a, b);
  assert.deepEqual(k.scan(`{"x":"${b}","y":"pre${a}post"}`), new Set([b, a]));
  assert.equal(k.isAllowed(a, 'student'), false);
  assert.equal(k.isAllowed(b, 'student'), true);
  assert.equal(k.isAllowed(c, 's1'), true);
  assert.equal(k.isAllowed(c, 's2'), false);
  assert.equal(k.isAllowed('zqunknownqz', 'student'), false);
  assert.throws(() => k.plant('bad class'));
  assert.throws(() => createCanaries({ prefix: 'Z1' }));
});

test('canaries survive lower-casing and trimming', () => {
  const k = createCanaries();
  const c = k.plant('x');
  assert.equal(k.scan(`  ${c.toLowerCase()}  `.trim()).has(c), true);
});

function generate({ canaries }) {
  return {
    input: { public: canaries.plant('public', { allowedIn: ['reader'] }), private: canaries.plant('private') },
    views: [{ name: 'reader' }],
  };
}

test('fuzzProjection finds a leak, a missing positive and compares a guard', () => {
  const opts = { cases: 10, generate, rng: createRng(1), canaries: createCanaries, positive: ['public'] };
  const good = fuzzProjection({ ...opts, project: (i) => ({ public: i.public }), guard: () => true });
  assert.equal(good.leaks, 0);
  assert.equal(good.missingPositive, 0);
  const leaky = fuzzProjection({ ...opts, project: (i) => ({ ...i }), guard: (o) => !('private' in o) });
  assert.equal(leaky.leaks, 10);
  assert.equal(leaky.byClass.private.leaked, 10);
  assert.equal(leaky.guardRejected, 10);
  assert.equal(leaky.examples[0].cls, 'private');
  const strict = fuzzProjection({ ...opts, project: () => ({}) });
  assert.equal(strict.missingPositive, 10);
});

test('applyMutant needs a unique mutation point', () => {
  assert.equal(applyMutant('a b c', 'b', 'x'), 'a x c');
  assert.throws(() => applyMutant('a b b', 'b', 'x'), /exactly once/);
  assert.throws(() => applyMutant('a', 'z', 'x'), /exactly once/);
});

test('loadModuleFromSource compiles a module with relative requires', () => {
  const file = path.join(__dirname, '..', 'src', 'virtual.js');
  const m = loadModuleFromSource(file, "module.exports = require('./rng').createRng(5).next();");
  assert.equal(m, createRng(5).next());
});

test('runMutationAnalysis kills relative to the original', () => {
  const file = path.join(__dirname, '..', 'examples', 'gradebook', 'gradebook.js');
  const { campaign } = require('../examples/gradebook/campaign');
  const r = runMutationAnalysis({
    file,
    mutants: {
      unpublished_shown: ['    if (!a.published) continue;\n', '\n'],
      crash: ['function studentView(book, studentId) {', 'function studentView(book, studentId) { throw new Error("boom");'],
    },
    evaluate: (mod) => { const x = campaign({ cases: 100, seed: 3, mod }); return { guard: x.guardRejected, canary: x.leaks }; },
  });
  assert.deepEqual(r.original, { guard: 0, canary: 0 });
  assert.deepEqual(r.mutants.unpublished_shown.killedBy, ['canary']);
  assert.equal(r.mutants.crash.crashed, true);
  assert.deepEqual(r.score.canary, { killed: 2, total: 2 });
  assert.deepEqual(r.score.guard, { killed: 1, total: 2 });
});

test('fuzzSink captures what reaches the store', async () => {
  const store = createCaptureStore({ match: (t) => t.startsWith('INSERT') });
  const buffer = [];
  const record = (e) => buffer.push(e);
  const flush = async () => {
    const rows = buffer.splice(0);
    if (rows.length) await store.query('INSERT INTO events', rows.map((e) => e.code));
    await store.query('SELECT 1', ['ignored']);
  };
  const r = await fuzzSink({
    events: 50,
    generate: ({ canaries, index }) => ({ code: index % 2 ? canaries.plant('code', { allowedIn: ['store'] }) : canaries.plant('secret') }),
    record, flush, flushEvery: 20, store, canaries: createCanaries(), rng: createRng(1),
  });
  assert.equal(r.byClass.code.stored, 25);
  assert.equal(r.byClass.secret.leaked, 25);
  assert.equal(r.leaks, 25);
  assert.equal(r.statements, 3);
  assert.equal(store.text().includes('ignored'), false);
});

test('runLoad measures actions and samples gauges', async () => {
  let queue = 0;
  const r = await runLoad({
    clients: 5, seconds: 0.5, rampMs: 10, sampleMs: 20, rng: createRng(2),
    thinkMs: () => 20,
    gauges: { queue: () => queue },
    action: async () => { queue++; await new Promise((ok) => setTimeout(ok, 2)); queue--; },
  });
  assert.ok(r.actions > 20, `actions ${r.actions}`);
  assert.equal(r.latencyMs.n, r.actions);
  assert.ok(r.latencyMs.p50 >= 1);
  assert.ok(r.gauges.queue.max >= 0);
  assert.deepEqual(r.errors, []);
});

test('runLoad records action errors without stopping', async () => {
  const r = await runLoad({ clients: 2, seconds: 0.2, rampMs: 5, rng: createRng(3), thinkMs: () => 20, action: async () => { throw new Error('db down'); } });
  assert.equal(r.actions, 0);
  assert.equal(r.errors[0], 'db down');
});

test('percentile', () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([3, 1, 2], 0.5), 2);
  assert.equal(percentile([1, 2, 3, 4], 0.99), 4);
});
