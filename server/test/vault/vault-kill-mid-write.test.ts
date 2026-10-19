import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openVault } from '../../src/vault/open-vault.js';
import { makeTempDir, removeDir } from '../helpers/test-environment.js';
import { sha256 } from './helpers/vault-test-kit.js';

const CHILD = fileURLToPath(new URL('./helpers/crash-writer-child.ts', import.meta.url));
const APP_DIR = fileURLToPath(new URL('../../../', import.meta.url));
const FILE = '1 Projects/Đồ án lớn.md';
const SIZE = 4 * 1024 * 1024;
const ROUNDS = 6;

/** Runs the writer child, kills it with SIGKILL a little after it starts writing. */
function runAndKill(root: string, delayMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', CHILD, root, FILE, String(SIZE)], {
      cwd: APP_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('ready')) setTimeout(() => child.kill('SIGKILL'), delayMs);
    });
    child.on('error', reject);
    child.on('exit', (_code, signal) =>
      signal === 'SIGKILL' ? resolve() : reject(new Error(`child exited on its own: ${stderr}`)),
    );
  });
}

describe('killing the process mid-write (F1.2)', () => {
  let base: string;
  let root: string;
  const whole = new Set<string>();
  beforeAll(async () => {
    base = makeTempDir('sb kill Ghi chú');
    root = path.join(base, 'vault');
    const { vault } = await openVault({ root });
    const original = await vault.create(FILE, 'bản gốc\n');
    await vault.close();
    whole.add(original.revision);
    for (let i = 0; i < 26; i += 1) whole.add(sha256(String.fromCharCode(65 + i).repeat(SIZE)));
  });
  afterAll(() => removeDir(base));

  it('leaves either the old or a complete new version, never a torn file', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      await runAndKill(root, 40 + round * 60);
      const bytes = readFileSync(path.join(root, '1 Projects', 'Đồ án lớn.md'));
      expect(whole.has(sha256(bytes))).toBe(true);
    }
    const { vault } = await openVault({ root });
    expect(readdirSync(path.join(root, '1 Projects'))).toEqual(['Đồ án lớn.md']);
    expect(whole.has((await vault.read(FILE)).revision)).toBe(true);
    await vault.close();
  }, 120_000);
});
