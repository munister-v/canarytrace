'use strict';
// Board autosave under load against a real PostgreSQL: each teacher saves the
// board (one UPDATE) and records a 'board.updated' telemetry event, then waits
// 2.1 s + Exp(3 s), the client's debounce. Needs the `pg` package and a
// database you may write to:
//
//   npm install pg
//   createdb canarytrace_load
//   CANARYTRACE_DB=postgres:///canarytrace_load node examples/teaching-board/load.js 200 60

const { createRng, runLoad } = require('../../src');
const pool = require('./db/pool');

async function main() {
  const { Pool } = require('pg');
  const teachers = Number(process.argv[2] || 100);
  const seconds = Number(process.argv[3] || 60);
  const stateKB = Number(process.argv[4] || 8);
  const pg = new Pool({ connectionString: process.env.CANARYTRACE_DB || 'postgres:///canarytrace_load', max: Number(process.env.CANARYTRACE_POOL_MAX || 20) });
  const stats = { statements: 0, telemetry: 0 };
  pool.impl = { query: (text, params) => { stats.statements++; if (/telemetry_/.test(text)) stats.telemetry++; return pg.query(text, params); } };
  const tel = require('./lib/telemetry');
  const rng = createRng(12345 + teachers);
  const state = JSON.stringify({ cards: 'x'.repeat(stateKB * 1024) });

  await pg.query('DROP TABLE IF EXISTS telemetry_events, telemetry_hourly, boards, users CASCADE');
  await pg.query('CREATE TABLE users (id UUID PRIMARY KEY)'); // the telemetry schema references users(id)
  await pg.query('CREATE TABLE boards (id UUID PRIMARY KEY, user_id UUID REFERENCES users(id), state JSONB, updated_at TIMESTAMPTZ)');
  const clientsData = Array.from({ length: teachers }, () => ({ user: rng.uuid(), board: rng.uuid() }));
  for (const t of clientsData) await pg.query('INSERT INTO users VALUES ($1)', [t.user]);
  for (const t of clientsData) await pg.query('INSERT INTO boards VALUES ($1, $2, $3::jsonb, NOW())', [t.board, t.user, state]);
  await tel.ensureTelemetrySchema();
  stats.statements = 0; stats.telemetry = 0;

  const result = await runLoad({
    clients: teachers,
    seconds,
    clientsData,
    rng,
    thinkMs: (r) => (2.1 + r.exp(3)) * 1000,
    gauges: { poolWaiting: () => pg.waitingCount },
    action: async (t) => {
      const { rows } = await pg.query('UPDATE boards SET state = $3::jsonb, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id', [t.board, t.user, state]);
      tel.recordTelemetry({ category: 'product', eventType: 'board.updated', actorId: t.user, boardId: rows[0].id, metadata: { surface: 'board' } });
    },
  });
  await tel.flushTelemetry();
  const stored = (await pg.query('SELECT count(*)::int AS n FROM telemetry_events')).rows[0].n;
  const dropped = (await pg.query("SELECT coalesce(sum(event_count),0)::int AS n FROM telemetry_hourly WHERE event_type = 'telemetry.dropped'")).rows[0].n;
  console.log(JSON.stringify({ ...result, eventsStored: stored, droppedCounted: dropped, telemetryStatementsPerEvent: +(stats.telemetry / Math.max(1, result.actions)).toFixed(4) }, null, 2));
  await pg.end();
  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
