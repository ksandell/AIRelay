/**
 * SQLite-backed metric event store (v0.4.0).
 *
 * Persists every proxied request event for time-range queries beyond the
 * in-memory ring buffer's ~10 minute horizon. Default off — the proxy
 * remains a pure ring-buffer system unless `METRICS_DB_PATH` is set.
 *
 * Hot-path discipline:
 *   - `record()` (in collector.js) calls `enqueue()` synchronously, which
 *     pushes the event onto an in-memory buffer. No disk I/O.
 *   - A flush timer drains the buffer in batched INSERTs every
 *     `METRICS_WRITE_BATCH_MS` (default 1 s) or when the buffer reaches
 *     `METRICS_WRITE_BATCH_SIZE` (default 100), whichever comes first.
 *   - Retention runs on the existing node-cron schedule (daily) and deletes
 *     events older than `METRICS_RETENTION_DAYS`.
 *
 * Schema is forward-compatible: every nullable column corresponds to one
 * field on the canonical event shape in collector.js.
 */

import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'

let Database = null
let db = null
let insertStmt = null
let pending = []
let flushTimer = null
let opened = false

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  method TEXT,
  path TEXT,
  status INTEGER,
  duration_ms INTEGER,
  bytes_in INTEGER,
  bytes_out INTEGER,
  upstream TEXT,
  route TEXT,
  error TEXT,
  provider TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  total_tokens INTEGER,
  cost_usd REAL,
  tool_calls INTEGER,
  tool_bytes_in INTEGER,
  tool_bytes_out INTEGER,
  compactor_active INTEGER,
  compactor_bypass INTEGER,
  compactor_saved_bytes INTEGER,
  compactor_compressors TEXT,
  guardrails_action TEXT,
  guardrails_hits INTEGER,
  guardrails_detectors TEXT
);
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS events_route_ts ON events(route, ts);
CREATE INDEX IF NOT EXISTS events_model_ts ON events(model, ts);
CREATE INDEX IF NOT EXISTS events_compactor_ts ON events(compactor_active, ts);
CREATE INDEX IF NOT EXISTS events_guardrails_ts ON events(guardrails_action, ts);
`

// Idempotent migration for v0.4.x → adds new columns on databases that pre-date
// the compactor/guardrails fields. Safe to call on every open().
const ADD_COLUMNS = [
  ['compactor_active', 'INTEGER'],
  ['compactor_bypass', 'INTEGER'],
  ['compactor_saved_bytes', 'INTEGER'],
  ['compactor_compressors', 'TEXT'],
  ['guardrails_action', 'TEXT'],
  ['guardrails_hits', 'INTEGER'],
  ['guardrails_detectors', 'TEXT'],
]

function migrate(database) {
  const existing = new Set(
    database
      .prepare('PRAGMA table_info(events)')
      .all()
      .map((r) => r.name),
  )
  for (const [name, type] of ADD_COLUMNS) {
    if (!existing.has(name)) {
      database.exec(`ALTER TABLE events ADD COLUMN ${name} ${type}`)
    }
  }
  database.exec(`
    CREATE INDEX IF NOT EXISTS events_compactor_ts ON events(compactor_active, ts);
    CREATE INDEX IF NOT EXISTS events_guardrails_ts ON events(guardrails_action, ts);
  `)
}

async function loadModule() {
  if (Database !== null) return Database
  try {
    const mod = await import('better-sqlite3')
    Database = mod.default
    return Database
  } catch (err) {
    // Native module failed to load — disable persistence with a loud log
    // and keep the proxy running.
    // eslint-disable-next-line no-console
    console.error(
      `[metrics-store] better-sqlite3 unavailable; persistence disabled. Reason: ${err.message}`,
    )
    return null
  }
}

export async function open(dbPath) {
  if (opened) return db
  if (!dbPath) return null
  const Db = await loadModule()
  if (!Db) return null

  // Ensure parent dir exists.
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true })

  db = new Db(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.exec(SCHEMA)
  migrate(db)

  insertStmt = db.prepare(`
    INSERT INTO events (
      ts, method, path, status, duration_ms, bytes_in, bytes_out,
      upstream, route, error, provider, model,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens,
      cost_usd, tool_calls, tool_bytes_in, tool_bytes_out,
      compactor_active, compactor_bypass, compactor_saved_bytes, compactor_compressors,
      guardrails_action, guardrails_hits, guardrails_detectors
    ) VALUES (
      @ts, @method, @path, @status, @duration_ms, @bytes_in, @bytes_out,
      @upstream, @route, @error, @provider, @model,
      @input_tokens, @output_tokens, @cache_read_tokens, @cache_write_tokens, @total_tokens,
      @cost_usd, @tool_calls, @tool_bytes_in, @tool_bytes_out,
      @compactor_active, @compactor_bypass, @compactor_saved_bytes, @compactor_compressors,
      @guardrails_action, @guardrails_hits, @guardrails_detectors
    )
  `)

  // Drain on a timer so multiple events coalesce into one transaction.
  flushTimer = setInterval(flushSync, config.metricsWriteBatchMs).unref()
  opened = true
  return db
}

export function isOpen() {
  return opened
}

function toRow(ev) {
  return {
    ts: ev.ts,
    method: ev.method ?? null,
    path: ev.path ?? null,
    status: ev.status ?? null,
    duration_ms: ev.durationMs ?? null,
    bytes_in: ev.bytesIn ?? null,
    bytes_out: ev.bytesOut ?? null,
    upstream: ev.upstream ?? null,
    route: ev.route ?? null,
    error: ev.error ?? null,
    provider: ev.provider ?? null,
    model: ev.model ?? null,
    input_tokens: ev.inputTokens ?? null,
    output_tokens: ev.outputTokens ?? null,
    cache_read_tokens: ev.cacheReadTokens ?? null,
    cache_write_tokens: ev.cacheWriteTokens ?? null,
    total_tokens: ev.totalTokens ?? null,
    cost_usd: ev.costUsd ?? null,
    tool_calls: ev.toolCalls ?? null,
    tool_bytes_in: ev.toolBytesIn ?? null,
    tool_bytes_out: ev.toolBytesOut ?? null,
    compactor_active: ev.compactorActive == null ? null : ev.compactorActive ? 1 : 0,
    compactor_bypass: ev.compactorBypass == null ? null : ev.compactorBypass ? 1 : 0,
    compactor_saved_bytes: ev.compactorSavedBytes ?? null,
    compactor_compressors: ev.compactorCompressors ?? null,
    guardrails_action: ev.guardrailsAction ?? null,
    guardrails_hits: ev.guardrailsHits ?? null,
    guardrails_detectors: ev.guardrailsDetectors ?? null,
  }
}

/**
 * Enqueue an event for persistence. Synchronous, allocation-light. Safe to
 * call from the hot path — actual disk I/O is deferred to the flush timer.
 */
export function enqueue(ev) {
  if (!opened) return
  pending.push(toRow(ev))
  if (pending.length >= config.metricsWriteBatchSize) flushSync()
}

export function flushSync() {
  if (!opened || pending.length === 0) return
  const rows = pending
  pending = []
  const txn = db.transaction((items) => {
    for (const r of items) insertStmt.run(r)
  })
  try {
    txn(rows)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[metrics-store] flush failed (${rows.length} rows dropped): ${err.message}`)
  }
}

/**
 * Delete events older than `retentionDays`. Called by the cron tick.
 * Returns the number of rows removed.
 */
export function pruneOlderThan(retentionDays = config.metricsRetentionDays) {
  if (!opened) return 0
  const cutoff = new Date(Date.now() - retentionDays * 86400_000).toISOString()
  const info = db.prepare('DELETE FROM events WHERE ts < ?').run(cutoff)
  return info.changes
}

/**
 * Query events within [from, to] ISO strings, optionally filtered by route or
 * model. Returns plain objects with the canonical event shape (camelCase).
 */
export function queryRange({
  from,
  to,
  route = null,
  model = null,
  compactorActive = null,
  guardrailsAction = null,
  guardrailsAny = false,
  limit = 5000,
} = {}) {
  if (!opened) return []
  flushSync() // make recent writes visible
  const where = ['ts >= @from', 'ts <= @to']
  const params = { from, to, limit }
  if (route) {
    where.push('route = @route')
    params.route = route
  }
  if (model) {
    where.push('model = @model')
    params.model = model
  }
  if (compactorActive === true) where.push('compactor_active = 1')
  else if (compactorActive === false)
    where.push('(compactor_active IS NULL OR compactor_active = 0)')
  if (guardrailsAction) {
    where.push('guardrails_action = @guardrails_action')
    params.guardrails_action = guardrailsAction
  }
  if (guardrailsAny) {
    where.push(
      "(guardrails_hits > 0 OR (guardrails_action IS NOT NULL AND guardrails_action <> 'allow'))",
    )
  }
  const sql = `
    SELECT * FROM events
    WHERE ${where.join(' AND ')}
    ORDER BY ts DESC
    LIMIT @limit
  `
  return db.prepare(sql).all(params).map(rowToEvent)
}

/**
 * Aggregate events into time buckets. Period is one of 'hour' | 'day' | 'week'.
 * Returns [{ bucket, requests, totalTokens, totalCostUsd, errors }].
 */
export function rollups({
  period = 'day',
  from,
  to,
  route = null,
  model = null,
  compactorActive = null,
  guardrailsAny = false,
}) {
  if (!opened) return []
  flushSync()
  const fmt = bucketFormat(period)
  const where = ['ts >= @from', 'ts <= @to']
  const params = { from, to }
  if (route) {
    where.push('route = @route')
    params.route = route
  }
  if (model) {
    where.push('model = @model')
    params.model = model
  }
  if (compactorActive === true) where.push('compactor_active = 1')
  if (guardrailsAny) {
    where.push(
      "(guardrails_hits > 0 OR (guardrails_action IS NOT NULL AND guardrails_action <> 'allow'))",
    )
  }
  // SQLite's strftime + substr work uniformly for our ISO timestamps.
  const sql = `
    SELECT
      ${fmt} AS bucket,
      COUNT(*) AS requests,
      COALESCE(SUM(total_tokens), 0) AS totalTokens,
      COALESCE(SUM(cost_usd), 0) AS totalCostUsd,
      SUM(CASE WHEN status >= 400 OR error IS NOT NULL THEN 1 ELSE 0 END) AS errors,
      COALESCE(SUM(compactor_saved_bytes), 0) AS compactorSavedBytes,
      SUM(CASE WHEN compactor_active = 1 THEN 1 ELSE 0 END) AS compactorRequests,
      SUM(CASE WHEN guardrails_hits > 0 THEN 1 ELSE 0 END) AS guardrailsHitRequests,
      SUM(CASE WHEN guardrails_action = 'block' THEN 1 ELSE 0 END) AS guardrailsBlocks
    FROM events
    WHERE ${where.join(' AND ')}
    GROUP BY bucket
    ORDER BY bucket
  `
  return db.prepare(sql).all(params)
}

function bucketFormat(period) {
  // Use substr() — fast, no parsing — keyed off the ISO-8601 prefix.
  // ISO format: 2026-05-19T10:23:45.123Z
  //              1234567890123456789
  if (period === 'minute') return `substr(ts, 1, 16) || ':00Z'`
  if (period === '5min') {
    return `substr(ts, 1, 14) || printf('%02d', (CAST(substr(ts, 15, 2) AS INTEGER) / 5) * 5) || ':00Z'`
  }
  if (period === '15min') {
    // Group by quarter-hour using integer division on the minute.
    return `substr(ts, 1, 14) || printf('%02d', (CAST(substr(ts, 15, 2) AS INTEGER) / 15) * 15) || ':00Z'`
  }
  if (period === 'hour') return `substr(ts, 1, 13) || ':00:00Z'`
  if (period === 'week') {
    // strftime('%Y-%W', ts) returns 'YYYY-WW' (ISO week number).
    return `strftime('%Y-W%W', ts)`
  }
  // default: day
  return `substr(ts, 1, 10)`
}

function rowToEvent(r) {
  return {
    ts: r.ts,
    method: r.method,
    path: r.path,
    status: r.status,
    durationMs: r.duration_ms,
    bytesIn: r.bytes_in,
    bytesOut: r.bytes_out,
    upstream: r.upstream,
    route: r.route,
    error: r.error,
    provider: r.provider,
    model: r.model,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheReadTokens: r.cache_read_tokens,
    cacheWriteTokens: r.cache_write_tokens,
    totalTokens: r.total_tokens,
    costUsd: r.cost_usd,
    toolCalls: r.tool_calls,
    toolBytesIn: r.tool_bytes_in,
    toolBytesOut: r.tool_bytes_out,
    compactorActive: r.compactor_active == null ? null : !!r.compactor_active,
    compactorBypass: r.compactor_bypass == null ? null : !!r.compactor_bypass,
    compactorSavedBytes: r.compactor_saved_bytes,
    compactorCompressors: r.compactor_compressors,
    guardrailsAction: r.guardrails_action,
    guardrailsHits: r.guardrails_hits,
    guardrailsDetectors: r.guardrails_detectors,
  }
}

export function close() {
  if (!opened) return
  flushSync()
  if (flushTimer) clearInterval(flushTimer)
  try {
    db.close()
  } catch {
    // ignore
  }
  flushTimer = null
  db = null
  insertStmt = null
  opened = false
}

// Test-only: wipe state without touching disk.
export function _reset() {
  pending = []
}
