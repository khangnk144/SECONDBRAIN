/**
 * How the tray helper is started (F29.2): script and icon paths, PowerShell arguments, the
 * environment that carries the token and texts (never argv), and its stdout status line.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type { GlobalSettings } from '../config/global-settings.js';
import { trayStringsJson, type TrayLanguage } from './tray-strings.js';

export interface TrayChild {
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  on(event: 'exit', listener: (code: number | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  kill(): boolean;
}
export type TraySpawner = (command: string, args: string[], env: NodeJS.ProcessEnv) => TrayChild;

export const trayScriptPath = (appDir: string) =>
  path.join(appDir, 'launcher', 'tray', 'second-brain-tray.ps1');

/** The PWA icon (built copy first); the script falls back to a system icon without one. */
export function trayIconPath(appDir: string): string | null {
  const candidates = ['web/dist/icons/icon-192.png', 'web/public/icons/icon-192.png'];
  const found = candidates.map((rel) => path.join(appDir, ...rel.split('/'))).find(existsSync);
  return found ?? null;
}

export function trayArguments(script: string): string[] {
  return [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-STA',
    '-WindowStyle',
    'Hidden',
    '-File',
    script,
  ];
}

export interface TrayEnvInput {
  token: string;
  port: number;
  parentPid: number;
  language: TrayLanguage;
  icon: string | null;
}

export function trayEnvironment(base: NodeJS.ProcessEnv, input: TrayEnvInput): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    SB_TOKEN: input.token,
    SB_PORT: String(input.port),
    SB_PARENT_PID: String(input.parentPid),
    SB_TRAY_STRINGS: trayStringsJson(input.language),
  };
  if (input.icon) env.SB_ICON = input.icon;
  else delete env.SB_ICON;
  return env;
}

/** `system.tray` (F0 adds it with default true): only an explicit `false` turns it off. */
export const wantsTray = (settings: GlobalSettings) =>
  (settings.system as { tray?: unknown }).tray !== false;

export const defaultTraySpawner: TraySpawner = (command, args, env) =>
  nodeSpawn(command, args, { env, windowsHide: true, shell: false, stdio: 'pipe' });

/** Calls `onStatus` with the first `{"hotkeyRegistered": …}` line; drains everything else. */
export function readStatusLine(
  stream: Readable | null,
  onStatus: (registered: boolean) => void,
): void {
  let buffer = '';
  stream?.setEncoding('utf8');
  stream?.on('data', (chunk: string) => {
    if (buffer.length > 4096) return;
    buffer += chunk;
    for (const line of buffer.split(/\r?\n/).slice(0, -1)) {
      try {
        const parsed = JSON.parse(line) as { hotkeyRegistered?: unknown };
        if (typeof parsed.hotkeyRegistered === 'boolean') onStatus(parsed.hotkeyRegistered);
      } catch {
        // not a status line
      }
    }
    buffer = buffer.slice(buffer.lastIndexOf('\n') + 1);
  });
}
