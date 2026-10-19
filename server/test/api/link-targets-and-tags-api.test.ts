import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLASS_RULES, classifyPath, isNotePath } from '../../src/markdown/content-classes.js';
import { parseNote } from '../../src/markdown/parse-note.js';
import { createVaultTestApp, q, snapshotTree, type VaultTestApp } from './vault-test-app.js';

const PORT = 4827;
const FILES: Record<string, string> = {
  '2 Areas/Giải tích/Bài 1.md':
    '---\ntags: [đồ-án, môn/giải-tích]\n---\n#đồ-án và #Đồ-án lần nữa\n',
  '2 Areas/Đại số/Bài 1.md': '#môn/đại-số #đồ-án\n',
  '1 Projects/Đồ án Giải tích.md': '---\ntags:\n  - Đồ-án\n---\n`#không-phải-thẻ` [[Bài 1]]\n',
  '4 Archive/Cũ.md': '#lưu-trữ\n',
  'wiki/concepts/Đạo hàm.md': '#khái-niệm\n',
  'Templates/Mẫu thẻ.md': '#mẫu-không-đếm\n',
  '0 Inbox/Mẫu thẻ.md': 'cùng tên với một mẫu\n',
  'CLAUDE.md': '# Hướng dẫn\n',
  '3 Resources/papers/Bài báo.md': 'tóm tắt #nguồn\n',
  '3 Resources/papers/bài báo.pdf': '%PDF-1.4\n',
  '3 Resources/web/trang.html': '<p>trang</p>',
  'Attachments/2026-10/ảnh 1.png': 'PNG',
};

interface LinkNote {
  path: string;
  title: string;
  folder: string;
  class: string;
  unique: boolean;
}

describe('GET /api/link-targets (F4.1)', () => {
  let t: VaultTestApp;
  beforeAll(async () => {
    t = await createVaultTestApp(PORT, {
      watcher: false,
      seed: (root) => {
        for (const [p, content] of Object.entries(FILES)) {
          mkdirSync(path.dirname(path.join(root, ...p.split('/'))), { recursive: true });
          writeFileSync(path.join(root, ...p.split('/')), content);
        }
      },
    });
  });
  afterAll(async () => t?.close());

  it('lists every note (templates by path only) with folder, class and title uniqueness, and every other file', async () => {
    const res = await t.call('GET', '/api/link-targets');
    expect(res.headers['cache-control']).toBe('no-store');
    const { notes, files } = res.json() as {
      notes: LinkNote[];
      files: { path: string; name: string }[];
    };
    const byPath = new Map(notes.map((note) => [note.path, note]));
    // Templates are listed so `[[Templates/…]]` is not a ghost, but their titles never resolve.
    expect(byPath.get('Templates/Mẫu thẻ.md')).toEqual({
      path: 'Templates/Mẫu thẻ.md',
      title: 'Mẫu thẻ',
      folder: 'Templates',
      class: 'template',
      unique: false,
    });
    expect(byPath.get('0 Inbox/Mẫu thẻ.md')).toMatchObject({ class: 'user', unique: true });
    expect(byPath.get('2 Areas/Giải tích/Bài 1.md')).toEqual({
      path: '2 Areas/Giải tích/Bài 1.md',
      title: 'Bài 1',
      folder: '2 Areas/Giải tích',
      class: 'user',
      unique: false,
    });
    expect(byPath.get('1 Projects/Đồ án Giải tích.md')).toMatchObject({
      unique: true,
      folder: '1 Projects',
    });
    expect(byPath.get('CLAUDE.md')).toMatchObject({ class: 'control', folder: '', unique: true });
    expect(byPath.get('3 Resources/papers/Bài báo.md')).toMatchObject({ class: 'source' });
    expect(byPath.get('4 Archive/Cũ.md')).toMatchObject({ class: 'archived' });
    expect(notes.map((n) => n.path)).toEqual([...notes.map((n) => n.path)].sort());
    expect(files).toEqual(
      expect.arrayContaining([
        { path: '3 Resources/papers/bài báo.pdf', name: 'bài báo.pdf' },
        { path: '3 Resources/web/trang.html', name: 'trang.html' },
        { path: 'Attachments/2026-10/ảnh 1.png', name: 'ảnh 1.png' },
      ]),
    );
    expect(files.some((f) => isNotePath(f.path))).toBe(false);
  });

  it('tag counts: inline and front-matter tags count once per note and match a scan (F6.2)', async () => {
    const { tags } = (await t.call('GET', '/api/tags')).json() as {
      tags: { tag: string; norm: string; count: number }[];
    };
    const expected = new Map<string, number>();
    for (const [p, content] of Object.entries(FILES)) {
      if (!isNotePath(p) || !CLASS_RULES[classifyPath(p)].searchable) continue;
      for (const norm of new Set(parseNote(content).tags.map((tag) => tag.norm))) {
        expected.set(norm, (expected.get(norm) ?? 0) + 1);
      }
    }
    expect(new Map(tags.map((tag) => [tag.norm, tag.count]))).toEqual(expected);
    expect(tags.find((tag) => tag.norm === 'dồ-án')).toMatchObject({ count: 3 });
    // Nested tags are listed as written; the UI nests them by `/`.
    expect(tags.map((tag) => tag.tag)).toEqual(
      expect.arrayContaining(['môn/giải-tích', 'môn/đại-số']),
    );
    expect(tags.some((tag) => tag.tag === 'mẫu-không-đếm' || tag.tag === 'không-phải-thẻ')).toBe(
      false,
    );
  });

  it('the new GET routes never create or change anything (SPEC §5)', async () => {
    const skip = (relative: string) => relative.startsWith('.secondbrain/cache');
    const before = snapshotTree(t.vaultRoot, skip);
    for (const url of [
      '/api/link-targets',
      `/api/note/mentions?${q('2 Areas/Giải tích/Bài 1.md')}`,
      `/api/note/mentions?${q('0 Inbox/Không có.md')}`,
      '/api/tags',
    ]) {
      expect((await t.call('GET', url)).statusCode, url).toBeLessThan(500);
    }
    expect(snapshotTree(t.vaultRoot, skip)).toEqual(before);
  });
});
