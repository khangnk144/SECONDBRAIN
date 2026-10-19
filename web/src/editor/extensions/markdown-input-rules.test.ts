import { closeHistory } from '@tiptap/pm/history';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { saveMarkdown } from '../markdown/markdown-document';
import {
  createTestEditor,
  newLineAtEnd,
  placeCaret,
  pressKey,
  typeText,
  type TestEditor,
} from '../__tests__/editor-test-utils';

let current: TestEditor | null = null;

function startOnEmptyLine(source = 'Mở đầu.\n'): TestEditor {
  current = createTestEditor(source);
  newLineAtEnd(current.editor);
  return current;
}

/** The top-level block holding the caret (a trailing empty paragraph may follow it). */
function lastBlock(t: TestEditor): ProseMirrorNode {
  return t.editor.state.selection.$from.node(1);
}

describe('Markdown input rules leave no stray symbols (F3.3)', () => {
  beforeEach(async () => {
    await resetAppState();
  });
  afterEach(() => {
    current?.editor.destroy();
    current = null;
  });

  it.each([
    ['# ', 1],
    ['## ', 2],
    ['### ', 3],
  ])('"%s" makes a level %i heading', (marker, level) => {
    const t = startOnEmptyLine();
    typeText(t.editor, `${marker}Tiêu đề`);
    expect(lastBlock(t).type.name).toBe('heading');
    expect(lastBlock(t).attrs['level']).toBe(level);
    expect(lastBlock(t).textContent).toBe('Tiêu đề');
  });

  it('"#### " stays text (headings 4–6 are verbatim)', () => {
    const t = startOnEmptyLine();
    typeText(t.editor, '#### x');
    expect(lastBlock(t).type.name).toBe('paragraph');
    expect(lastBlock(t).textContent).toBe('#### x');
  });

  it.each([
    ['**đậm**', 'bold', 'đậm'],
    ['*nghiêng*', 'italic', 'nghiêng'],
    ['~~gạch~~', 'strike', 'gạch'],
    ['`mã`', 'code', 'mã'],
  ])('%s becomes the %s mark', (typed, mark, text) => {
    const t = startOnEmptyLine();
    typeText(t.editor, `a ${typed}`);
    const paragraph = lastBlock(t);
    expect(paragraph.textContent).toBe(`a ${text}`);
    const marked = paragraph.child(paragraph.childCount - 1);
    expect(marked.text).toBe(text);
    expect(marked.marks.map((m) => m.type.name)).toEqual([mark]);
  });

  it.each([
    ['- ', 'bulletList'],
    ['* ', 'bulletList'],
    ['1. ', 'orderedList'],
    ['> ', 'blockquote'],
  ])('"%s" makes a %s', (marker, type) => {
    const t = startOnEmptyLine();
    typeText(t.editor, `${marker}mục`);
    expect(lastBlock(t).type.name).toBe(type);
    expect(lastBlock(t).textContent).toBe('mục');
  });

  it.each([
    ['- [ ] ', false],
    ['[ ] ', false],
    ['- [x] ', true],
    ['[x] ', true],
  ])('"%s" makes a task (checked: %s)', (marker, checked) => {
    const t = startOnEmptyLine();
    typeText(t.editor, `${marker}Nộp bài`);
    const list = lastBlock(t);
    expect(list.type.name).toBe('taskList');
    expect(list.childCount).toBe(1);
    expect(list.child(0).attrs['checked']).toBe(checked);
    expect(list.textContent).toBe('Nộp bài');
    const mark = checked ? 'x' : ' ';
    expect(saveMarkdown(t.editor.state.doc, t.loaded.snapshot)).toBe(
      `Mở đầu.\n\n- [${mark}] Nộp bài\n`,
    );
  });

  it('a task typed after an existing task list joins it', () => {
    current = createTestEditor('- [ ] một\n');
    newLineAtEnd(current.editor);
    typeText(current.editor, '- [ ] hai');
    const doc = current.editor.state.doc;
    expect(doc.child(0).type.name).toBe('taskList');
    expect(doc.child(0).childCount).toBe(2);
    expect(saveMarkdown(doc, current.loaded.snapshot)).toBe('- [ ] một\n- [ ] hai\n');
  });

  it('"[ ] " inside a longer bullet list stays text (mixed lists are not editable)', () => {
    current = createTestEditor('- một\n- hai\n');
    placeCaret(current.editor, 'hai');
    pressKey(current.editor, 'Enter');
    typeText(current.editor, '[ ] ba');
    const list = current.editor.state.doc.child(0);
    expect(list.type.name).toBe('bulletList');
    expect(list.lastChild!.textContent).toBe('[ ] ba');
  });

  it('``` with a language makes a code block', () => {
    const t = startOnEmptyLine();
    typeText(t.editor, '```ts ');
    typeText(t.editor, 'const a = 1;');
    expect(lastBlock(t).type.name).toBe('codeBlock');
    expect(lastBlock(t).attrs['language']).toBe('ts');
    expect(lastBlock(t).textContent).toBe('const a = 1;');
  });

  it('``` then Enter makes a code block without language', () => {
    const t = startOnEmptyLine();
    typeText(t.editor, '```');
    pressKey(t.editor, 'Enter');
    expect(lastBlock(t).type.name).toBe('codeBlock');
    expect(lastBlock(t).textContent).toBe('');
  });

  it('--- makes a horizontal rule', () => {
    const t = startOnEmptyLine();
    typeText(t.editor, '---');
    const names: string[] = [];
    t.editor.state.doc.forEach((node) => names.push(node.type.name));
    expect(names).toContain('horizontalRule');
    expect(t.editor.state.doc.textContent).toBe('Mở đầu.');
  });

  it('a fully typed [[link]] becomes a wikilink node, ![[x]] an embed', () => {
    const t = startOnEmptyLine();
    typeText(t.editor, 'Xem [[Giải tích 1#Ôn tập|bài]] và ![[sơ đồ.png]]');
    const paragraph = lastBlock(t);
    const links: ProseMirrorNode[] = [];
    paragraph.forEach((node) => {
      if (node.type.name === 'wikilink') links.push(node);
    });
    expect(links.map((l) => l.attrs)).toEqual([
      { target: 'Giải tích 1', heading: 'Ôn tập', alias: 'bài', embed: false },
      { target: 'sơ đồ.png', heading: null, alias: null, embed: true },
    ]);
    expect(paragraph.textContent).toBe('Xem  và ');
  });

  it('Backspace right after a rule restores the typed characters', () => {
    const t = startOnEmptyLine();
    typeText(t.editor, '## ');
    expect(lastBlock(t).type.name).toBe('heading');
    pressKey(t.editor, 'Backspace');
    expect(lastBlock(t).type.name).toBe('paragraph');
    expect(lastBlock(t).textContent).toBe('## ');
  });

  it('keeps at least 100 undo steps', () => {
    current = createTestEditor('x\n');
    const { editor } = current;
    for (let i = 0; i < 120; i += 1) {
      const tr = editor.state.tr.insertText(String(i % 10), editor.state.doc.content.size - 1);
      editor.view.dispatch(closeHistory(tr));
    }
    const full = editor.state.doc.textContent;
    for (let i = 0; i < 100; i += 1) expect(editor.commands.undo()).toBe(true);
    expect(editor.state.doc.textContent).toBe(full.slice(0, full.length - 100));
  });
});
