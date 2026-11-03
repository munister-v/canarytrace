const pool = require('../db/pool');

// Telemetry is deliberately product- and operations-oriented. It never stores
// request bodies, board data, raw IP addresses, user agents or generated text.
// Those data belong to the feature that owns them, not to a monitoring feed.
const CATEGORIES = new Set(['product', 'request', 'security', 'system']);
const OUTCOMES = new Set(['ok', 'client_error', 'server_error', 'fallback', 'skipped']);
const SAFE_META_KEYS = new Set([
  'feature', 'method', 'operation', 'provider', 'reason', 'route', 'source',
  'status', 'surface', 'job', 'mode', 'kind',
  // lesson publish checks: codes and counts only
  'block', 'tool', 'composition', 'interaction', 'items', 'problems', 'auto_fixes',
  // teacher onboarding (the caller filters every value first)
  'onboarding_version', 'user_id_hash', 'account_type', 'entry_point', 'device_class', 'locale',
  'session_id', 'has_existing_data', 'experiment_variant', 'occurred_at', 'step', 'step_index',
  'elapsed_ms', 'progress_count', 'hours_since_close', 'total_elapsed_ms', 'path', 'item',
  'start_option', 'template_id', 'board_id', 'object_type', 'duration_ms', 'tip_id', 'target_present',
]);

let schemaPromise = null;

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function cleanText(value, max = 80) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function cleanEventType(value) {
  const eventType = cleanText(value, 80).toLowerCase();
  return /^[a-z][a-z0-9_.-]{1,79}$/.test(eventType) ? eventType : 'system.unknown';
}

/* The allow-list is on values too, not only on keys: an allowed key used to
   carry any 120 characters, so a name, an email or a line of a lesson could
   ride on 'reason' or 'kind' from a careless call or a client body. A string
   now has to look like a code (TOKEN) or match its key's own rule; anything
   else is DROPPED, never cut down to fit. */
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,59}$/;
const CODE_COUNTS = /^[A-Za-z0-9_-]{1,30}:\d{1,6}(,[A-Za-z0-9_-]{1,30}:\d{1,6}){0,7}$/;
const VALUE_RULES = {
  method: /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/,
  route: /^\/api(\/[a-z0-9:_-]{1,40}){0,8}\/?$/,
  problems: CODE_COUNTS,
  auto_fixes: CODE_COUNTS,
  occurred_at: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/,
  locale: /^[a-z]{2}(-[A-Za-z]{2,4})?$/,
};

function cleanValue(key, value) {
  const text = String(value).trim();
  return (VALUE_RULES[key] || TOKEN).test(text) ? text : undefined;
}

function cleanMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const safe = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!SAFE_META_KEYS.has(key) || value === null || value === undefined) continue;
    if (typeof value === 'number' && Number.isFinite(value)) safe[key] = Math.round(value);
    else if (typeof value === 'boolean') safe[key] = value;
    else if (typeof value === 'string') {
      const text = cleanValue(key, value);
      if (text !== undefined) safe[key] = text;
    }
  }
  return safe;
}

function ensureTelemetrySchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS telemetry_events (
          id          BIGSERIAL PRIMARY KEY,
          category    VARCHAR(24) NOT NULL,
          event_type  VARCHAR(80) NOT NULL,
          outcome     VARCHAR(24) NOT NULL DEFAULT 'ok',
          actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
          board_id    UUID REFERENCES boards(id) ON DELETE SET NULL,
          duration_ms INTEGER,
          metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_telemetry_events_created
          ON telemetry_events(created_at DESC)
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_telemetry_events_category_created
          ON telemetry_events(category, created_at DESC)
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_telemetry_events_type_created
          ON telemetry_events(event_type, created_at DESC)
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS telemetry_hourly (
          hour_start        TIMESTAMPTZ NOT NULL,
          category          VARCHAR(24) NOT NULL,
          event_type        VARCHAR(80) NOT NULL,
          outcome           VARCHAR(24) NOT NULL,
          event_count       INTEGER NOT NULL DEFAULT 0,
          total_duration_ms BIGINT NOT NULL DEFAULT 0,
          PRIMARY KEY (hour_start, category, event_type, outcome)
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_telemetry_hourly_category_hour
          ON telemetry_hourly(category, hour_start DESC)
      `);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function recordTelemetry(input = {}) {
  const category = CATEGORIES.has(input.category) ? input.category : 'system';
  const outcome = OUTCOMES.has(input.outcome) ? input.outcome : 'ok';
  const eventType = cleanEventType(input.eventType);
  const actorId = isUuid(input.actorId) ? input.actorId : null;
  const boardId = isUuid(input.boardId) ? input.boardId : null;
  const durationMs = Number.isFinite(Number(input.durationMs))
    ? Math.max(0, Math.min(Math.round(Number(input.durationMs)), 10 * 60 * 1000))
    : null;
  const metadata = cleanMetadata(input.metadata);

  // Monitoring must never delay a teacher's save, login, or share action.
  /* Coalescing: events wait in memory and leave every 5 s as one multi-row
     INSERT, with one hourly upsert per key, instead of two statements per
     event that all contended for the same hourly row. Hourly counters are
     updated at flush time from the rows really inserted; events lost to
     queue overflow or a failed insert are counted as telemetry.dropped. */
  _tq.events.push([category, eventType, outcome, actorId, boardId, durationMs, JSON.stringify(metadata)]);
  if (_tq.events.length > MAX_QUEUE) _tq.dropped += _tq.events.splice(0, _tq.events.length - MAX_QUEUE).length;
  if (!_tq.timer) {
    _tq.timer = setTimeout(flushTelemetry, 5000);
    if (_tq.timer.unref) _tq.timer.unref();
  }
  return Promise.resolve();
}

const MAX_QUEUE = 2000;
const _tq = { events: [], dropped: 0, timer: null, flushing: false };

async function flushTelemetry() {
  _tq.timer = null;
  if (_tq.flushing) { _tq.timer = setTimeout(flushTelemetry, 1000); return; }
  const events = _tq.events.splice(0);
  let dropped = _tq.dropped; _tq.dropped = 0;
  if (!events.length && !dropped) return;
  _tq.flushing = true;
  const hourly = new Map();
  const count = (category, eventType, outcome, n, ms) => {
    const key = `${category}\u0000${eventType}\u0000${outcome}`;
    const h = hourly.get(key) || { category, eventType, outcome, n: 0, ms: 0 };
    h.n += n; h.ms += ms;
    hourly.set(key, h);
  };
  try {
    await ensureTelemetrySchema();
    for (let i = 0; i < events.length; i += 500) {
      const chunk = events.slice(i, i + 500);
      const params = []; const rows = [];
      chunk.forEach((e, k) => {
        const o = k * 7;
        rows.push(`($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7}::jsonb)`);
        params.push(...e);
      });
      try {
        await pool.query(
          `INSERT INTO telemetry_events (category, event_type, outcome, actor_id, board_id, duration_ms, metadata)
           VALUES ${rows.join(', ')}`, params);
        chunk.forEach((e) => count(e[0], e[1], e[2], 1, e[5] || 0));
      } catch (error) {
        dropped += chunk.length;
        console.warn('[telemetry]', error.message);
      }
    }
    if (dropped) count('system', 'telemetry.dropped', 'skipped', dropped, 0);
    for (const h of hourly.values()) {
      await pool.query(
        `INSERT INTO telemetry_hourly
          (hour_start, category, event_type, outcome, event_count, total_duration_ms)
         VALUES (date_trunc('hour', NOW()), $1, $2, $3, $4, $5)
         ON CONFLICT (hour_start, category, event_type, outcome)
         DO UPDATE SET
           event_count = telemetry_hourly.event_count + EXCLUDED.event_count,
           total_duration_ms = telemetry_hourly.total_duration_ms + EXCLUDED.total_duration_ms`,
        [h.category, h.eventType, h.outcome, h.n, h.ms]);
    }
  } catch (error) {
    console.warn('[telemetry]', error.message);
  } finally {
    _tq.flushing = false;
  }
}

/* On a clean shutdown, write out what is still buffered. */
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, () => { flushTelemetry().finally(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); });
}

module.exports = { ensureTelemetrySchema, recordTelemetry, flushTelemetry };
