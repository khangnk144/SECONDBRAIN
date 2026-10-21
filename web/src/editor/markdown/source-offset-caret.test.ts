import { afterEach, beforeAll, describe, expect, it } from 'vitest';
// The server's own bundled templates, so this test follows any change to them.
import { BUNDLED_TEMPLATES } from '../../../../server/src/templates/bundled-templates';
// The server's variable filling, so the offset is exactly the one `POST /api/daily` returns.
import { fillTemplate } from '../../../../server/src/templates/template-variables';
import {
  createTestEditor,
  placeCaret,
  typeText,
  type TestEditor,
} from '../__tests__/editor-test-utils';
import { installRangeLayoutShim } from '../__tests__/jsdom-layout';
import { createEditorHandle } from '../editor-handle';
import { loadMarkdown, saveMarkdown } from './markdown-document';
import { caretForSourceOffset } from './source-offset-caret';

/** A note as the server creates it: variables filled, `{{cursor}}` removed, its offset kept. */
function created(template: string): { content: string; offset: number } {
  const filled = template
    .replace(/\{\{title\}\}/g, 'Ghi chú mới')
    .replace(/\{\{date\}\}/g, '2026-10-20')
    .replace(/\{\{date:[^}]*\}\}/g, 'thứ ba, 20 tháng 10 2026')
    .replace(/\{\{yesterday\}\}/g, '2026-10-19')
    .replace(/\{\{tomorrow\}\}/g, '2026-10-21')
    .replace(/\{\{time\}\}/g, '08:30');
  const offset = filled.indexOf('{{cursor}}');
  return { content: filled.replace('{{cursor}}', ''), offset };
}

let current: TestEditor | null = null;
beforeAll(installRangeLayoutShim);
afterEach(() => {
  current?.editor.destroy();
  current = null;
});

const saved = (t: TestEditor) => saveMarkdown(t.editor.state.doc, t.loaded.snapshot);

describe('caret at a template’s {{cursor}} (F14.2)', () => {
  it('covers the eight bundled templates, Daily included', () => {
    expect(BUNDLED_TEMPLATES.map((template) => template.name)).toContain('Daily.md');
    expect(BUNDLED_TEMPLATES).toHaveLength(8);
  });

  it.each(BUNDLED_TEMPLATES.map((template) => [template.name, template.content] as const))(
    '%s: the caret sits on the empty line where {{cursor}} was; typing lands exactly there',
    (_name, template) => {
      const { content, offset } = created(template);
      expect(offset).toBeGreaterThan(0);
      current = createTestEditor(content);
      const { doc, snapshot } = current.loaded;
      const caret = caretForSourceOffset(doc, snapshot, offset);
      expect(caret.kind).toBe('new-paragraph');
      createEditorHandle(current.editor).focus({ caret });
      // Placing the caret writes nothing (P1): the empty line has no Markdown form.
      expect(saved(current)).toBe(content);
      expect(current.editor.state.selection.$from.parent.type.name).toBe('paragraph');
      typeText(current.editor, 'Xin chào');
      expect(saved(current)).toBe(
        `${content.slice(0, offset)}Xin chào\n\n${content.slice(offset)}`,
      );
    },
  );
});

describe('caret at {{cursor}} after emoji, combining marks, CRLF and BOM', () => {
  const context = {
    title: 'Ghi chú 😀',
    date: '2026-10-20',
    now: new Date(2026, 9, 20, 8, 30),
    language: 'vi' as const,
  };

  it.each([
    ['two emoji before it', '# {{title}}\n\nHôm nay 😀😀 là {{cursor}}ngày đẹp\n'],
    [
      'a ZWJ sequence, CRLF and a BOM',
      '﻿---\r\ntype: note\r\n---\r\n\r\n# {{title}}\r\n\r\nA 👩‍👩‍👧 b {{cursor}}c\r\n',
    ],
    ['bold, then an emoji', '**Đậm** 😀 {{cursor}}z\n'],
    ['NFD text', '# x\n\nTiếng Việt 😀 {{cursor}}ở đây\n'.normalize('NFD')],
    ['a combining mark right before it', 'Café{{cursor}} sáng 😀\n'],
    ['the second line of a CRLF paragraph', '﻿Dòng 😀\r\nhai 😀 {{cursor}}ba\r\n'],
    ['a task item with an emoji', '- [ ] 😀 {{cursor}}việc\n'],
    ['an emoji inside and after a wikilink', 'Xem [[Bài 😀]] 😀 {{cursor}}z\n'],
  ])('%s: typing lands exactly where {{cursor}} was', (_name, template) => {
    const { content, cursor } = fillTemplate(template, context);
    current = createTestEditor(content);
    const caret = caretForSourceOffset(current.loaded.doc, current.loaded.snapshot, cursor!);
    expect(caret.kind).toBe('text');
    createEditorHandle(current.editor).focus({ caret });
    typeText(current.editor, 'X');
    expect(saved(current)).toBe(`${content.slice(0, cursor!)}X${content.slice(cursor!)}`);
  });
});

describe('caretForSourceOffset', () => {
  const caretIn = (source: string, marker: string) => {
    const offset = source.indexOf(marker);
    const { doc, snapshot } = loadMarkdown(source.replace(marker, ''));
    return { doc, caret: caretForSourceOffset(doc, snapshot, offset) };
  };
  const textBefore = (source: string, marker: string) => {
    const { doc, caret } = caretIn(source, marker);
    if (caret.kind !== 'text') throw new Error(`expected a text caret, got ${caret.kind}`);
    return doc.textBetween(0, caret.pos, '|', '@');
  };

  it('inside a paragraph: the matching text position, Markdown syntax skipped', () => {
    expect(textBefore('Một **chữ|^| đậm** ở đây.\n', '|^|')).toBe('Một chữ');
    expect(textBefore('Xem [[Bài 1]] |^|và tiếp.\n', '|^|')).toBe('Xem @ ');
    expect(textBefore('Có <u>gạch|^|</u> chân.\n', '|^|')).toBe('Có gạch');
  });

  it('counts an emoji as its two UTF-16 units on both sides', () => {
    expect(textBefore('Hôm nay 😀😀 là |^|ngày\n', '|^|')).toBe('Hôm nay 😀😀 là ');
    expect(textBefore('😀|^|\n', '|^|')).toBe('😀');
    expect(textBefore('**😀 đậm** 👩‍👩‍👧 |^|z\n', '|^|')).toBe('😀 đậm 👩‍👩‍👧 ');
    expect(textBefore('é̂|^|x\n', '|^|')).toBe('é̂');
  });

  it('in a list: the item the offset is in, even at the start of a line', () => {
    expect(textBefore('- một\n- |^|hai\n', '|^|')).toBe('một|');
    expect(textBefore('- một|^|\n- hai\n', '|^|')).toBe('một');
  });

  it('trailing spaces after a block stay with that block; a blank line gets a new paragraph', () => {
    expect(textBefore('Đoạn  |^|\n\nSau.\n', '|^|')).toBe('Đoạn');
    expect(caretIn('Đoạn\n\n|^|\n\nSau.\n', '|^|').caret).toEqual({
      kind: 'new-paragraph',
      pos: 6,
    });
    expect(caretIn('# T\n\n|^|\n', '|^|').caret).toEqual({ kind: 'new-paragraph', pos: 3 });
  });

  it('front matter or a verbatim block: the start of the nearest editable block (ties: the next one)', () => {
    expect(caretIn('---\na: |^|1\n---\n#### H4\n\nĐoạn\n', '|^|').caret).toEqual({
      kind: 'block',
      index: 1,
    });
    expect(caretIn('Đầu\n\n$$x|^|$$\n\nCuối\n', '|^|').caret).toEqual({ kind: 'block', index: 2 });
  });

  it('an empty note: the caret in its one empty line', () => {
    const { doc, snapshot } = loadMarkdown('---\ntype: note\n---\n\n');
    expect(caretForSourceOffset(doc, snapshot, 23)).toEqual({ kind: 'text', pos: 1 });
  });

  it('after the document changed: only the nearest block start', () => {
    current = createTestEditor('Một\n\nHai\n');
    placeCaret(current.editor, 'Hai');
    typeText(current.editor, 'x');
    const caret = caretForSourceOffset(current.editor.state.doc, current.loaded.snapshot, 6);
    expect(caret).toEqual({ kind: 'block', index: 0 });
  });
});
