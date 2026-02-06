/**
 * Logger utility using pino.
 * Supports --verbose flag for detailed adjudication traces.
 */
import pino from 'pino';

let globalLevel: string = 'info';

export function setLogLevel(level: string): void {
  globalLevel = level;
}

export function createLogger(name: string): pino.Logger {
  return pino({
    name,
    level: globalLevel,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss',
        ignore: 'pid,hostname',
        destination: 1, // stdout (fd 1) instead of default stderr
      },
    },
  });
}

export function enableVerbose(): void {
  globalLevel = 'trace';
}
