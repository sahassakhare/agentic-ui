/**
 * Tiny structured logger. Emits one JSON-line per event so log aggregators
 * (Loki, Cloud Logging, Datadog, etc.) can index by field. No external
 * dependency — Pino / Winston would also work; this is just enough for the
 * demo without growing the dep graph.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const ENV_LEVEL = (process.env['LOG_LEVEL'] ?? 'info') as Level;
const THRESHOLD = LEVEL_ORDER[ENV_LEVEL] ?? LEVEL_ORDER.info;

function emit(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  if (LEVEL_ORDER[level] < THRESHOLD) return;
  const record = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  };
  const line = JSON.stringify(record);
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info:  (msg: string, fields?: Record<string, unknown>) => emit('info',  msg, fields),
  warn:  (msg: string, fields?: Record<string, unknown>) => emit('warn',  msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
};
