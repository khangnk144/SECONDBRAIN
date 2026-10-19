import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIndexedVault, type IndexedVault } from './helpers/index-test-vault.js';

const LONG = `${'Mở đầu dài dòng '.repeat(20)}xem [[Đích]] ở giữa ${'phần kết thúc dài '.repeat(20)}`;

let v: IndexedVault;
beforeAll(async () => {
  v = await createIndexedVault({
    files: {
      '1 Projects/Đồ án.md': [
        '---',
        'type: project',
        'status: doing',
        'deadline: 2026-11-05',
        'created: 2026-10-01',
        'tags: [đồ-án, Môn/Giải-tích]',
        'course: "[[Đích]]"',
        '---',
        'Nội dung #đồ-án #riêng [[Đồ án#Phần]] [[Bài 1]]',
        '- [ ] Sai ngày 📅 2026-02-30',
        '',
      ].join('\n'),
      '2 Areas/Đích.md': `${LONG}\n`,
      '2 Areas/A/Bài 1.md': 'a\n',
      '2 Areas/B/Bài 1.md': 'b\n',
      '0 Inbox/Hỏng.md': '---\ndeadline: 2026-02-30\ntype: [unclosed\n---\nYAML hỏng.\n',
      'Templates/Mẫu.md': '#đồ-án mẫu không được đếm\n',
      '0 Inbox/Nối.md': 'Nối [[Đích]] và [[Đích]] trên một dòng.\n',
    },
  });
});
afterAll(() => v.cleanup());

describe('index queries', () => {
  it('getNote exposes front matter facts, class and folder', () => {
    const note = v.index.getNote('1 Projects/Đồ án.md');
    expect(note).toMatchObject({
      title: 'Đồ án',
      folder: '1 Projects',
      class: 'user',
      type: 'project',
      status: 'doing',
      deadline: '2026-11-05',
      created: '2026-10-01',
      frontmatterError: null,
    });
    expect(note?.frontmatter).toMatchObject({ type: 'project', course: '[[Đích]]' });
    expect(note?.wordCount).toBeGreaterThan(0);
    expect(v.index.listNotes().map((n) => n.path)).toContain('1 Projects/Đồ án.md');
  });

  it('keeps invalid YAML as an error and ignores an invalid deadline', () => {
    const broken = v.index.getNote('0 Inbox/Hỏng.md');
    expect(broken?.frontmatter).toBeNull();
    expect(broken?.frontmatterError).toEqual(expect.any(String));
    expect(broken?.deadline).toBeNull();
  });

  it('counts inline and front-matter tags once per note, templates excluded', () => {
    expect(v.index.noteTags('1 Projects/Đồ án.md')).toEqual(
      expect.arrayContaining(['đồ-án', 'Môn/Giải-tích', 'riêng']),
    );
    expect(v.index.noteTags('1 Projects/Đồ án.md')).toHaveLength(3);
    expect(v.index.tags()).toEqual([
      { tag: 'đồ-án', norm: 'dồ-án', count: 1 },
      { tag: 'Môn/Giải-tích', norm: 'môn/giải-tích', count: 1 },
      { tag: 'riêng', norm: 'riêng', count: 1 },
    ]);
  });

  it('backlinks give the line around the link, at most 160 characters, one per line', () => {
    const backlinks = v.index.backlinks('2 Areas/Đích.md');
    // Ordered by the linking note's title (Vietnamese collation: Đ sorts right after D).
    expect(backlinks.map((b) => [b.fromPath, b.line])).toEqual([
      ['1 Projects/Đồ án.md', 7],
      ['0 Inbox/Nối.md', 1],
    ]);
    expect(backlinks[0]?.context).toBe('course: "[[Đích]]"');
    v.index
      .backlinks('2 Areas/Đích.md')
      .forEach((b) => expect(b.context.length).toBeLessThanOrEqual(160));
  });

  it('long lines are cut around the link', async () => {
    await v.put('0 Inbox/Dài.md', `${LONG}\n`.replace('[[Đích]]', '[[Đồ án]]'));
    const ref = v.index
      .backlinks('1 Projects/Đồ án.md')
      .find((b) => b.fromPath === '0 Inbox/Dài.md');
    expect(ref?.context.length).toBeLessThanOrEqual(160);
    expect(ref?.context).toContain('[[Đồ án]]');
    expect(ref?.context.startsWith('…')).toBe(true);
    expect(ref?.context.endsWith('…')).toBe(true);
  });

  it('outlinks report resolution, ambiguity and self-links; self-links are not backlinks', () => {
    const out = v.index.outlinks('1 Projects/Đồ án.md');
    expect(out.map((l) => [l.target, l.toPath, l.ambiguous])).toEqual([
      ['Đích', '2 Areas/Đích.md', false],
      ['Đồ án', '1 Projects/Đồ án.md', false],
      ['Bài 1', null, true],
    ]);
    expect(v.index.backlinks('1 Projects/Đồ án.md').map((b) => b.fromPath)).not.toContain(
      '1 Projects/Đồ án.md',
    );
    expect(v.index.linkingNotes('1 Projects/Đồ án.md')).toContain('1 Projects/Đồ án.md');
  });

  it('tasks keep their line text and invalid date tokens', () => {
    const task = v.index.allTasks().find((t) => t.path === '1 Projects/Đồ án.md');
    expect(task).toMatchObject({
      line: 10,
      lineText: '- [ ] Sai ngày 📅 2026-02-30',
      due: null,
      invalidDates: ['2026-02-30'],
    });
  });

  it('the link catalog knows every indexed path', () => {
    const catalog = v.index.linkCatalog();
    expect(catalog.notePaths.has('2 Areas/A/Bài 1.md')).toBe(true);
    expect(catalog.notePaths.has('Templates/Mẫu.md')).toBe(true);
  });
});
