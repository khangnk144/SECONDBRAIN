import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUNDLED_TEMPLATES } from '../../src/templates/bundled-templates.js';
import { CLAUDE_MD_SKELETON } from '../../src/templates/claude-md-skeleton.js';
import {
  sha256Hex,
  UPGRADABLE_FILES,
  upgradeTemplates,
} from '../../src/templates/template-upgrades.js';
import type { VaultService } from '../../src/vault/vault-types.js';
import { createVaultTestApp, snapshotTree, type VaultTestApp } from '../api/vault-test-app.js';
import { ALL_TOOLS } from '../mcp/mcp-test-kit.js';

const PORT = 47726;
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const PAPER_M1 = readFileSync(path.join(FIXTURES, 'paper-m1.md'), 'utf8');
const CLAUDE_M1 = readFileSync(path.join(FIXTURES, 'claude-md-m1.md'), 'utf8');
const PAPER = BUNDLED_TEMPLATES.find((t) => t.name === 'Paper.md')!.content;

/** The first milestone-6 text of CLAUDE.md, rebuilt: its `Liên quan` line had no `Nguồn` line. */
const CURRENT_RELATED = /- `## Liên quan` — first the line `- Nguồn: [\s\S]*?pages it touches\.\n/;
const CLAUDE_M6A = CLAUDE_MD_SKELETON.replace(
  CURRENT_RELATED,
  '- `## Liên quan` — links to the concept pages, other paper pages and research-gap pages it touches.\n',
);

const PAPER_SECTIONS = [
  '## Tóm tắt',
  '## Bài toán',
  '## Các cách hiện có',
  '## Khoảng trống và động lực',
  '## Phương pháp',
  '## Dữ liệu',
  '## Thí nghiệm',
  '## Kết quả (theo tác giả)',
  '## Hạn chế và hướng tiếp theo',
];

function inOrder(text: string, parts: string[]) {
  const positions = parts.map((part) => text.indexOf(part));
  expect(
    positions.every((p) => p >= 0),
    `missing one of ${parts.join(', ')}`,
  ).toBe(true);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
}

describe('paper format with problem, existing methods, gap, data, experiments (owner request R2)', () => {
  it('Paper.md has the sections in order, Input/Output lines and the extra keys', () => {
    inOrder(PAPER, [...PAPER_SECTIONS, '## Nhận xét\n', '## Liên quan']);
    expect(PAPER).toContain('**Input:**\n\n**Output:**');
    expect(PAPER).toMatch(
      /^---\ntype: paper\nauthors: \[\]\nyear:\nvenue:\nurl:\ndatasets: \[\]\nsource:\nsource_hash:\npages_covered:\nverified: false\ningested_at:\ncreated: \{\{date\}\}\n---\n/,
    );
  });

  it('the CLAUDE.md paper-page format has the same sections, the honesty rules and every tool', () => {
    inOrder(CLAUDE_MD_SKELETON, [
      ...PAPER_SECTIONS.map((s) => `\`${s}\``),
      '`## Nhận xét của AI`',
      '`## Liên quan`',
    ]);
    for (const phrase of [
      '**Input:** …',
      '**Output:** …',
      '(tr. 4)',
      '`Bài báo không nói rõ.`',
      'venue:',
      'datasets: []',
    ]) {
      expect(CLAUDE_MD_SKELETON).toContain(phrase);
    }
    for (const tool of ALL_TOOLS) expect(CLAUDE_MD_SKELETON).toContain(`\`${tool}\``);
    for (const heading of ['### Ingest', '### Query', '### Lint']) {
      expect(CLAUDE_MD_SKELETON).toContain(`\n${heading}\n`);
    }
  });

  it('keeps the hash of every bundled version, the current one last', () => {
    const [paper, claude] = UPGRADABLE_FILES;
    expect(paper?.versions[0]).toBe(sha256Hex(PAPER_M1));
    expect(paper?.versions.at(-1)).toBe(sha256Hex(PAPER));
    expect(claude?.versions[0]).toBe(sha256Hex(CLAUDE_M1));
    expect(claude?.versions.at(-1)).toBe(sha256Hex(CLAUDE_MD_SKELETON));
    expect(CLAUDE_M6A).not.toBe(CLAUDE_MD_SKELETON);
    expect(claude?.versions.at(-2)).toBe(sha256Hex(CLAUDE_M6A));
  });

  it('the paper page names its PDF under Liên quan, so the map keeps the paper → PDF edge', () => {
    const related = /- `## Liên quan` —[\s\S]*?\n\n/.exec(CLAUDE_MD_SKELETON)?.[0] ?? '';
    expect(related).toContain('`- Nguồn: [[<file name>.pdf]]`');
    expect(related).toContain('`[[3 Resources/papers/<file>.pdf]]`');
  });
});

describe('"Cập nhật mẫu": GET /api/templates/upgrades, POST /api/templates/upgrade', () => {
  let t: VaultTestApp;
  const abs = (p: string) => path.join(t.vaultRoot, p);
  const states = async () => (await t.call('GET', '/api/templates/upgrades')).json().items;
  beforeAll(async () => {
    t = await createVaultTestApp(PORT);
  });
  afterAll(async () => t?.close());

  it('a new vault has the current versions; GET never writes', async () => {
    const before = snapshotTree(t.vaultRoot);
    expect(await states()).toEqual([
      { path: 'Templates/Paper.md', state: 'current' },
      { path: 'CLAUDE.md', state: 'current' },
    ]);
    expect(snapshotTree(t.vaultRoot)).toEqual(before);
  });

  it('upgrades a file identical to an old version (old copy in the trash), never an edited one', async () => {
    writeFileSync(abs('Templates/Paper.md'), PAPER_M1);
    const edited = `${CLAUDE_M1}\nGhi chú của tôi.\n`;
    writeFileSync(abs('CLAUDE.md'), edited);
    expect(await states()).toEqual([
      { path: 'Templates/Paper.md', state: 'upgradable' },
      { path: 'CLAUDE.md', state: 'edited' },
    ]);
    const res = await t.call('POST', '/api/templates/upgrade', {
      paths: ['Templates/Paper.md', 'CLAUDE.md', 'Templates/Note.md'],
    });
    expect(res.json()).toEqual({
      upgraded: ['Templates/Paper.md'],
      skipped: [
        { path: 'CLAUDE.md', reason: 'edited' },
        { path: 'Templates/Note.md', reason: 'unknown' },
      ],
    });
    expect(readFileSync(abs('Templates/Paper.md'), 'utf8')).toBe(PAPER);
    expect(readFileSync(abs('CLAUDE.md'), 'utf8')).toBe(edited);
    const trash = (await t.context.vault.listTrash()).filter(
      (e) => e.reason === 'template-upgrade',
    );
    expect(trash).toHaveLength(1);
    expect(trash[0]?.originalPaths).toEqual(['Templates/Paper.md']);
    const copy = path.join(
      t.vaultRoot,
      '.secondbrain',
      'trash',
      trash[0]!.id,
      'files',
      'Templates',
      'Paper.md',
    );
    expect(readFileSync(copy, 'utf8')).toBe(PAPER_M1);
    expect(await states()).toEqual([
      { path: 'Templates/Paper.md', state: 'current' },
      { path: 'CLAUDE.md', state: 'edited' },
    ]);
  });

  it('reports missing files and refuses bad paths', async () => {
    rmSync(abs('Templates/Paper.md'));
    expect((await states())[0]).toEqual({ path: 'Templates/Paper.md', state: 'missing' });
    const res = await t.call('POST', '/api/templates/upgrade', { paths: ['Templates/Paper.md'] });
    expect(res.json()).toEqual({
      upgraded: [],
      skipped: [{ path: 'Templates/Paper.md', reason: 'missing' }],
    });
    expect(
      (await t.call('POST', '/api/templates/upgrade', { paths: ['../CLAUDE.md'] })).json().error
        .code,
    ).toBe('INVALID_PATH');
  });

  it('a file changed between the read and the write stops with CONFLICT and is left as it is', async () => {
    writeFileSync(abs('CLAUDE.md'), CLAUDE_M1);
    const racing = new Proxy(t.context.vault, {
      get(target, key) {
        if (key !== 'read') return Reflect.get(target, key);
        return async (p: string) => {
          const read = await target.read(p);
          writeFileSync(abs('CLAUDE.md'), 'sửa cùng lúc\n');
          return read;
        };
      },
    }) as VaultService;
    await expect(upgradeTemplates(racing, ['CLAUDE.md'])).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { upgraded: [] },
    });
    expect(readFileSync(abs('CLAUDE.md'), 'utf8')).toBe('sửa cùng lúc\n');
  });

  it('a CLAUDE.md holding the first milestone-6 text is upgraded to the Nguồn line', async () => {
    writeFileSync(abs('CLAUDE.md'), CLAUDE_M6A);
    expect((await states())[1]).toEqual({ path: 'CLAUDE.md', state: 'upgradable' });
    const res = await t.call('POST', '/api/templates/upgrade', { paths: ['CLAUDE.md'] });
    expect(res.json()).toEqual({ upgraded: ['CLAUDE.md'], skipped: [] });
    expect(readFileSync(abs('CLAUDE.md'), 'utf8')).toBe(CLAUDE_MD_SKELETON);
  });
});
