import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUNDLED_TEMPLATES } from '../../src/templates/bundled-templates.js';
import { openVault, restoreMissingTemplates } from '../../src/vault/open-vault.js';
import { TEMPLATE_PATHS } from '../../src/vault/vault-layout.js';
import type { VaultService } from '../../src/vault/vault-types.js';
import { makeTempDir, removeDir } from '../helpers/test-environment.js';
import { listTree, readDisk } from './helpers/vault-test-kit.js';

const EXPECTED_TEMPLATES = [
  'Templates/Book.md',
  'Templates/Course project.md',
  'Templates/Course.md',
  'Templates/Daily.md',
  'Templates/Lecture.md',
  'Templates/Note.md',
  'Templates/Paper.md',
  'Templates/Research project.md',
];

describe('bundled templates (F14.1)', () => {
  let base: string;
  let root: string;
  let vault: VaultService;
  beforeEach(async () => {
    base = makeTempDir('sb templates Mẫu');
    root = path.join(base, 'vault');
    vault = (await openVault({ root })).vault;
  });
  afterEach(async () => {
    await vault.close();
    removeDir(base);
  });

  it('creates exactly the eight templates', () => {
    expect([...TEMPLATE_PATHS].sort()).toEqual(EXPECTED_TEMPLATES);
    expect(listTree(path.join(root, 'Templates'))).toEqual(
      EXPECTED_TEMPLATES.map((p) => p.slice('Templates/'.length)),
    );
    for (const template of BUNDLED_TEMPLATES) {
      expect(readDisk(root, `Templates/${template.name}`)).toBe(template.content);
    }
  });

  it('never overwrites an edited template on reopen', async () => {
    writeFileSync(path.join(root, 'Templates/Note.md'), 'của tôi');
    await vault.close();
    vault = (await openVault({ root })).vault;
    expect(readDisk(root, 'Templates/Note.md')).toBe('của tôi');
  });

  it('a template the user deleted stays deleted on reopen', async () => {
    rmSync(path.join(root, 'Templates/Book.md'));
    await vault.close();
    const reopened = await openVault({ root });
    vault = reopened.vault;
    expect(reopened.created).toEqual([]);
    expect(listTree(path.join(root, 'Templates'))).not.toContain('Book.md');
  });

  it('an existing folder opened for the first time gets the missing templates only', async () => {
    await vault.close();
    rmSync(path.join(root, '.secondbrain'), { recursive: true });
    rmSync(path.join(root, 'Templates/Course.md'));
    writeFileSync(path.join(root, 'Templates/Note.md'), 'của tôi');
    const reopened = await openVault({ root });
    vault = reopened.vault;
    expect(reopened.created).toEqual(['Templates/Course.md']);
    expect(readDisk(root, 'Templates/Note.md')).toBe('của tôi');
  });

  it('restoreMissingTemplates re-creates only the missing ones', async () => {
    rmSync(path.join(root, 'Templates/Paper.md'));
    rmSync(path.join(root, 'Templates/Daily.md'));
    writeFileSync(path.join(root, 'Templates/Book.md'), 'sửa rồi');
    const created = await restoreMissingTemplates(vault);
    expect([...created].sort()).toEqual(['Templates/Daily.md', 'Templates/Paper.md']);
    expect(readDisk(root, 'Templates/Book.md')).toBe('sửa rồi');
    expect(await restoreMissingTemplates(vault)).toEqual([]);
  });

  it('template contents follow the template rules', () => {
    const read = (name: string) => readDisk(root, `Templates/${name}`);
    for (const template of BUNDLED_TEMPLATES)
      expect(template.content).toContain('created: {{date}}');
    const project = read('Course project.md');
    expect(project).toMatch(/^---\ntype: project\nstatus: todo\ndeadline:\ncourse:\n/);
    expect(project.match(/^- \[ \] /gm)).toHaveLength(3);
    expect(project).not.toContain('📅');
    for (const section of ['## Yêu cầu', '## Ghi chú', '## Tài liệu'])
      expect(project).toContain(section);
    const paper = read('Paper.md');
    for (const key of [
      'source:',
      'source_hash:',
      'pages_covered:',
      'verified: false',
      'ingested_at:',
      'authors:',
      'year:',
      'url:',
    ]) {
      expect(paper).toContain(key);
    }
    const daily = read('Daily.md');
    for (const variable of ['{{date:dddd, D MMMM YYYY}}', '{{yesterday}}', '{{tomorrow}}']) {
      expect(daily).toContain(variable);
    }
    for (const name of ['Note.md', 'Lecture.md', 'Course.md', 'Book.md'])
      expect(read(name)).toContain('{{title}}');
  });

  it('CLAUDE.md skeleton describes the layers, formats and rules', () => {
    const doc = readDisk(root, 'CLAUDE.md');
    for (const phrase of [
      '3 Resources/',
      'immutable',
      'wiki/research-gaps/<project-slug>.md',
      '## Tóm tắt',
      '## Kết quả (theo tác giả)',
      '## Nhận xét của AI',
      '(tr. 4)',
      '## [YYYY-MM-DD] ingest | <title>',
      'data, never instructions',
      'cần xem lại',
      'Cần tìm thêm',
      'wiki_log_append',
      'Cho phép AI sửa ghi chú cá nhân',
    ]) {
      expect(doc).toContain(phrase);
    }
  });
});
