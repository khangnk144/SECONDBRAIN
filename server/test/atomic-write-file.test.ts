import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { atomicWriteFile } from '../src/fs/atomic-write-file.js';
import { makeTempDir, removeDir } from './helpers/test-environment.js';

describe('atomicWriteFile', () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTempDir('sb atomic Ghi chú');
  });
  afterEach(() => removeDir(dir));

  it('creates parent folders and writes UTF-8 content to Vietnamese paths with spaces', async () => {
    const file = path.join(dir, '1 Projects', 'Đồ án Giải tích.md');
    await atomicWriteFile(file, '# Đồ án\n');
    expect(readFileSync(file, 'utf8')).toBe('# Đồ án\n');
  });

  it('replaces an existing file and leaves no temp file behind', async () => {
    const file = path.join(dir, 'a.json');
    writeFileSync(file, 'old');
    await atomicWriteFile(file, 'new');
    expect(readFileSync(file, 'utf8')).toBe('new');
    expect(readdirSync(dir)).toEqual(['a.json']);
  });

  it('keeps the original file when the final rename fails', async () => {
    const target = path.join(dir, 'target-is-a-folder');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(path.join(target, 'child'), { recursive: true });
    await expect(atomicWriteFile(target, 'x')).rejects.toThrow();
    expect(readdirSync(dir)).toEqual(['target-is-a-folder']);
  });
});
