import { readFileSync } from 'node:fs';

/** The server package version (server/package.json; same relative location from src/ and dist/). */
export function readServerVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version?: string;
    };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const SERVER_VERSION = readServerVersion();
export const APP_ID = 'second-brain';
