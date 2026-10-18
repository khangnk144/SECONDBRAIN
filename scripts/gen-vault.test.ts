import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateVault } from './gen-vault.js';
import { knownVaultDirs } from './lib/gen-vault/out-dir-safety.js';
import { allocate } from './lib/gen-vault/prng.js';

const today = '2026-10-18';
const fresh = (label: string) => mkdtempSync(path.join(tmpdir(), `sb gen ${label} Đồ án `));

function snapshotTree(dir: string, rel = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(path.join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${name}` : name;
    const full = path.join(dir, r);
    try {
      out[r] = readFileSync(full, 'utf8');
    } catch {
      Object.assign(out, snapshotTree(dir, r));
    }
  }
  return out;
}

function countMatches(tree: Record<string, string>, re: RegExp, filter: (p: string) => boolean) {
  return Object.entries(tree)
    .filter(([p]) => filter(p))
    .reduce((n, [, text]) => n + (text.match(re)?.length ?? 0), 0);
}

describe('synthetic vault generator', () => {
  it('produces exact note, link and task totals for a small vault', () => {
    const root = fresh('counts');
    const out = path.join(root, 'vault');
    const summary = generateVault({
      outDir: out,
      notes: 60,
      seed: 7,
      today,
      realVaultDir: path.join(root, 'real'),
    });
    expect(summary.notes).toBe(60);
    expect(summary.links.total).toBe(240);
    expect(summary.tasks.total).toBe(36);
    expect(summary.tasks.open + summary.tasks.done).toBe(36);
    expect(summary.bytes).toBeGreaterThan(600_000 * 0.95);
    const tree = snapshotTree(out);
    const notes = Object.keys(tree).filter((p) => p.endsWith('.md') && !p.startsWith('Templates/'));
    expect(notes).toHaveLength(60);
    expect(Object.keys(tree).filter((p) => p.startsWith('Templates/'))).toHaveLength(8);
    // Every body link is outside code blocks; the code-block sample is counted separately.
    const linkCount = countMatches(tree, /\[\[[^\]]+\]\]/g, (p) => notes.includes(p));
    expect(linkCount).toBe(240 + summary.frontmatterCourseLinks + summary.links.inCodeBlocks);
    expect(countMatches(tree, /^- \[[ x]\] /gm, (p) => notes.includes(p))).toBe(36);
    expect(JSON.parse(tree['.secondbrain/gen-vault-summary.json'] ?? '{}').notes).toBe(60);
  });

  it('creates the standard folders and duplicate titles in two course folders', () => {
    const root = fresh('layout');
    const out = path.join(root, 'vault');
    const summary = generateVault({
      outDir: out,
      notes: 60,
      seed: 3,
      today,
      realVaultDir: path.join(root, 'real'),
    });
    for (const folder of [
      '0 Inbox',
      '1 Projects',
      '2 Areas',
      '3 Resources',
      '4 Archive',
      'wiki',
      'Daily',
      'Templates',
      'Attachments',
    ]) {
      expect(readdirSync(out)).toContain(folder);
    }
    expect(summary.duplicateTitles).toBeGreaterThanOrEqual(2);
    const tree = snapshotTree(out);
    const bai1 = Object.keys(tree).filter((p) => p.endsWith('/Bài 1.md'));
    expect(bai1).toHaveLength(2);
    expect(new Set(bai1.map((p) => path.posix.dirname(p))).size).toBe(2);
    expect(tree[`Daily/${today}.md`]).toContain('type: daily');
  });

  it('is deterministic for the same seed and date', () => {
    const root = fresh('determinism');
    const opts = { notes: 40, seed: 11, today, realVaultDir: path.join(root, 'real') };
    generateVault({ outDir: path.join(root, 'a'), ...opts });
    generateVault({ outDir: path.join(root, 'b'), ...opts });
    expect(snapshotTree(path.join(root, 'a'))).toEqual(snapshotTree(path.join(root, 'b')));
    generateVault({ outDir: path.join(root, 'c'), ...opts, seed: 12 });
    expect(snapshotTree(path.join(root, 'c'))).not.toEqual(snapshotTree(path.join(root, 'a')));
  });

  it('refuses the real vault, folders inside it, links into it and non-empty folders', () => {
    const root = fresh('safety');
    const realVault = path.join(root, 'vault');
    mkdirSync(realVault);
    const base = { notes: 10, seed: 1, today, realVaultDir: realVault };
    expect(() => generateVault({ ...base, outDir: realVault })).toThrow(/real vault/);
    expect(() => generateVault({ ...base, outDir: path.join(realVault, 'perf') })).toThrow(
      /real vault/,
    );
    symlinkSync(realVault, path.join(root, 'link to vault'), 'junction');
    expect(() => generateVault({ ...base, outDir: path.join(root, 'link to vault', 'x') })).toThrow(
      /real vault/,
    );
    const busy = path.join(root, 'busy');
    mkdirSync(busy);
    writeFileSync(path.join(busy, 'note.md'), 'mine');
    expect(() => generateVault({ ...base, outDir: busy })).toThrow(/non-empty/);
    expect(readFileSync(path.join(busy, 'note.md'), 'utf8')).toBe('mine');
    expect(readdirSync(realVault)).toEqual([]);
  });

  it('treats look-alike names next to the vault as inside or risky', () => {
    const root = fresh('lookalike');
    const realVault = path.join(root, 'vault');
    mkdirSync(realVault);
    const base = { notes: 5, seed: 1, today, realVaultDir: realVault };
    // "<vault>/..x" is a child folder named "..x", not a sibling.
    expect(() => generateVault({ ...base, outDir: path.join(realVault, '..x') })).toThrow(
      /real vault/,
    );
    // Windows strips trailing dots and spaces, so these would land in the real vault.
    expect(() => generateVault({ ...base, outDir: `${realVault}.` })).toThrow(/dot or space/);
    expect(() => generateVault({ ...base, outDir: `${realVault} ` })).toThrow(/dot or space/);
    expect(() => generateVault({ ...base, outDir: path.join(root, 'perf. ', 'x') })).toThrow(
      /dot or space/,
    );
    // A real sibling is fine.
    expect(generateVault({ ...base, outDir: path.join(root, 'vault-perf') }).notes).toBe(5);
    expect(readdirSync(realVault)).toEqual([]);
  });

  it('also guards the vault folder configured in settings.json', () => {
    const installRoot = fresh('install root');
    const custom = path.join(installRoot, 'Ghi chú của tôi');
    mkdirSync(path.join(installRoot, '.secondbrain'), { recursive: true });
    writeFileSync(
      path.join(installRoot, '.secondbrain', 'settings.json'),
      JSON.stringify({ vaultPath: 'Ghi chú của tôi' }),
    );
    const dirs = knownVaultDirs(installRoot);
    expect(dirs).toEqual([path.join(installRoot, 'vault'), custom]);
    const base = { notes: 5, seed: 1, today, realVaultDir: dirs };
    expect(() => generateVault({ ...base, outDir: path.join(custom, 'perf') })).toThrow(
      /real vault/,
    );
    expect(() => generateVault({ ...base, outDir: path.join(installRoot, 'vault', 'x') })).toThrow(
      /real vault/,
    );
    writeFileSync(path.join(installRoot, '.secondbrain', 'settings.json'), '{ broken');
    expect(() => knownVaultDirs(installRoot)).toThrow(/refusing to guess/);
  });

  it('splits totals exactly by weight', () => {
    expect(allocate(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(allocate(7, [0, 2, 5]).reduce((s, n) => s + n, 0)).toBe(7);
    expect(allocate(5, [0, 0])).toEqual([0, 0]);
  });
});
