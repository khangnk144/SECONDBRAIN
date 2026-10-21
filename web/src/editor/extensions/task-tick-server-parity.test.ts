// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EditorState } from '@tiptap/pm/state';
// The server's one-line task patch (Today, Tasks, Calendar ticks), imported by this test only, so
// the table follows any change to the server's rules.
import { planTaskLinePatch } from '../../../../server/src/markdown/task-line-patch';
import { applyTextPatches } from '../../../../server/src/vault/text-range-patches';
import { findTasks } from '../markdown/__tests__/document-edits';
import { loadMarkdown, saveMarkdownWithSnapshot } from '../markdown/markdown-document';
import { toggleTask } from './task-toggle';

const TODAY = '2026-10-20';

/** The file after the editor ticks (or unticks) task `index` and saves. */
function editorWrites(source: string, index: number, done: boolean) {
  const { doc, snapshot } = loadMarkdown(source);
  const task = findTasks(doc)[index];
  if (!task) throw new Error(`no task ${index} in the editor`);
  const next = toggleTask(EditorState.create({ doc }).tr, task.pos, done, TODAY).doc;
  return saveMarkdownWithSnapshot(next, snapshot);
}

/** The file after a view ticks (or unticks) the task on 1-based `line` through the server. */
function serverWrites(source: string, line: number, done: boolean): string {
  const expectedText = source.split(/\r\n|\n|\r/)[line - 1] as string;
  const { patch } = planTaskLinePatch(source, { line, expectedText }, { done }, TODAY);
  return patch ? applyTextPatches(source, [patch]) : source;
}

type Case = [name: string, source: string, index: number, line: number];

const TICKS: Case[] = [
  ['plain', '- [ ] Đọc chương 3\n', 0, 1],
  ['a due date on the line', '- [ ] Nộp báo cáo 📅 2026-10-22\n', 0, 1],
  ['a due date with U+FE0F', '- [ ] Nộp 📅️ 2026-10-22\n', 0, 1],
  ['an old ✅ at the end gets today', '- [ ] a ✅ 2026-01-01\n', 0, 1],
  ['an old ✅ mid-line is set in place', '- [ ] a ✅ 2026-01-01 more\n', 0, 1],
  ['✅ with U+FE0F is set in place', '- [ ] a ✅️ 2026-01-01\n', 0, 1],
  ['✅ with no blank before its date', '- [ ] a ✅2026-01-01 b\n', 0, 1],
  ['two ✅: only the first is set', '- [ ] a ✅ 2026-01-01 ✅ 2026-01-02\n', 0, 1],
  ['an impossible ✅ date is set in place', '- [ ] a ✅ 2026-02-30\n', 0, 1],
  ['✅ in inline code is not a token', '- [ ] xem `✅ 2026-01-01`\n', 0, 1],
  ['✅ in bold is set in place', '- [ ] a **✅ 2026-01-01**\n', 0, 1],
  ['✅ at the start of the text', '- [ ] ✅ 2026-01-01 rồi\n', 0, 1],
  ['text ending in marks', '- [ ] **bold** and `code`\n', 0, 1],
  ['underline at the end', '- [ ] <u>gạch chân</u>\n', 0, 1],
  ['a wikilink at the end', '- [ ] Xem [[Bài 1]]\n', 0, 1],
  ['a web link at the end', '- [ ] xem [trang](https://example.com)\n', 0, 1],
  ['trailing blanks', '- [ ] a  \n- [ ] b\n', 0, 1],
  ['a trailing tab', '- [ ] a\t\n', 0, 1],
  ['a soft-wrapped task', '- [ ] Nộp _báo cáo_ cho\n  thầy Minh 📅 2026-10-25\n- [ ] khác\n', 0, 1],
  ['a hard break, then plain text', '- [ ] first line\\\n  second line\n', 0, 1],
  ['a hard break in a quote', '> - [ ] Đọc chương 3\\\n>       rồi tóm tắt\n', 0, 1],
  ['a hard break, then a <u> line', '- [ ] Nộp 📅 2026-10-22\\\n      <u>quan trọng</u>\n', 0, 1],
  ['a hard break, then "2."', '- [ ] a\\\n  2. b\n', 0, 1],
  ['soft-wrapped in a quote, CRLF', '> - [ ] Đọc **chương 3**\r\n>   rồi tóm tắt\r\n', 0, 1],
  ['CRLF and a BOM, second task', '﻿- [ ] a\r\n- [ ] b\r\n', 1, 2],
  ['a BOM on the task line', '﻿- [ ] a\r\n', 0, 1],
  ['front matter before', '---\ntype: project\n---\n\n- [ ] a\n', 0, 5],
  ['a nested task', '- [ ] cha\n  - [ ] con\n', 1, 2],
  ['a tab-indented nested task', '- [ ] parent\n\t- [ ] child\n', 1, 2],
  ['`*` bullets in a quote', '> * [ ] Trong trích dẫn\n', 0, 1],
  ['two identical tasks: the second', '- [ ] Giống nhau\n- [ ] Giống nhau\n', 1, 2],
  ['NFD text', '- [ ] Tiếng Việt có dấu\n'.normalize('NFD'), 0, 1],
  ['emoji in the text', '- [ ] Đi chơi 😀👩‍👩‍👧\n', 0, 1],
  ['a ticked task: nothing written', '- [x] a ✅ 2026-10-19\n', 0, 1],
];

const UNTICKS: Case[] = [
  ['✅ at the end', '- [x] a ✅ 2026-10-19\n', 0, 1],
  ['✅ mid-line', '- [x] a ✅ 2026-10-19 more\n', 0, 1],
  ['✅ with U+FE0F', '- [x] a ✅️ 2026-10-19\n', 0, 1],
  ['two ✅', '- [x] a ✅ 2026-10-18 ✅ 2026-10-19\n', 0, 1],
  ['an uppercase X', '- [X] a ✅ 2026-10-19\n', 0, 1],
  ['no token', '- [x] a\n', 0, 1],
  ['✅ before 📅', '- [x] a ✅ 2026-10-19 📅 2026-10-22\n', 0, 1],
  ['a tab before ✅', '- [x] a\t✅ 2026-10-19\n', 0, 1],
  ['✅ in inline code stays', '- [x] a `✅ 2026-10-19`\n', 0, 1],
  ['✅ on the next line stays', '- [x] xong\n  thêm ✅ 2026-10-01\n', 0, 1],
  ['✅ at the start of the text', '- [x] ✅ 2026-10-19 rồi\n', 0, 1],
  ['CRLF', '- [x] a ✅ 2026-10-19\r\n- [ ] b\r\n', 0, 1],
  ['in a quote', '> - [x] Trong trích dẫn ✅ 2026-10-19\n', 0, 1],
  ['a soft-wrapped task', '- [x] Nộp cho ✅ 2026-10-19\n  thầy Minh\n', 0, 1],
  ['a hard break after ✅', '- [x] first ✅ 2026-10-19\\\n  second\n', 0, 1],
  ['blanks before ✅, then a soft break', '- [x] a   ✅ 2026-10-19\n  b\n', 0, 1],
  ['a literal backslash before ✅', '- [x] a\\ ✅ 2026-10-19\n  b\n', 0, 1],
  ['soft-wrapped in a quote', '> - [x] Đọc ✅ 2026-10-19\n>   rồi tóm tắt\n', 0, 1],
  ['an open task with an old ✅', '- [ ] a ✅ 2026-01-01\n', 0, 1],
];

describe('the editor ticks a task exactly as the server does (byte for byte)', () => {
  it.each(TICKS)('tick: %s', (_name, source, index, line) => {
    const editor = editorWrites(source, index, true);
    expect(editor.text).toBe(serverWrites(source, line, true));
    expect(editor.exact).toBe(true);
  });

  it.each(UNTICKS)('untick: %s', (_name, source, index, line) => {
    const editor = editorWrites(source, index, false);
    expect(editor.text).toBe(serverWrites(source, line, false));
    expect(editor.exact).toBe(true);
  });
});
