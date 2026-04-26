import { Injectable, InjectionToken } from '@angular/core';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AgenticLogger {
  log(level: LogLevel, message: string, context?: Readonly<Record<string, unknown>>): void;
  debug(message: string, context?: Readonly<Record<string, unknown>>): void;
  info(message: string, context?: Readonly<Record<string, unknown>>): void;
  warn(message: string, context?: Readonly<Record<string, unknown>>): void;
  error(message: string, context?: Readonly<Record<string, unknown>>): void;
}

@Injectable({ providedIn: 'root' })
export class ConsoleAgenticLogger implements AgenticLogger {
  log(level: LogLevel, message: string, context?: Readonly<Record<string, unknown>>): void {
    const fn = level === 'debug' ? console.debug : level === 'warn' ? console.warn : level === 'error' ? console.error : console.info;
    if (context) {
      fn(`[agentic-ui] ${message}`, context);
    } else {
      fn(`[agentic-ui] ${message}`);
    }
  }
  debug(message: string, context?: Readonly<Record<string, unknown>>): void { this.log('debug', message, context); }
  info(message: string, context?: Readonly<Record<string, unknown>>): void { this.log('info', message, context); }
  warn(message: string, context?: Readonly<Record<string, unknown>>): void { this.log('warn', message, context); }
  error(message: string, context?: Readonly<Record<string, unknown>>): void { this.log('error', message, context); }
}

export const AGENTIC_LOGGER = new InjectionToken<AgenticLogger>(
  'AGENTIC_LOGGER',
  { providedIn: 'root', factory: () => new ConsoleAgenticLogger() },
);
