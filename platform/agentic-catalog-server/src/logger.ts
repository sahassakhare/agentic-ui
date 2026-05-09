import pino from 'pino';

export const logger = pino({
  name: 'agentic-catalog-server',
  level: process.env['LOG_LEVEL'] ?? 'info',
  // Disable pretty-print in production (consumers pipe to stdout +
  // their log aggregator; structured JSON is the right shape).
  // For local dev, set LOG_FORMAT=pretty.
  ...(process.env['LOG_FORMAT'] === 'pretty'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
    ],
    censor: '[REDACTED]',
  },
});

export type Logger = typeof logger;
