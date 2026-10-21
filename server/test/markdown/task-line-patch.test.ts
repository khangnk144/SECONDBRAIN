import type { Nodes, Root } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';
import {
  planTaskLinePatch,
  type TaskLineEdit,
  type TaskLinePatch,
} from '../../src/markdown/task-line-patch.js';
import { applyTextPatches } from '../../src/vault/text-range-patches.js';

const TODAY = '2026-10-20';

/** Applies the planned patch to `content` and returns the whole new text. */
function patched(content: string, line: number, edit: TaskLineEdit): string {
  const expectedText = content.split(/\r\n|\n|\r/)[line - 1]!;
  const { patch } = planTaskLinePatch(content, { line, expectedText }, edit, TODAY);
  return patch ? applyTextPatches(content, [patch]) : content;
}

/** The edit applied to a one-line task; returns the new line. */
const onLine = (text: string, edit: TaskLineEdit) => patched(`${text}\n`, 1, edit).slice(0, -1);

const fullParser = unified().use(remarkParse).use(remarkGfm).freeze();
const TOKEN = /[ \t]*(?:\u{1F4C5}|✅)\uFE0F?[ \t]*\d{4}-\d{2}-\d{2}/gu;

/**
 * How the first task paragraph of the whole note renders, by the full parser (not the patcher's
 * own check): node types and values, date tokens left out, so a tick must give the same shape.
 */
function taskParagraphShape(content: string): unknown {
  let item: Nodes | undefined;
  const find = (node: Nodes): void => {
    if (item) return;
    if (node.type === 'listItem' && typeof node.checked === 'boolean') item = node;
    else if ('children' in node) node.children.forEach(find);
  };
  find(fullParser.parse(content) as Root);
  const shape = (node: Nodes): unknown =>
    node.type === 'text'
      ? `text:${node.value.replace(TOKEN, '')}`
      : 'children' in node
        ? { [node.type]: node.children.map(shape) }
        : 'value' in node
          ? `${node.type}:${node.value}`
          : node.type;
  return item && 'children' in item ? item.children.map(shape) : null;
}

/** Every line that differs between two texts (same line count expected). */
function changedLines(before: string, after: string): number[] {
  const a = before.split('\n');
  const b = after.split('\n');
  expect(b.length).toBe(a.length);
  return a.flatMap((line, i) => (line === b[i] ? [] : [i + 1]));
}

describe('ticking a task writes what the editor writes (F9.1)', () => {
  it.each([
    ['- [ ] Viết báo cáo 📅 2026-10-22', '- [x] Viết báo cáo 📅 2026-10-22 ✅ 2026-10-20'],
    ['* [ ] Sao', '* [x] Sao ✅ 2026-10-20'],
    ['1. [ ] Một', '1. [x] Một ✅ 2026-10-20'],
    ['> - [ ] Trong trích dẫn', '> - [x] Trong trích dẫn ✅ 2026-10-20'],
    ['- [ ] Dấu cách cuối   ', '- [x] Dấu cách cuối ✅ 2026-10-20   '],
    ['- [ ] run `x`', '- [x] run `x` ✅ 2026-10-20'],
    ['- [ ] <u>quan trọng</u>', '- [x] <u>quan trọng</u> ✅ 2026-10-20'],
    ['- [ ] cũ ✅ 2026-01-01 #thẻ', '- [x] cũ ✅ 2026-10-20 #thẻ'],
    ['- [ ] chỉ `✅ 2026-01-01` trong code', '- [x] chỉ `✅ 2026-01-01` trong code ✅ 2026-10-20'],
    ['- [ ] a\\', '- [x] a\\ ✅ 2026-10-20'],
  ])('%s', (line, expected) => {
    expect(onLine(line, { done: true })).toBe(expected);
  });

  it('puts the token before a hard break so the next line stays a continuation', () => {
    expect(patched('- [ ] a  \n  b\n', 1, { done: true })).toBe('- [x] a ✅ 2026-10-20  \n  b\n');
    expect(patched('- [ ] a\\\n  b\n', 1, { done: true })).toBe('- [x] a ✅ 2026-10-20\\\n  b\n');
  });

  it('a task that is already ticked is left as it is', () => {
    const text = '- [x] Xong ✅ 2026-10-01\n';
    expect(
      planTaskLinePatch(text, { line: 1, expectedText: text.trim() }, { done: true }, TODAY),
    ).toEqual({ patch: null, lineText: '- [x] Xong ✅ 2026-10-01' } satisfies TaskLinePatch);
  });

  it.each([
    ['- [x] Đọc đề ✅ 2026-10-20', '- [ ] Đọc đề'],
    ['- [X] Hoa ✅ 2026-10-20 #thẻ', '- [ ] Hoa #thẻ'],
    ['- [x] Không ngày', '- [ ] Không ngày'],
    ['- [x] Hai lần ✅ 2026-10-19 rồi ✅ 2026-10-20', '- [ ] Hai lần rồi'],
  ])('unticking %s removes the ✅ token', (line, expected) => {
    expect(onLine(line, { done: false })).toBe(expected);
  });
});

describe('the task paragraph renders as before: hard breaks, quotes, HTML (F9.1, §4.9)', () => {
  it.each([
    [
      'backslash break in a quote',
      '> - [ ] Đọc chương 3\\\n>       rồi tóm tắt\n',
      { done: true },
      '> - [x] Đọc chương 3 ✅ 2026-10-20\\',
    ],
    [
      'backslash break before an underlined line',
      '- [ ] Nộp báo cáo 📅 2026-10-22\\\n      <u>quan trọng</u>\n',
      { done: true },
      '- [x] Nộp báo cáo 📅 2026-10-22 ✅ 2026-10-20\\',
    ],
    [
      'backslash break before a <span> line',
      '- [ ] a\\\n  <span>b</span> c\n',
      { done: true },
      '- [x] a ✅ 2026-10-20\\',
    ],
    [
      'backslash break before "2. b" (cannot start a list)',
      '- [ ] a\\\n  2. b\n',
      { done: true },
      '- [x] a ✅ 2026-10-20\\',
    ],
    [
      'backslash break before a lazy line',
      '- [ ] a\\\nb\n',
      { done: true },
      '- [x] a ✅ 2026-10-20\\',
    ],
    [
      'due date set before a backslash break',
      '- [ ] a\\\n  <u>b</u>\n',
      { due: '2026-10-25' },
      '- [ ] a 📅 2026-10-25\\',
    ],
    [
      'untick: blanks before ✅ go with it',
      '- [x] a   ✅ 2026-10-19\n  b\n',
      { done: false },
      '- [ ] a',
    ],
    [
      'due removed: blanks before 📅 go with it',
      '- [ ] a   📅 2026-10-22\n  b\n',
      { due: null },
      '- [ ] a',
    ],
    [
      'due removed: a hard break by two spaces stays',
      '- [ ] a 📅 2026-10-22  \n  b\n',
      { due: null },
      '- [ ] a  ',
    ],
    [
      'untick before a backslash break',
      '- [x] a   ✅ 2026-10-19\\\n  b\n',
      { done: false },
      '- [ ] a\\',
    ],
    [
      'untick after a literal backslash keeps it literal',
      '- [x] a\\ ✅ 2026-10-20\n  <u>b</u>\n',
      { done: false },
      '- [ ] a\\ ',
    ],
  ] as const)('%s', (_label, content, edit, firstLine) => {
    const out = patched(content, 1, edit);
    const [line, ...rest] = out.split('\n');
    expect(line).toBe(firstLine);
    expect(rest).toEqual(content.split('\n').slice(1));
    expect(taskParagraphShape(out)).toEqual(taskParagraphShape(content));
  });

  it.each([
    '- [ ] a \\\n',
    '- [ ] a\\\n',
    '- [ ] a\\\n  <u>b</u>\n',
    '- [ ] a\\\\\n  b\n',
    '- [ ] a  \n  b\n',
    '- [ ] a   \n',
    '> - [ ] Đọc chương 3\\\n>       rồi tóm tắt\n',
    '- [ ]\n  b\n',
    '- [ ] a 📅 2026-10-22\\\n  b\n',
  ])('tick then untick gives back the original bytes: %j', (content) => {
    const ticked = patched(content, 1, { done: true });
    expect(ticked).not.toBe(content);
    expect(patched(ticked, 1, { done: false })).toBe(content);
    const dated = patched(content, 1, { due: '2026-10-30' });
    expect(patched(dated, 1, { due: null })).toBe(
      content.includes('📅') ? content.replace(' 📅 2026-10-22', '') : content,
    );
  });

  it('refuses a token that would change how the paragraph renders', () => {
    // The end of the first line is inside a reference link label that goes on to the next line.
    const text = '- [ ] xem [đề\n  cương] nhé\n\n[đề cương]: https://example.com\n';
    expect(() =>
      planTaskLinePatch(text, { line: 1, expectedText: '- [ ] xem [đề' }, { done: true }, TODAY),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION', details: { reason: 'patch-verify' } }));
  });
});

describe('due dates change in place (F11.2)', () => {
  it.each([
    ['- [ ] a 📅 2026-10-22 #t', '- [ ] a 📅 2026-10-25 #t'],
    ['- [ ] a 📅️2026-02-30', '- [ ] a 📅️2026-10-25'],
    ['- [ ] a', '- [ ] a 📅 2026-10-25'],
    ['- [x] a ✅ 2026-10-19', '- [x] a 📅 2026-10-25 ✅ 2026-10-19'],
    ['- [ ] `📅 2026-10-22` x', '- [ ] `📅 2026-10-22` x 📅 2026-10-25'],
    ['- [ ] <u>gạch</u>', '- [ ] <u>gạch</u> 📅 2026-10-25'],
    // Only the token the index reads moves: not one inside a link, not an invalid one before it.
    ['- [ ] xem [[Họp 📅 2026-10-22]] nhé', '- [ ] xem [[Họp 📅 2026-10-22]] nhé 📅 2026-10-25'],
    ['- [ ] [hạn 📅 2026-10-22](x.md) a', '- [ ] [hạn 📅 2026-10-22](x.md) a 📅 2026-10-25'],
    ['- [ ] [[Họp 📅 2026-10-22]] 📅 2026-10-23', '- [ ] [[Họp 📅 2026-10-22]] 📅 2026-10-25'],
    ['- [ ] a 📅 2026-02-30 b 📅 2026-10-22', '- [ ] a 📅 2026-02-30 b 📅 2026-10-25'],
  ])('set on %s', (line, expected) => {
    expect(onLine(line, { due: '2026-10-25' })).toBe(expected);
  });

  it.each([
    ['- [ ] a 📅 2026-10-22 #t', '- [ ] a #t'],
    ['- [ ] a 📅 2026-10-22 ✅ 2026-10-20', '- [ ] a ✅ 2026-10-20'],
    ['- [ ] a', '- [ ] a'],
    ['- [ ] [[Họp 📅 2026-10-22]] 📅 2026-10-23', '- [ ] [[Họp 📅 2026-10-22]]'],
  ])('removed from %s', (line, expected) => {
    expect(onLine(line, { due: null })).toBe(expected);
  });
});

describe('only that line changes', () => {
  const NOTE = [
    '---',
    'type: project',
    '---',
    '# Đồ án',
    '- [ ] Giống nhau',
    '- [ ] Giống nhau',
    '',
    'Đoạn *khác* _giữ nguyên_  ',
  ].join('\n');

  it('two identical tasks tick independently, by line (F9.2)', () => {
    const second = patched(NOTE, 6, { done: true });
    expect(changedLines(NOTE, second)).toEqual([6]);
    const first = patched(second, 5, { done: true });
    expect(changedLines(second, first)).toEqual([5]);
  });

  it('keeps CRLF line endings and a BOM', () => {
    const crlf = `\uFEFF${NOTE.split('\n').join('\r\n')}\r\n`;
    const out = patched(crlf, 6, { done: true });
    expect(out).toBe(
      crlf.replace('- [ ] Giống nhau\r\n\r\n', `- [x] Giống nhau ✅ ${TODAY}\r\n\r\n`),
    );
    expect(out.startsWith('\uFEFF---\r\n')).toBe(true);
    expect(patched(out, 6, { due: '2026-10-30' })).toContain(
      `- [x] Giống nhau 📅 2026-10-30 ✅ ${TODAY}\r\n`,
    );
  });

  it('keeps NFD text byte for byte', () => {
    const nfd = '- [ ] Việc tiếng Việt 📅 2026-10-22\n'.normalize('NFD');
    const out = patched(nfd, 1, { done: true });
    expect(out).toBe(`${nfd.slice(0, -1).replace('[ ]', '[x]')} ✅ ${TODAY}\n`);
    expect(out.normalize('NFD')).toBe(out);
  });
});

describe('refusals', () => {
  const plan = (content: string, line: number, expectedText: string, edit: TaskLineEdit) => () =>
    planTaskLinePatch(content, { line, expectedText }, edit, TODAY);

  it('a line that no longer reads as expected is a conflict', () => {
    const text = '- [ ] a\n- [ ] b\n';
    for (const [line, expected, current] of [
      [1, '- [ ] b', '- [ ] a'],
      [9, '- [ ] a', null],
    ] as const) {
      expect(plan(text, line, expected, { done: true })).toThrow(
        expect.objectContaining({
          code: 'CONFLICT',
          details: { reason: 'line-changed', line, currentText: current },
        }),
      );
    }
  });

  it.each([
    ['a paragraph', 'Chỉ là chữ\n', 1],
    ['a task in a code block', '```\n- [ ] trong code\n```\n', 2],
    ['a list item without checkbox', '- việc\n', 1],
    ['front matter', '---\ntitle: - [ ] x\n---\n', 2],
  ])('%s is not a task', (_label, text, line) => {
    expect(plan(text, line, text.split('\n')[line - 1]!, { done: true })).toThrow(
      expect.objectContaining({ code: 'VALIDATION', details: { reason: 'not-a-task' } }),
    );
  });

  it('an edit that would stop the line being a task is refused, not written', () => {
    expect(plan('- [x] ✅ 2026-10-19\n', 1, '- [x] ✅ 2026-10-19', { done: false })).toThrow(
      expect.objectContaining({ details: { reason: 'patch-verify' } }),
    );
  });
});
