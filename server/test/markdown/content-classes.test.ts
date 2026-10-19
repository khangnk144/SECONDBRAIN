import { describe, expect, it } from 'vitest';
import { isValidCalendarDate } from '../../src/markdown/calendar-date.js';
import {
  CLASS_RULES,
  classifyPath,
  isNotePath,
  noteTitleFromPath,
  topFolderOfPath,
} from '../../src/markdown/content-classes.js';
import type { ContentClass } from '../../src/markdown/markdown-types.js';

describe('classifyPath follows the content-class table (F9.4)', () => {
  const cases: [string, ContentClass][] = [
    ['0 Inbox/Ý tưởng.md', 'user'],
    ['1 Projects/Đồ án giải tích.md', 'user'],
    ['2 Areas/Toán/Giải tích 1.md', 'user'],
    ['Daily/2026-10-18.md', 'user'],
    ['Ghi chú gốc.md', 'user'],
    ['Thư mục riêng/Note.md', 'user'],
    ['CLAUDE.md', 'control'],
    ['claude.md', 'control'],
    ['wiki/index.md', 'control'],
    ['wiki/log.md', 'control'],
    ['wiki/Index.MD', 'control'],
    ['wiki/concepts/index.md', 'wiki'],
    ['wiki/concepts/Giới hạn.md', 'wiki'],
    ['4 Archive/Dự án cũ.md', 'archived'],
    ['Templates/Course project.md', 'template'],
    ['templates/Daily.md', 'template'],
    ['3 Resources/papers/bài báo.pdf', 'source'],
    ['3 Resources/web/trang.md', 'source'],
    ['3 resources/web/trang.html', 'source'],
    ['Attachments/2026-10/ảnh.png', 'attachment'],
    ['Attachments/ghi chú.md', 'attachment'],
    ['1 Projects/bản vẽ.pdf', 'attachment'],
    ['ảnh gốc.png', 'attachment'],
    ['4 Archive/scan.jpg', 'attachment'],
  ];
  for (const [path, expected] of cases) {
    it(`${path} → ${expected}`, () => expect(classifyPath(path)).toBe(expected));
  }

  it('compares the top folder after NFC, so NFD folder names classify the same', () => {
    expect(classifyPath('Templates/Bài giảng.md'.normalize('NFD'))).toBe('template');
    expect(classifyPath('4 Archive/Đồ án.md'.normalize('NFD'))).toBe('archived');
  });
});

describe('CLASS_RULES', () => {
  it('mirrors the SPEC table', () => {
    expect(CLASS_RULES.user).toEqual({
      searchable: true,
      tasksCounted: true,
      graphNode: 'yes',
      reminders: true,
    });
    expect(CLASS_RULES.archived).toMatchObject({
      searchable: true,
      tasksCounted: false,
      graphNode: 'dimmed',
    });
    expect(CLASS_RULES.template).toMatchObject({
      searchable: false,
      tasksCounted: false,
      graphNode: 'no',
    });
    expect(CLASS_RULES.source).toMatchObject({
      searchable: true,
      tasksCounted: false,
      graphNode: 'linked-only',
    });
    expect(CLASS_RULES.wiki).toMatchObject({
      searchable: true,
      tasksCounted: false,
      graphNode: 'yes',
    });
    expect(CLASS_RULES.control).toMatchObject({
      searchable: true,
      tasksCounted: false,
      graphNode: 'no',
    });
    expect(CLASS_RULES.attachment).toMatchObject({ searchable: false, graphNode: 'linked-only' });
  });

  it('only user notes are counted for tasks and reminders', () => {
    const counted = Object.entries(CLASS_RULES).filter(([, rule]) => rule.tasksCounted);
    const reminded = Object.entries(CLASS_RULES).filter(([, rule]) => rule.reminders);
    expect(counted.map(([name]) => name)).toEqual(['user']);
    expect(reminded.map(([name]) => name)).toEqual(['user']);
  });
});

describe('note paths and titles', () => {
  it('isNotePath accepts .md in any case only', () => {
    expect(isNotePath('a/Bài 1.md')).toBe(true);
    expect(isNotePath('a/README.MD')).toBe(true);
    expect(isNotePath('a/bài giảng 3.pdf')).toBe(false);
    expect(isNotePath('a/notes.md.txt')).toBe(false);
  });

  it('noteTitleFromPath is the file name without .md', () => {
    expect(noteTitleFromPath('2 Areas/Toán/Giải tích 1.md')).toBe('Giải tích 1');
    expect(noteTitleFromPath('Gốc.MD')).toBe('Gốc');
    expect(noteTitleFromPath('3 Resources/bài giảng 3.pdf')).toBe('bài giảng 3.pdf');
  });

  it('topFolderOfPath is the first segment', () => {
    expect(topFolderOfPath('2 Areas/Toán/Bài 1.md')).toBe('2 Areas');
    expect(topFolderOfPath('Gốc.md')).toBe('');
  });
});

describe('isValidCalendarDate', () => {
  it('accepts real calendar days with years 1000–9999 and rejects the rest', () => {
    for (const ok of ['2026-10-18', '2028-02-29', '2000-02-29', '1000-01-01', '9999-12-31']) {
      expect(isValidCalendarDate(ok)).toBe(true);
    }
    for (const bad of [
      '2026-02-30',
      '2026-02-29',
      '1900-02-29',
      '2026-13-01',
      '2026-00-10',
      '2026-04-31',
      '2026-1-5',
      '26-10-18',
      '2026-10-18T00:00',
      '',
      '0000-02-29',
      '0999-12-31',
      '0000-01-01',
    ]) {
      expect(isValidCalendarDate(bad)).toBe(false);
    }
  });
});
