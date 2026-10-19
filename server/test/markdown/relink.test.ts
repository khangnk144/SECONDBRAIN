import { describe, expect, it } from 'vitest';
import { buildLinkCatalog } from '../../src/markdown/link-catalog.js';
import { planRelinkEdits, type RelinkInput } from '../../src/markdown/relink.js';
import { VaultError } from '../../src/vault/vault-types.js';

const A = '2 Areas/Toán/Bài 1.md';
const B = '2 Areas/Lý/Bài 1.md';

const TOAN_SUMMARY = [
  '---',
  'course: "[[Bài 1]]" # khoá học',
  '---',
  'Xem [[Bài 1]], [[Bài 1|bài một]], [[Bài 1#Ý chính]], ![[Bài 1]] và [[2 Areas/Toán/Bài 1]].',
  '| Bảng | [[Bài 1\\|trong bảng]] |',
  '| --- | --- |',
  'Mã `[[Bài 1]]` và [md](Bài%201.md).',
  '```',
  '[[Bài 1]]',
  '```',
  '',
].join('\r\n');

const FILES: Record<string, string> = {
  [A]: '# Bài 1\n\nTự liên kết [[Bài 1#Phần 2]] và [[#Phần 2]].\n',
  [B]: '# Bài 1 (Lý)\n',
  '2 Areas/Toán/Tổng hợp.md': TOAN_SUMMARY,
  '2 Areas/Lý/Tổng hợp.md': 'Lý: [[Bài 1]] và [[2 Areas/Lý/Bài 1]].\n',
  '0 Inbox/Mơ hồ.md': 'Không rõ: [[Bài 1]].\n',
  'Gốc.md': 'Đường dẫn [[2 Areas/Toán/Bài 1|Toán]].\n',
  '2 Areas/Giải tích 1.md': 'x\n',
  '0 Inbox/Giải tích ghi chú.md': 'Môn [[Giải tích 1]].\n',
};

function input(op: RelinkInput['op'], files = FILES): RelinkInput {
  return {
    op,
    catalog: buildLinkCatalog(Object.keys(files)),
    candidates: Object.keys(files),
    readNote: async (path) => {
      const content = files[path];
      if (content === undefined) throw new VaultError('NOT_FOUND', 'missing', { path });
      return { content, revision: `rev:${path}` };
    },
  };
}

describe('planRelinkEdits on rename (F4.3)', () => {
  it('rewrites only links that resolved to the renamed note, as minimal span edits', async () => {
    const to = '2 Areas/Toán/Bài 1 - Đạo hàm.md';
    const edits = await planRelinkEdits(input({ kind: 'rename', from: A, to }));
    expect(edits.map((edit) => edit.path).sort()).toEqual([
      '2 Areas/Toán/Bài 1.md',
      '2 Areas/Toán/Tổng hợp.md',
      'Gốc.md',
    ]);
    for (const edit of edits) expect(edit.expectedRevision).toBe(`rev:${edit.path}`);

    const summary = edits.find((edit) => edit.path === '2 Areas/Toán/Tổng hợp.md');
    const expected = TOAN_SUMMARY.replace('course: "[[Bài 1]]"', 'course: "[[Bài 1 - Đạo hàm]]"')
      .replace(
        'Xem [[Bài 1]], [[Bài 1|bài một]], [[Bài 1#Ý chính]], ![[Bài 1]] và [[2 Areas/Toán/Bài 1]].',
        'Xem [[Bài 1 - Đạo hàm]], [[Bài 1 - Đạo hàm|bài một]], [[Bài 1 - Đạo hàm#Ý chính]], ![[Bài 1 - Đạo hàm]] và [[2 Areas/Toán/Bài 1 - Đạo hàm]].',
      )
      .replace('[[Bài 1\\|trong bảng]]', '[[Bài 1 - Đạo hàm\\|trong bảng]]');
    // Code, the Markdown link and the CRLF line endings stay byte-identical.
    expect(summary?.newContent).toBe(expected);

    const self = edits.find((edit) => edit.path === A);
    expect(self?.newContent).toBe(
      '# Bài 1\n\nTự liên kết [[Bài 1 - Đạo hàm#Phần 2]] và [[#Phần 2]].\n',
    );
    expect(edits.find((edit) => edit.path === 'Gốc.md')?.newContent).toBe(
      'Đường dẫn [[2 Areas/Toán/Bài 1 - Đạo hàm|Toán]].\n',
    );
  });

  it('leaves the other course and ambiguous links untouched', async () => {
    const edits = await planRelinkEdits(
      input({ kind: 'rename', from: A, to: '2 Areas/Toán/Bài mới.md' }),
    );
    const paths = edits.map((edit) => edit.path);
    expect(paths).not.toContain('2 Areas/Lý/Tổng hợp.md');
    expect(paths).not.toContain('0 Inbox/Mơ hồ.md');
    expect(paths).not.toContain(B);
  });

  it('uses the path form when the new title would not resolve to the renamed note', async () => {
    // The new title "Khác" also names a note in the summary's own folder, so from there the
    // title form would point at that note instead.
    const files = {
      ...FILES,
      '2 Areas/Toán/Tổng hợp.md': 'Xem [[Bài 1]].\n',
      '2 Areas/Toán/Khác.md': 'x\n',
    };
    const edits = await planRelinkEdits(
      input({ kind: 'rename', from: A, to: '2 Areas/Hoá/Khác.md' }, files),
    );
    const summary = edits.find((edit) => edit.path === '2 Areas/Toán/Tổng hợp.md');
    expect(summary?.newContent).toBe('Xem [[2 Areas/Hoá/Khác]].\n');
  });

  it('skips candidates deleted since they were indexed, but surfaces other read errors', async () => {
    const base = input({ kind: 'rename', from: A, to: '2 Areas/Toán/X.md' });
    const edits = await planRelinkEdits({ ...base, candidates: [...base.candidates, 'gone.md'] });
    expect(edits.length).toBeGreaterThan(0);
    const failing: RelinkInput = {
      ...base,
      readNote: async () => Promise.reject(new Error('EIO')),
    };
    await expect(planRelinkEdits(failing)).rejects.toThrow('EIO');
  });
});

describe('planRelinkEdits on move (F4.4)', () => {
  it('keeps title links that still resolve to the moved note', async () => {
    const edits = await planRelinkEdits(
      input({ kind: 'move', from: '2 Areas/Giải tích 1.md', to: '4 Archive/Giải tích 1.md' }),
    );
    expect(edits.map((edit) => edit.path)).toEqual([]);
  });

  it('converts title links to the path form where the move would change their target', async () => {
    const to = '4 Archive/Cũ/Môn/Bài 1.md';
    const edits = await planRelinkEdits(input({ kind: 'move', from: A, to }));
    const summary = edits.find((edit) => edit.path === '2 Areas/Toán/Tổng hợp.md');
    // From the summary, "Bài 1" would now pick B (fewer segments), so the path form is used.
    expect(summary?.newContent).toContain(
      'Xem [[4 Archive/Cũ/Môn/Bài 1]], [[4 Archive/Cũ/Môn/Bài 1|bài một]]',
    );
    expect(summary?.newContent).toContain('course: "[[4 Archive/Cũ/Môn/Bài 1]]"');
    expect(summary?.newContent).toContain('Mã `[[Bài 1]]`');
    // The moved note's own self-link resolves to itself again from its new folder.
    expect(edits.find((edit) => edit.path === A)).toBeUndefined();
  });
});
