import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseNote } from '../../src/markdown/parse-note.js';
import {
  createIndexedVault,
  titles,
  type IndexedVault,
} from '../index/helpers/index-test-vault.js';

const NOTE = [
  '# Tiêu đề <u>gạch chân</u>',
  '',
  'Một <u>đoạn #thẻ-một và [[Liên kết]] giữa</u> câu.',
  '<u>#đầu-dòng</u> rồi <u>[[Đầu dòng]]</u>, (<u>#trong-ngoặc</u>)',
  'chữ<u>#không-phải-thẻ</u> và <u>a</u>#cũng-không',
  '',
  '- [ ] Việc <u>quan trọng</u> 📅 2026-10-22',
  '- [x] <u>#xong</u> ✅ 2026-10-19',
  '- [ ] Chạy `lệnh` 📅 2026-10-23',
  '',
].join('\n');

describe('underline <u>…</u> keeps text, tags, links and tasks (DECISIONS M3 underline)', () => {
  const parsed = parseNote(NOTE);

  it('text inside <u> is part of the searchable plain text, without the tags', () => {
    expect(parsed.plainText).toContain('Tiêu đề gạch chân');
    expect(parsed.plainText).toContain('Một đoạn #thẻ-một và Liên kết giữa câu.');
    expect(parsed.plainText).not.toContain('<u>');
  });

  it('#tags and [[links]] inside <u> count, also right after the opening tag', () => {
    expect(parsed.tags.map((t) => t.tag)).toEqual(['thẻ-một', 'đầu-dòng', 'trong-ngoặc', 'xong']);
    expect(parsed.links.map((l) => l.target)).toEqual(['Liên kết', 'Đầu dòng']);
  });

  it('task lines with <u> or code keep their whole text and their dates', () => {
    expect(
      parsed.tasks.map(({ text, done, due, completed }) => ({ text, done, due, completed })),
    ).toEqual([
      { text: 'Việc <u>quan trọng</u>', done: false, due: '2026-10-22', completed: null },
      { text: '<u>#xong</u>', done: true, due: null, completed: '2026-10-19' },
      { text: 'Chạy `lệnh`', done: false, due: '2026-10-23', completed: null },
    ]);
  });
});

describe('underlined words are found by search', () => {
  let v: IndexedVault;
  beforeAll(async () => {
    v = await createIndexedVault({ files: { '0 Inbox/Gạch chân.md': NOTE } });
  });
  afterAll(() => v.cleanup());

  it('finds a word only written inside <u> and filters by a tag right after <u>', () => {
    // The vault's own CLAUDE.md (a searchable control doc) also holds "liên quan" and
    // "khoảng trống"; only the user note matters here.
    const notes = v.index.search({ q: 'quan trong' }).filter((r) => r.class !== 'control');
    expect(titles(notes)).toEqual(['Gạch chân']);
    expect(titles(v.index.search({ q: 'tag:đầu-dòng' }))).toEqual(['Gạch chân']);
  });
});
