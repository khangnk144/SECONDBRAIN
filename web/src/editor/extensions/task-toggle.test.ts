// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { findTasks } from '../markdown/__tests__/document-edits';
import {
  loadMarkdown,
  saveMarkdown,
  saveMarkdownWithSnapshot,
} from '../markdown/markdown-document';
import { toggleTask } from './task-toggle';

const TODAY = '2026-10-19';

function toggle(doc: ProseMirrorNode, index: number, checked: boolean): ProseMirrorNode {
  const task = findTasks(doc)[index]!;
  return toggleTask(EditorState.create({ doc }).tr, task.pos, checked, TODAY).doc;
}

/** Ticks task `index`, saves, unticks the result and saves again. */
function tickAndUntick(source: string, index = 0) {
  const { doc, snapshot } = loadMarkdown(source);
  const tickedDoc = toggle(doc, index, true);
  const ticked = saveMarkdownWithSnapshot(tickedDoc, snapshot);
  const unticked = saveMarkdown(toggle(tickedDoc, index, false), ticked.snapshot);
  return { ticked, unticked };
}

describe('toggleTask: done token on the first source line', () => {
  it('puts the done token at the end of the first line of a soft-wrapped task', () => {
    const source = '- [ ] Nộp _báo cáo_ cho\n  thầy Minh 📅 2026-10-25\n- [ ] khác\n';
    const { ticked, unticked } = tickAndUntick(source);
    expect(ticked.text).toBe(
      '- [x] Nộp _báo cáo_ cho ✅ 2026-10-19\n  thầy Minh 📅 2026-10-25\n- [ ] khác\n',
    );
    expect(ticked.exact).toBe(true);
    expect(unticked).toBe(source);
  });

  it('keeps CRLF line ends and a quote prefix on a soft-wrapped task', () => {
    const source = '> - [ ] Đọc **chương 3**\r\n>   rồi tóm tắt\r\n';
    const { ticked, unticked } = tickAndUntick(source);
    expect(ticked.text).toBe('> - [x] Đọc **chương 3** ✅ 2026-10-19\r\n>   rồi tóm tắt\r\n');
    expect(unticked).toBe(source);
  });

  it('puts the done token before a hard break', () => {
    const source = '- [ ] first line\\\n  second line\n';
    const { ticked, unticked } = tickAndUntick(source);
    expect(ticked.text).toBe('- [x] first line ✅ 2026-10-19\\\n  second line\n');
    expect(unticked).toBe(source);
  });

  it('unticking removes the token ending the first line, not one further down', () => {
    const { doc, snapshot } = loadMarkdown('- [x] done task ✅ 2026-10-01\n  more text\n');
    expect(saveMarkdown(toggle(doc, 0, false), snapshot)).toBe('- [ ] done task\n  more text\n');
    const later = loadMarkdown('- [x] done task\n  more ✅ 2026-10-01\n');
    expect(saveMarkdown(toggle(later.doc, 0, false), later.snapshot)).toBe(
      '- [ ] done task\n  more ✅ 2026-10-01\n',
    );
  });

  it('adds no second token to a task whose first line already has one: its date becomes today', () => {
    const { doc, snapshot } = loadMarkdown('- [ ] task ✅ 2026-10-01\n  more\n');
    expect(saveMarkdown(toggle(doc, 0, true), snapshot)).toBe('- [x] task ✅ 2026-10-19\n  more\n');
  });

  it('writes the token as plain text after marked text', () => {
    const { ticked } = tickAndUntick('- [ ] **bold** and `code`\n');
    expect(ticked.text).toBe('- [x] **bold** and `code` ✅ 2026-10-19\n');
  });
});

describe('toggleTask: the server’s token rules', () => {
  /** Toggles task 0 of `source` and saves; `exact` must hold (a one-line text patch). */
  const write = (source: string, checked: boolean) => {
    const { doc, snapshot } = loadMarkdown(source);
    const saved = saveMarkdownWithSnapshot(toggle(doc, 0, checked), snapshot);
    expect(saved.exact).toBe(true);
    return saved.text;
  };

  it('a tick sets the first ✅ token in place, U+FE0F and blanks normalised', () => {
    expect(write('- [ ] a ✅ 2026-01-01 more\n', true)).toBe('- [x] a ✅ 2026-10-19 more\n');
    expect(write('- [ ] a ✅️  2026-01-01\n', true)).toBe('- [x] a ✅ 2026-10-19\n');
    expect(write('- [ ] a ✅ 2026-01-01 ✅ 2026-01-02\n', true)).toBe(
      '- [x] a ✅ 2026-10-19 ✅ 2026-01-02\n',
    );
    expect(write('- [ ] a **✅ 2026-01-01** b\n', true)).toBe('- [x] a **✅ 2026-10-19** b\n');
  });

  it('an untick removes every ✅ token of the first line with the blanks before it', () => {
    expect(write('- [x] a ✅ 2026-10-18 more ✅️ 2026-10-19\n', false)).toBe('- [ ] a more\n');
    expect(write('- [x] a  ✅ 2026-10-19 📅 2026-10-22\n', false)).toBe('- [ ] a 📅 2026-10-22\n');
    expect(write('- [x] ✅ 2026-10-19 rồi\n', false)).toBe('- [ ] rồi\n');
  });

  it('a ✅ in inline code or link text is no token', () => {
    expect(write('- [x] a `✅ 2026-10-19`\n', false)).toBe('- [ ] a `✅ 2026-10-19`\n');
    expect(write('- [ ] [✅ 2026-01-01](https://example.com)\n', true)).toBe(
      '- [x] [✅ 2026-01-01](https://example.com) ✅ 2026-10-19\n',
    );
  });

  it('ticking a ticked task changes nothing; unticking an open one still removes its token', () => {
    const { doc } = loadMarkdown('- [x] a ✅ 2026-10-01\n');
    const task = findTasks(doc)[0]!;
    expect(toggleTask(EditorState.create({ doc }).tr, task.pos, true, TODAY).docChanged).toBe(
      false,
    );
    expect(write('- [ ] a ✅ 2026-01-01\n', false)).toBe('- [ ] a\n');
  });

  it('keeps the token when it is all the task says (no empty task exists in Markdown)', () => {
    expect(write('- [x] ✅ 2026-10-19\n', false)).toBe('- [ ] ✅ 2026-10-19\n');
  });
});
