import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_MAX_LOG_BYTES = 5 * 1024 * 1024;
const KEPT_ROTATIONS = 3;

export type LogLevel = 'info' | 'warn' | 'error';

export interface AppLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  readonly file: string | null;
}

/** Removes anything that looks like a secret before a line reaches the log file. */
export function redactSecrets(message: string, secrets: readonly string[] = []): string {
  let out = message;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join('[redacted]');
  }
  return out
    .replace(/([?&](?:token|key|api[_-]?key)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(x-sb-token|authorization)(["'\s:=]+)[^\s"',]+/gi, '$1$2[redacted]');
}

export interface FileLoggerOptions {
  dir: string;
  fileName?: string;
  maxBytes?: number;
  /** Values that must never appear in the log (e.g. the session token). */
  secrets?: () => readonly string[];
  /** Also echo to the console (useful in dev). */
  echo?: boolean;
}

/**
 * Small synchronous append-only logger with size-based rotation:
 * server.log → server.log.1 → … → server.log.3. Writes are best-effort; a failing
 * disk must never crash the server.
 */
export function createFileLogger(options: FileLoggerOptions): AppLogger {
  const file = path.join(options.dir, options.fileName ?? 'server.log');
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_LOG_BYTES;
  try {
    mkdirSync(options.dir, { recursive: true });
  } catch {
    // ignore: logging is best-effort
  }

  function rotateIfNeeded(): void {
    let size: number;
    try {
      size = statSync(file).size;
    } catch {
      return;
    }
    if (size < maxBytes) return;
    rmSync(`${file}.${KEPT_ROTATIONS}`, { force: true });
    for (let i = KEPT_ROTATIONS - 1; i >= 1; i -= 1) {
      try {
        renameSync(`${file}.${i}`, `${file}.${i + 1}`);
      } catch {
        // missing rotation slot
      }
    }
    renameSync(file, `${file}.1`);
  }

  function write(level: LogLevel, message: string): void {
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${redactSecrets(message, options.secrets?.() ?? [])}`;
    if (options.echo) (level === 'error' ? console.error : console.log)(line);
    try {
      rotateIfNeeded();
      appendFileSync(file, `${line}\n`, 'utf8');
    } catch {
      // ignore: logging is best-effort
    }
  }

  return {
    file,
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message) => write('error', message),
  };
}

/** Logger that drops everything (tests that do not care about logs). */
export function createSilentLogger(): AppLogger {
  return { file: null, info() {}, warn() {}, error() {} };
}
