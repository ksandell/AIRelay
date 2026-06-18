// Hermetic test env. Runs before any module (incl. src/config.js) is imported,
// and before dotenv.config() — which does NOT override already-set vars — so
// these win over the developer's local .env. Keeps the unit suite deterministic
// regardless of whether the dev stack has the Dragonfly cache enabled.
process.env.CACHE_ENABLED = 'false'
process.env.CACHE_REDIS_URL = ''
// Prevent test-generated log entries (e.g. errorHandler test throws) from
// writing to the real data/logs/app.log on the developer's machine.
process.env.LOG_SINK = 'noop'
