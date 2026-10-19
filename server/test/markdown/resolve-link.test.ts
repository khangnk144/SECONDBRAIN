import { describe, expect, it } from 'vitest';
import { buildLinkCatalog } from '../../src/markdown/link-catalog.js';
import type { LinkCatalog, ParsedLink } from '../../src/markdown/markdown-types.js';
import { resolveLink } from '../../src/markdown/resolve-link.js';

const catalog = buildLinkCatalog([
  '1 Projects/Toán/Bài 1.md',
  '2 Areas/Lý/Bài 1.md',
  '2 Areas/Giải tích 1.md',
  'Bài 2.md',
  '2 Areas/Sub/Bài 2.md',
  'a/x/Bài 4.md',
  'b/y/Bài 4.md',
  'Templates/Course project.md',
  '3 Resources/papers/bài giảng 3.pdf',
  'Attachments/2026-10/ảnh.png',
  'Attachments/2026-11/ảnh.png',
  'Attachments/2026-10/sơ đồ.png',
]);

function resolve(target: string, from = '0 Inbox/Note.md', kind: ParsedLink['kind'] = 'wikilink') {
  return resolveLink(catalog, { kind, target }, from);
}

describe('resolveLink title form (F4.2)', () => {
  it('resolves a unique title case-insensitively', () => {
    expect(resolve('Giải tích 1')).toEqual({ status: 'resolved', path: '2 Areas/Giải tích 1.md' });
    expect(resolve('giải TÍCH 1')).toEqual({ status: 'resolved', path: '2 Areas/Giải tích 1.md' });
    expect(resolve('Giải tích 1.md')).toEqual({
      status: 'resolved',
      path: '2 Areas/Giải tích 1.md',
    });
  });

  it('treats NFD and NFC targets the same', () => {
    expect(resolve('Giải tích 1'.normalize('NFD'))).toEqual(resolve('Giải tích 1'));
  });

  it('prefers the note in the same folder as the linking note', () => {
    expect(resolve('Bài 1', '2 Areas/Lý/Tổng hợp.md')).toEqual({
      status: 'resolved',
      path: '2 Areas/Lý/Bài 1.md',
    });
    expect(resolve('Bài 1', '1 Projects/Toán/x.md')).toEqual({
      status: 'resolved',
      path: '1 Projects/Toán/Bài 1.md',
    });
  });

  it('then prefers the note with the fewest path segments', () => {
    expect(resolve('Bài 2', '0 Inbox/Note.md')).toEqual({ status: 'resolved', path: 'Bài 2.md' });
    expect(resolve('Bài 2', '2 Areas/Sub/x.md')).toEqual({
      status: 'resolved',
      path: '2 Areas/Sub/Bài 2.md',
    });
  });

  it('is ambiguous when still tied, listing every candidate', () => {
    expect(resolve('Bài 1', '0 Inbox/Note.md')).toEqual({
      status: 'ambiguous',
      candidates: ['1 Projects/Toán/Bài 1.md', '2 Areas/Lý/Bài 1.md'],
    });
    expect(resolve('Bài 4')).toMatchObject({ status: 'ambiguous' });
  });

  it('never finds templates by title, but the path form reaches them', () => {
    expect(resolve('Course project')).toEqual({ status: 'ghost' });
    expect(resolve('Templates/Course project')).toEqual({
      status: 'resolved',
      path: 'Templates/Course project.md',
    });
  });

  it('falls back to non-note files by file name with the same tie rules', () => {
    expect(resolve('bài giảng 3.pdf')).toEqual({
      status: 'resolved',
      path: '3 Resources/papers/bài giảng 3.pdf',
    });
    expect(resolve('BÀI GIẢNG 3.PDF')).toMatchObject({ status: 'resolved' });
    expect(resolve('sơ đồ.png', '0 Inbox/x.md', 'embed')).toEqual({
      status: 'resolved',
      path: 'Attachments/2026-10/sơ đồ.png',
    });
    expect(resolve('ảnh.png')).toMatchObject({ status: 'ambiguous' });
    expect(resolve('bài giảng 3')).toEqual({ status: 'ghost' });
  });

  it('resolves an empty target (`[[#Heading]]`) to the linking note and the rest to ghost', () => {
    expect(resolve('', '0 Inbox/Note.md')).toEqual({ status: 'resolved', path: '0 Inbox/Note.md' });
    expect(resolve('Không tồn tại')).toEqual({ status: 'ghost' });
  });
});

describe('resolveLink path form (F4.2)', () => {
  it('resolves vault-relative paths case-insensitively, with or without .md', () => {
    expect(resolve('2 Areas/Giải tích 1')).toEqual({
      status: 'resolved',
      path: '2 Areas/Giải tích 1.md',
    });
    expect(resolve('2 areas/giải tích 1.MD')).toEqual({
      status: 'resolved',
      path: '2 Areas/Giải tích 1.md',
    });
    expect(resolve('3 Resources/papers/bài giảng 3.pdf')).toMatchObject({ status: 'resolved' });
    expect(resolve('/2 Areas/Giải tích 1')).toMatchObject({ status: 'resolved' });
  });

  it('has no fallback to the title when the path is wrong', () => {
    expect(resolve('Sai/Giải tích 1')).toEqual({ status: 'ghost' });
    expect(resolve('3 Resources/papers/bài giảng 3')).toEqual({ status: 'ghost' });
  });

  it('prefers the exact spelling when paths differ only in case (case-sensitive disks)', () => {
    const cased = buildLinkCatalog(['a/Note.md', 'a/note.md']);
    expect(resolveLink(cased, { kind: 'wikilink', target: 'a/note' }, 'x.md')).toEqual({
      status: 'resolved',
      path: 'a/note.md',
    });
    expect(resolveLink(cased, { kind: 'wikilink', target: 'a/NOTE' }, 'x.md')).toMatchObject({
      status: 'ambiguous',
    });
  });
});

describe('resolveLink Markdown links', () => {
  const from = '2 Areas/Lý/Ghi chú.md';
  const md = (target: string) => resolve(target, from, 'markdown');

  it('resolves relative to the linking note, `.md` optional, `..` inside the vault', () => {
    expect(md('Bài 1.md')).toEqual({ status: 'resolved', path: '2 Areas/Lý/Bài 1.md' });
    expect(md('./bài 1')).toEqual({ status: 'resolved', path: '2 Areas/Lý/Bài 1.md' });
    expect(md('../../1 Projects/Toán/Bài 1.md')).toEqual({
      status: 'resolved',
      path: '1 Projects/Toán/Bài 1.md',
    });
    expect(md('../../Attachments/2026-10/ảnh.png')).toEqual({
      status: 'resolved',
      path: 'Attachments/2026-10/ảnh.png',
    });
    expect(md('/Bài 2.md')).toEqual({ status: 'resolved', path: 'Bài 2.md' });
  });

  it('is a ghost when missing or climbing above the vault root', () => {
    expect(md('Không có.md')).toEqual({ status: 'ghost' });
    expect(md('../../../Bài 2.md')).toEqual({ status: 'ghost' });
    expect(md('Giải tích 1.md')).toEqual({ status: 'ghost' });
  });
});

describe('buildLinkCatalog', () => {
  it('splits notes from other files and freezes the catalog', () => {
    expect(catalog.notePaths.has('2 Areas/Giải tích 1.md')).toBe(true);
    expect(catalog.filePaths.has('Attachments/2026-10/ảnh.png')).toBe(true);
    expect(Object.isFrozen(catalog)).toBe(true);
  });

  it('also resolves with a plain catalog object built elsewhere', () => {
    const plain: LinkCatalog = { notePaths: new Set(['x/Bài 9.md']), filePaths: new Set() };
    expect(resolveLink(plain, { kind: 'wikilink', target: 'bài 9' }, 'y.md')).toEqual({
      status: 'resolved',
      path: 'x/Bài 9.md',
    });
  });
});

describe('link identity keeps đ and d apart (F4.2)', () => {
  const vietnamese = buildLinkCatalog(['2 Areas/Đông.md', '0 Inbox/x.md', 'Attachments/Đồ.png']);
  const both = buildLinkCatalog(['2 Areas/Đông.md', '2 Areas/Dông.md', '0 Inbox/x.md']);
  const from = '0 Inbox/x.md';

  it('never resolves `Dông` to `Đông.md` in any form', () => {
    expect(resolveLink(vietnamese, { kind: 'wikilink', target: 'Dông' }, from)).toEqual({
      status: 'ghost',
    });
    expect(resolveLink(vietnamese, { kind: 'wikilink', target: '2 Areas/Dông' }, from)).toEqual({
      status: 'ghost',
    });
    expect(
      resolveLink(vietnamese, { kind: 'markdown', target: '../2 Areas/Dông.md' }, from),
    ).toEqual({ status: 'ghost' });
    expect(resolveLink(vietnamese, { kind: 'embed', target: 'Dồ.png' }, from)).toEqual({
      status: 'ghost',
    });
  });

  it('resolves each spelling to its own note, case-insensitively', () => {
    expect(resolveLink(both, { kind: 'wikilink', target: 'Đông' }, from)).toEqual({
      status: 'resolved',
      path: '2 Areas/Đông.md',
    });
    expect(resolveLink(both, { kind: 'wikilink', target: 'đông' }, from)).toEqual({
      status: 'resolved',
      path: '2 Areas/Đông.md',
    });
    expect(resolveLink(both, { kind: 'wikilink', target: 'dông' }, from)).toEqual({
      status: 'resolved',
      path: '2 Areas/Dông.md',
    });
  });
});
