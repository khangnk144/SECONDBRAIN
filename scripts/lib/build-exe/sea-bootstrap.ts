/**
 * Main script of the Second Brain executable (F29.1), transpiled to one CommonJS file by the
 * build (with `sea-runtime-store.ts` inlined). It may use Node built-ins only: a single-executable
 * main script cannot load files.
 * 1. Finds the runtime folder for the embedded payload's hash (`%LOCALAPPDATA%\\SecondBrain\\
 *    runtime\\<hash>` or `${XDG_DATA_HOME:-~/.local/share}/second-brain/runtime/<hash>`).
 * 2. Extracts the payload when that folder is missing or damaged (marker + file sizes), into a
 *    temp sibling that is renamed into place, so two starts racing never see a half folder.
 * 3. Marks the folder as used by this process and later removes folders of other hashes that
 *    no live process uses.
 * 4. Hands over to the server's CLI through a CommonJS shim on disk that imports the ESM entry,
 *    with `--home <exe folder>` (unless `--home`/`SB_HOME` is given), `SB_RUNTIME=exe` and
 *    `SB_EXE_PATH`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { getAsset, getRawAsset, isSea } from 'node:sea';
import {
  cleanupRuntimesSafely,
  ensureRuntime,
  HASH_ASSET,
  markInUse,
  PAYLOAD_ASSET,
  runtimeRoot,
} from './sea-runtime-store.js';

/** User arguments plus `--home <exe folder>` unless a home is given. */
export function serverArguments(args: string[], execPath: string, env: NodeJS.ProcessEnv) {
  const hasHome = args.some((arg) => arg === '--home' || arg.startsWith('--home='));
  return hasHome || env.SB_HOME ? [...args] : [...args, '--home', path.dirname(execPath)];
}

/** A short code only: messages can name folders of the user. */
export function failureCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)) return code;
  const first = error instanceof Error ? error.message.split(' ')[0] : '';
  return first && /^[A-Z0-9_]+$/.test(first) ? first : 'UNKNOWN';
}

function reportFailure(error: unknown): void {
  const code = failureCode(error);
  process.stderr.write(`Second Brain could not start (${code}).\n`);
  if (process.platform !== 'win32') return;
  // No console in the Windows build: one message box (the code is ASCII, no user text).
  const text = `Second Brain chưa mở được (mã ${code}). Bạn mở lại thử; nếu vẫn vậy, chạy lại "Tạo bản exe".`;
  const script =
    'Add-Type -AssemblyName System.Windows.Forms; ' +
    `[System.Windows.Forms.MessageBox]::Show('${text.replace(/'/g, "''")}', 'Second Brain') | Out-Null`;
  spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    { windowsHide: true },
  );
}

function main(): void {
  try {
    const hash = getAsset(HASH_ASSET, 'utf8').trim();
    const root = runtimeRoot(process.platform, process.env, os.homedir());
    const dir = ensureRuntime(root, hash, () => new Uint8Array(getRawAsset(PAYLOAD_ASSET)));
    const usage = markInUse(dir);
    process.on('exit', () => {
      try {
        fs.rmSync(usage, { force: true });
      } catch {
        // a marker left behind is pruned by the next cleanup
      }
    });
    // In the server's own process: a failure here must never stop the app (review L4).
    setTimeout(() => cleanupRuntimesSafely(root, dir), 30_000).unref();
    for (const stream of [process.stdout, process.stderr]) stream.on('error', () => undefined);
    const entry = 'server/dist/index.js';
    process.env.SB_RUNTIME = 'exe';
    process.env.SB_EXE_PATH = process.execPath;
    const args = serverArguments(process.argv.slice(2), process.execPath, process.env);
    process.argv = [process.execPath, path.join(dir, 'app', entry), ...args];
    const load = createRequire(path.join(dir, 'app', 'sea-entry.cjs'))('./sea-entry.cjs') as (
      file: string,
    ) => Promise<unknown>;
    load(entry).catch((error: unknown) => {
      reportFailure(error);
      process.exit(1);
    });
  } catch (error) {
    reportFailure(error);
    process.exit(1);
  }
}

if (isSea()) main();
