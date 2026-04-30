/**
 * Tiny JSON-line structured logger. Same shape as `examples/demo-server`'s
 * logger so cross-demo log readers can ingest both.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(process.env['LOG_LEVEL'] as Level | undefined) ?? 'info'] ?? LEVELS.info;

function emit(level: Level, msg: string, attrs?: Record<string, unknown>): void {
  if (LEVELS[level] < threshold) return;
  const entry = { ts: new Date().toISOString(), level, msg, ...(attrs ?? {}) };
  // Always go to stderr — keeps stdout clean for downstream pipes.
  console.error(JSON.stringify(entry));
}

export const log = {
  debug: (msg: string, attrs?: Record<string, unknown>) => emit('debug', msg, attrs),
  info:  (msg: string, attrs?: Record<string, unknown>) => emit('info', msg, attrs),
  warn:  (msg: string, attrs?: Record<string, unknown>) => emit('warn', msg, attrs),
  error: (msg: string, attrs?: Record<string, unknown>) => emit('error', msg, attrs),
};
