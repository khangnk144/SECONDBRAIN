import { describe, expect, it } from 'vitest';
import { mdastNoteStructure } from '../../src/markdown/mdast-note-structure.js';
import { parseNote, parseNoteUsing } from '../../src/markdown/parse-note.js';
import { readFixture } from './helpers/markdown-fixtures.js';

const inlineTags = (content: string) =>
  parseNote(content)
    .tags.filter((tag) => tag.source === 'inline')
    .map((tag) => tag.tag);

describe('parseNote inline tags (F6.1, F6.2)', () => {
  it('applies the tag rules', () => {
    const note = parseNote(readFixture('tags-and-tasks.md'));
    const inline = note.tags.filter((tag) => tag.source === 'inline');
    expect(inline.map((tag) => [tag.tag, tag.line])).toEqual([
      ['môn/giải-tích', 6],
      ['đồ-án', 6],
      ['trong-ngoặc', 6],
      ['a', 6],
      ['1a', 6],
      ['việc-con', 23],
    ]);
    expect(inline.find((tag) => tag.tag === 'đồ-án')?.norm).toBe('dồ-án');
  });

  it('ignores URL fragments, link anchors, headings markers, code and HTML', () => {
    expect(inlineTags('https://x.com/#frag https://x.com/a#b [x](#sec) ![i](#p)')).toEqual([]);
    expect(inlineTags('## Heading\n# Title #real ##')).toEqual(['real']);
    expect(inlineTags('`#code` <b title="#html">x</b> #ok')).toEqual(['ok']);
    expect(inlineTags('```\n#fenced\n```\n\n    #indented\n')).toEqual([]);
    expect(inlineTags('#1 #2026 #_ #- x#y #ok/ #a//')).toEqual(['ok', 'a']);
  });

  it('finds no tags inside wikilinks (alias or target)', () => {
    expect(inlineTags('xem [[A|#alias]] [[B| #tag]] [[C #d]] và #thật')).toEqual(['thật']);
    expect(inlineTags('[x](#neo) [[A]] #ok')).toEqual(['ok']);
  });

  it('keeps NFD tags whole and gives them the same comparison key as NFC', () => {
    const [nfd] = parseNote('#môn/giải-tích'.normalize('NFD')).tags;
    const [nfc] = parseNote('#môn/giải-tích').tags;
    expect(nfd?.tag.normalize('NFC')).toBe('môn/giải-tích');
    expect(nfd?.norm).toBe(nfc?.norm);
  });

  it('starts tags after a line start, whitespace or `(`', () => {
    expect(inlineTags('#start\n(#paren) tab\t#tab nbsp\u00A0#nbsp')).toEqual([
      'start',
      'paren',
      'tab',
      'nbsp',
    ]);
  });
});

describe('parseNote tasks (F9.2, F9.3 tokens)', () => {
  const content = readFixture('tags-and-tasks.md');
  const tasks = parseNote(content).tasks;

  it('finds GFM task items for every list marker, nested and in block quotes only', () => {
    expect(tasks.map((task) => task.line)).toEqual([
      11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
    ]);
    expect(tasks.map((task) => task.done)).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
    ]);
  });

  it('strips markers, checkbox and date tokens from the text', () => {
    expect(tasks[0]).toMatchObject({
      text: 'Làm bài tập',
      due: '2026-10-20',
      completed: null,
      invalidDates: [],
    });
    expect(tasks[1]).toMatchObject({
      text: 'Nộp báo cáo',
      due: '2026-10-15',
      completed: '2026-10-14',
    });
    expect(tasks[8]).toMatchObject({ text: 'Biến thể emoji', due: '2026-11-01' });
    expect(tasks[12]?.text).toBe('Lồng trong #việc-con');
  });

  it('ignores impossible dates and reports them', () => {
    expect(tasks[7]).toMatchObject({ text: 'Ngày sai', due: null, invalidDates: ['2026-02-30'] });
  });

  it('gives identical tasks different lines and their exact raw line text', () => {
    const [first, second] = tasks.filter((task) => task.text === 'Hai việc giống nhau');
    expect(first?.line).not.toBe(second?.line);
    const lines = content.split('\n');
    for (const task of tasks) expect(task.lineText).toBe(lines[task.line - 1]);
    expect(tasks[13]?.lineText).toBe('\t- [x] Thụt bằng tab');
    expect(tasks[14]?.lineText).toBe('> - [ ] Trong trích dẫn');
  });

  it('handles tab-indented Obsidian task lists', () => {
    const obsidian = parseNote(readFixture('obsidian-style.md')).tasks;
    expect(
      obsidian.map((task) => [task.line, task.done, task.text, task.due, task.completed]),
    ).toEqual([
      [8, false, 'Việc cha', '2026-10-25', null],
      [9, false, 'Việc con thụt tab', '2026-10-26', null],
      [10, true, 'Cháu', null, '2026-10-20'],
    ]);
  });

  it('requires content after the checkbox and a space before it', () => {
    const parse = (text: string) => parseNote(text).tasks.length;
    expect(parse('- [ ]')).toBe(0);
    expect(parse('- [ ]   ')).toBe(0);
    expect(parse('- [ ]x')).toBe(0);
    expect(parse('- []  x')).toBe(0);
    expect(parse('-[ ] x')).toBe(0);
    expect(parse('[ ] x')).toBe(0);
    expect(parse('- [ ] x\n- [ ]\n  next line')).toBe(2);
  });

  it('ignores date tokens inside inline code and HTML comments on the task line', () => {
    const [code, comment, mixed] = parseNote(
      '- [ ] chạy lệnh `echo 📅 2026-10-20`\n- [ ] việc <!-- 📅 2026-10-20 -->\n- [ ] thật 📅 2026-10-21 `✅ 2026-10-22`\n',
    ).tasks;
    expect(code).toMatchObject({ due: null, text: 'chạy lệnh `echo 📅 2026-10-20`' });
    expect(comment).toMatchObject({ due: null, text: 'việc <!-- 📅 2026-10-20 -->' });
    expect(mixed).toMatchObject({
      due: '2026-10-21',
      completed: null,
      text: 'thật `✅ 2026-10-22`',
    });
  });

  it('ignores date tokens inside wikilinks, embeds and Markdown links on the task line', () => {
    const content = [
      '- [ ] xem [[Họp 📅 2026-10-22]] nhé',
      '- [ ] ảnh ![[Bảng ✅ 2026-10-01.png]]',
      '- [ ] [hạn 📅 2026-10-22](<Đồ án.md>) và ![alt 📅 2026-10-23](a.png)',
      '- [ ] [[Họp 📅 2026-10-22]] thật 📅 2026-10-24',
      '',
    ].join('\n');
    for (const parse of [parseNote, (c: string) => parseNoteUsing(c, mdastNoteStructure)]) {
      const [wikilink, embed, links, real] = parse(content).tasks;
      expect(wikilink).toMatchObject({ due: null, text: 'xem [[Họp 📅 2026-10-22]] nhé' });
      expect(embed).toMatchObject({ completed: null, text: 'ảnh ![[Bảng ✅ 2026-10-01.png]]' });
      expect(links).toMatchObject({ due: null, invalidDates: [] });
      expect(real).toMatchObject({ due: '2026-10-24', text: '[[Họp 📅 2026-10-22]] thật' });
    }
  });

  it('reads task lines with CRLF endings without the line ending', () => {
    const [task] = parseNote('# T\r\n- [ ] Việc 📅 2026-10-20\r\n').tasks;
    expect(task).toMatchObject({
      line: 2,
      lineText: '- [ ] Việc 📅 2026-10-20',
      due: '2026-10-20',
    });
  });
});
