'use strict';
// Canary oracle for analytics sinks: a telemetry or logging pipeline that
// takes events from the application and writes them to storage. Events with
// planted canaries go through the real pipeline; everything it would write is
// captured at the storage boundary and scanned.

/**
 * A stand-in for a storage client that records what would be written.
 * `match(text)` decides which statements count as writes of the sink under
 * test (default: every statement).
 */
function createCaptureStore({ match = () => true } = {}) {
  const captured = [];
  const statements = [];
  return {
    captured,
    statements,
    query(text, params = []) {
      if (match(text)) {
        statements.push(text);
        captured.push(...params);
      }
      return Promise.resolve({ rows: [], rowCount: params.length ? 1 : 0 });
    },
    /** Everything written, as one string ready for canaries.scan(). */
    text() {
      return captured.map((x) => (x === null || x === undefined ? '' : typeof x === 'string' ? x : JSON.stringify(x))).join('\u0001');
    },
  };
}

/**
 * @param {object} opts
 * @param {number} opts.events                   number of events to generate
 * @param {(ctx) => object} opts.generate        builds one event, planting
 *        canaries through ctx.canaries.plant(cls, { allowedIn: ['store'] })
 *        for values the sink may keep, and with allowedIn: [] for the rest
 * @param {(event) => void} opts.record           the pipeline's entry point
 * @param {() => Promise<void>} [opts.flush]      drains buffered events
 * @param {number} [opts.flushEvery]              flush after this many events
 * @param {object} opts.store                     from createCaptureStore()
 * @param {object} opts.canaries                  from createCanaries()
 * @param {object} opts.rng                       from createRng()
 */
async function fuzzSink({ events, generate, record, flush, flushEvery = 1000, store, canaries, rng }) {
  for (let i = 0; i < events; i++) {
    record(generate({ rng, canaries, index: i }));
    if (flush && (i + 1) % flushEvery === 0) await flush();
  }
  if (flush) await flush();
  const seen = canaries.scan(store.text());
  const byClass = {};
  for (const [c, info] of canaries.planted) {
    const s = (byClass[info.cls] = byClass[info.cls] || { planted: 0, stored: 0, leaked: 0 });
    s.planted++;
    if (seen.has(c)) {
      s.stored++;
      if (!canaries.isAllowed(c, 'store', { data: info.data })) s.leaked++;
    }
  }
  const leaks = Object.values(byClass).reduce((a, s) => a + s.leaked, 0);
  return { events, statements: store.statements.length, leaks, byClass };
}

module.exports = { createCaptureStore, fuzzSink };
