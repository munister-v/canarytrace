'use strict';
// Closed-loop load emulation for a write pipeline. `clients` independent
// users each perform an action, wait a think time, and repeat, for `seconds`.
// The harness measures the action's latency and samples any gauges the caller
// provides (pool queue length, buffer size) every `sampleMs`.

function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

function summarise(values) {
  if (!values.length) return { n: 0, p50: null, p95: null, p99: null, max: null, mean: null };
  const round = (x) => +x.toFixed(3);
  return {
    n: values.length,
    p50: round(percentile(values, 0.5)),
    p95: round(percentile(values, 0.95)),
    p99: round(percentile(values, 0.99)),
    max: round(Math.max(...values)),
    mean: round(values.reduce((a, b) => a + b, 0) / values.length),
  };
}

/**
 * @param {object} opts
 * @param {number} opts.clients
 * @param {number} opts.seconds
 * @param {(client, rng) => Promise<void>} opts.action   one user action
 * @param {(rng) => number} opts.thinkMs                  pause between actions
 * @param {Array} [opts.clientsData]                      per-client state
 * @param {Record<string, () => number>} [opts.gauges]    sampled during the run
 * @param {number} [opts.sampleMs=100]
 * @param {number} [opts.rampMs=5000]                      start spread
 * @param {object} opts.rng
 */
async function runLoad({ clients, seconds, action, thinkMs, clientsData = [], gauges = {}, sampleMs = 100, rampMs = 5000, rng }) {
  const latencies = [];
  const errors = [];
  const samples = Object.fromEntries(Object.keys(gauges).map((k) => [k, []]));
  const inflight = new Set();
  const timers = new Set();
  let stopping = false;
  let actions = 0;

  const later = (fn, ms) => {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
  };
  function loop(client) {
    if (stopping) return;
    later(() => {
      if (stopping) return;
      const t0 = process.hrtime.bigint();
      const p = Promise.resolve()
        .then(() => action(client, rng))
        .then(() => { actions++; latencies.push(Number(process.hrtime.bigint() - t0) / 1e6); })
        .catch((e) => { if (errors.length < 20) errors.push(e.message); })
        .finally(() => inflight.delete(p));
      inflight.add(p);
      loop(client);
    }, thinkMs(rng));
  }
  for (let i = 0; i < clients; i++) {
    const client = clientsData[i] ?? { index: i };
    later(() => loop(client), rng.next() * rampMs);
  }
  const sampler = setInterval(() => { for (const [k, g] of Object.entries(gauges)) samples[k].push(g()); }, sampleMs);

  await new Promise((r) => setTimeout(r, seconds * 1000));
  stopping = true;
  clearInterval(sampler);
  for (const t of timers) clearTimeout(t);
  await Promise.allSettled([...inflight]);

  const gaugeSummary = {};
  for (const [k, v] of Object.entries(samples)) gaugeSummary[k] = { mean: v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3) : null, max: v.length ? Math.max(...v) : null };
  return { clients, seconds, actions, actionsPerSec: +(actions / seconds).toFixed(2), latencyMs: summarise(latencies), gauges: gaugeSummary, errors };
}

module.exports = { runLoad, percentile, summarise };
