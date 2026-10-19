// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { editWordInBlock } from './__tests__/document-edits';
import { loadMarkdown, saveMarkdown } from './markdown-document';

function wikilinks(doc: ProseMirrorNode): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  doc.descendants((node) => {
    if (node.type.name === 'wikilink') found.push({ ...node.attrs });
  });
  return found;
}

describe('wikilinks follow the server syntax (F4)', () => {
  it.each([
    ['[[Bài 1]]', { target: 'Bài 1', heading: null, alias: null, embed: false }],
    ['[[Bài 1|bài một]]', { target: 'Bài 1', heading: null, alias: 'bài một', embed: false }],
    ['[[Bài 1#Ý chính]]', { target: 'Bài 1', heading: 'Ý chính', alias: null, embed: false }],
    ['[[Bài 1#Ý chính|xem]]', { target: 'Bài 1', heading: 'Ý chính', alias: 'xem', embed: false }],
    ['![[sơ đồ.png]]', { target: 'sơ đồ.png', heading: null, alias: null, embed: true }],
    [
      '[[2 Areas/Giải tích 1]]',
      { target: '2 Areas/Giải tích 1', heading: null, alias: null, embed: false },
    ],
    ['[[#Tóm tắt]]', { target: '', heading: 'Tóm tắt', alias: null, embed: false }],
    ['[[[Bài 3]]]', { target: 'Bài 3', heading: null, alias: null, embed: false }],
  ])('%s becomes one wikilink node', (markdown, attrs) => {
    const { doc } = loadMarkdown(`Text ${markdown} end.\n`);
    expect(wikilinks(doc)).toEqual([attrs]);
  });

  it.each([
    ['escaped', 'Text \\[[Không phải]] end.'],
    ['empty', 'Text [[]] and [[|x]] end.'],
    ['inline code', 'Text `[[Bài 1]]` end.'],
    ['across lines', 'Text [[Bài\n1]] end.'],
  ])('%s is not a wikilink', (_name, markdown) => {
    const { doc } = loadMarkdown(markdown);
    expect(wikilinks(doc)).toEqual([]);
    expect(doc.child(0).type.name).toBe('paragraph');
  });

  it('reads the escaped alias pipe inside a table cell and writes it back escaped', () => {
    const source = '| tên | link |\n| - | - |\n| x | [[Bài 1\\|bài một]] |\n';
    const { doc, snapshot } = loadMarkdown(source);
    expect(wikilinks(doc)).toEqual([
      { target: 'Bài 1', heading: null, alias: 'bài một', embed: false },
    ]);
    const edited = saveMarkdown(editWordInBlock(doc, 0, 'EDITED'), snapshot);
    expect(edited).toContain('[[Bài 1\\|bài một]]');
    expect(wikilinks(loadMarkdown(edited).doc)).toEqual(wikilinks(doc));
  });

  it('finds links next to escapes, references and inside quoted multi-line paragraphs', () => {
    const source = '> A &amp; \\*x\\* [[Một]] and\n>   more [[Hai|hai]] &eacute; \\\\[[Ba]]\n';
    const { doc, snapshot } = loadMarkdown(source);
    expect(wikilinks(doc).map((attrs) => attrs['target'])).toEqual(['Một', 'Hai', 'Ba']);
    expect(doc.textContent).toBe('A & *x*  and\nmore  é \\');
    const output = saveMarkdown(editWordInBlock(doc, 0, 'EDITED'), snapshot);
    expect(wikilinks(loadMarkdown(output).doc)).toEqual(wikilinks(doc));
  });

  it('keeps a block verbatim when the server would see a link the editor cannot hold', () => {
    for (const source of [
      'A [text [[x]] more](u.md) end.',
      'A [[a *b* c]] end.',
      '![alt [[x]]](i.png)',
    ]) {
      const { doc } = loadMarkdown(source);
      expect(doc.child(0).type.name, source).toBe('verbatimBlock');
    }
  });

  it('writes an exclamation mark before a plain link so it does not become an embed', () => {
    const { doc, snapshot } = loadMarkdown('Say hi [[Bài 1]].\n');
    const state = EditorState.create({ doc });
    let at = -1;
    doc.descendants((node, pos) => {
      if (node.type.name === 'wikilink') at = pos;
    });
    const output = saveMarkdown(state.tr.insertText('!', at).doc, snapshot);
    expect(output).toBe('Say hi &#33;[[Bài 1]].\n');
    const [link] = wikilinks(loadMarkdown(output).doc);
    expect(link?.['embed']).toBe(false);
  });

  it('keeps typed brackets as text, never as a link', () => {
    const { doc, snapshot } = loadMarkdown('Plain words here.\n');
    const typed = EditorState.create({ doc }).tr.insertText(' [[not a link]] ![[no]]', 12).doc;
    const output = saveMarkdown(typed, snapshot);
    const reloaded = loadMarkdown(output).doc;
    expect(wikilinks(reloaded)).toEqual([]);
    expect(reloaded.textContent).toBe(typed.textContent);
  });

  it('round-trips links that only differ in spacing to the canonical form', () => {
    const { doc, snapshot } = loadMarkdown('See [[ Bài 2 ]] and [[Bài 3|]] here.\n');
    const output = saveMarkdown(editWordInBlock(doc, 0, 'Look'), snapshot);
    expect(output).toBe('Look [[Bài 2]] and [[Bài 3]] here.\n');
  });
});
