import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetAppState } from '../../lib/testing/reset-app-state';
import {
  createTestEditor,
  newLineAtEnd,
  placeCaret,
  pressKey,
  typeText,
  type TestEditor,
} from '../__tests__/editor-test-utils';
import { activeTrigger } from './editor-triggers';

let current: TestEditor | null = null;

function trigger(t: TestEditor) {
  const match = activeTrigger(t.editor.state);
  return match ? { kind: match.kind, query: match.query, embed: match.embed } : null;
}

describe('popup triggers (F3.3, F4.1, F6.1)', () => {
  beforeEach(async () => {
    await resetAppState();
  });
  afterEach(() => {
    current?.editor.destroy();
    current = null;
  });

  it('"/" opens the slash menu only at the start of an empty line', () => {
    current = createTestEditor('Một dòng có chữ\n');
    placeCaret(current.editor, 'Một');
    typeText(current.editor, '/');
    expect(trigger(current)).toBeNull();
    newLineAtEnd(current.editor);
    typeText(current.editor, '/tiêu');
    expect(trigger(current)).toEqual({ kind: 'slash', query: 'tiêu', embed: false });
  });

  it('"/" inside a table cell does not open the menu', () => {
    current = createTestEditor('| a | b |\n| --- | --- |\n|  | c |\n');
    const cell = current.editor.state.doc.firstChild!.child(1).child(0);
    expect(cell.type.name).toBe('tableCell');
    let pos = -1;
    current.editor.state.doc.descendants((node, p) => {
      if (pos === -1 && node === cell) pos = p;
    });
    current.editor.commands.setTextSelection(pos + 2);
    typeText(current.editor, '/');
    expect(trigger(current)).toBeNull();
  });

  it('[[ and ![[ open the link popup; the query keeps spaces, | and #', () => {
    current = createTestEditor('Xem\n');
    placeCaret(current.editor, 'Xem');
    typeText(current.editor, ' [[giai tich#Ôn|bài');
    expect(trigger(current)).toEqual({ kind: 'wikilink', query: 'giai tich#Ôn|bài', embed: false });
    typeText(current.editor, ']]');
    expect(trigger(current)).toBeNull();
    typeText(current.editor, ' ![[sơ');
    expect(trigger(current)).toEqual({ kind: 'wikilink', query: 'sơ', embed: true });
  });

  it('# after a space opens the tag popup, @ and 📅 the date popup', () => {
    current = createTestEditor('Việc\n');
    placeCaret(current.editor, 'Việc');
    typeText(current.editor, ' #do-a');
    expect(trigger(current)).toEqual({ kind: 'tag', query: 'do-a', embed: false });
    typeText(current.editor, ' @');
    expect(trigger(current)).toEqual({ kind: 'date', query: '', embed: false });
    typeText(current.editor, 'mai ');
    expect(trigger(current)).toBeNull();
    typeText(current.editor, '\u{1F4C5}');
    expect(trigger(current)?.kind).toBe('date');
  });

  it('a@b and #1-like text inside words do not open anything', () => {
    current = createTestEditor('x\n');
    placeCaret(current.editor, 'x');
    typeText(current.editor, 'a@b c#d');
    expect(trigger(current)).toBeNull();
  });

  it('moving the caret next to old text does not open a popup', () => {
    current = createTestEditor('Cũ [[Giải\n\nKhác\n');
    placeCaret(current.editor, '[[Giải');
    expect(trigger(current)).toBeNull();
  });

  it('Esc closes the popup and typing on does not reopen it', () => {
    current = createTestEditor('x\n');
    placeCaret(current.editor, 'x');
    typeText(current.editor, ' [[ab');
    expect(pressKey(current.editor, 'Escape')).toBe(true);
    expect(trigger(current)).toBeNull();
    typeText(current.editor, 'c');
    expect(trigger(current)).toBeNull();
  });

  it('nothing opens inside code', () => {
    current = createTestEditor('```\nx\n```\n\nTrong `mã` nữa\n');
    placeCaret(current.editor, 'x');
    typeText(current.editor, ' [[a #b /');
    expect(trigger(current)).toBeNull();
    placeCaret(current.editor, 'm');
    typeText(current.editor, '[[');
    expect(trigger(current)).toBeNull();
  });
});
