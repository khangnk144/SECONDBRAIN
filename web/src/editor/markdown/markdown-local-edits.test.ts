// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { editorSchema } from '../schema/editor-schema';
import { editWordInBlock, findTasks, tickTask } from './__tests__/document-edits';
import { loadMarkdown, saveMarkdown, saveMarkdownWithSnapshot } from './markdown-document';

const schema = editorSchema;
const paragraph = (text: string): ProseMirrorNode =>
  schema.nodes['paragraph']!.create(null, text ? schema.text(text) : null);

/** The document with its top-level children replaced. */
function withChildren(doc: ProseMirrorNode, children: ProseMirrorNode[]): ProseMirrorNode {
  return doc.copy(Fragment.fromArray(children));
}

function children(doc: ProseMirrorNode): ProseMirrorNode[] {
  const list: ProseMirrorNode[] = [];
  doc.forEach((child) => list.push(child));
  return list;
}

/** Replaces item `index` of the list at top-level block `block`. */
function replaceItem(
  doc: ProseMirrorNode,
  block: number,
  index: number,
  item: ProseMirrorNode | null,
) {
  const list = doc.child(block);
  const items = children(list);
  if (item) items.splice(index, 1, item);
  else items.splice(index, 1);
  const blocks = children(doc);
  blocks[block] = list.copy(Fragment.fromArray(items));
  return withChildren(doc, blocks);
}

describe('edits stay local (P2)', () => {
  const source = '# Title\n\nFirst  paragraph.\n\nSecond *para*.\n\n- a\n- b\n';

  it('inserts a new block with one blank line and touches nothing else', () => {
    const { doc, snapshot } = loadMarkdown(source);
    const blocks = children(doc);
    blocks.splice(2, 0, paragraph('New'));
    expect(saveMarkdown(withChildren(doc, blocks), snapshot)).toBe(
      '# Title\n\nFirst  paragraph.\n\nNew\n\nSecond *para*.\n\n- a\n- b\n',
    );
  });

  it('deletes a block with the gap before it, and keeps leading and trailing text', () => {
    const { doc, snapshot } = loadMarkdown(`\n\n${source}\n`);
    const blocks = children(doc);
    expect(saveMarkdown(withChildren(doc, [blocks[0]!, blocks[2]!, blocks[3]!]), snapshot)).toBe(
      '\n\n# Title\n\nSecond *para*.\n\n- a\n- b\n\n',
    );
    expect(saveMarkdown(withChildren(doc, blocks.slice(1)), snapshot)).toBe(
      '\n\nFirst  paragraph.\n\nSecond *para*.\n\n- a\n- b\n\n',
    );
    expect(saveMarkdown(withChildren(doc, blocks.slice(0, 3)), snapshot)).toBe(
      '\n\n# Title\n\nFirst  paragraph.\n\nSecond *para*.\n\n',
    );
  });

  it('writes an empty body when every block is deleted, keeping the front matter', () => {
    const { doc, snapshot } = loadMarkdown(`---\na: 1\n---\n${source}`);
    expect(saveMarkdown(withChildren(doc, [paragraph('')]), snapshot)).toBe('---\na: 1\n---\n');
  });

  it('writes text typed into a new, empty note after its front matter', () => {
    const { doc, snapshot } = loadMarkdown('---\ntype: note\n---\n');
    expect(doc.childCount).toBe(1);
    expect(saveMarkdown(withChildren(doc, [paragraph('Xin chào')]), snapshot)).toBe(
      '---\ntype: note\n---\nXin chào',
    );
  });

  it('adds a blank line where a deletion would merge two blocks', () => {
    const { doc, snapshot } = loadMarkdown('foo\n***\nbar\n');
    const blocks = children(doc);
    const saved = saveMarkdownWithSnapshot(withChildren(doc, [blocks[0]!, blocks[2]!]), snapshot);
    expect(saved.text).toBe('foo\n\nbar\n');
    expect(saved.exact).toBe(true);
  });

  it('moves blocks with their original bytes', () => {
    const { doc, snapshot } = loadMarkdown('Para  *one*\n\n__two__\n');
    const [one, two] = children(doc);
    expect(saveMarkdown(withChildren(doc, [two!, one!]), snapshot)).toBe(
      '__two__\n\nPara  *one*\n',
    );
  });

  it('writes new and edited text with CRLF in a CRLF file, and keeps mixed line ends elsewhere', () => {
    const { doc, snapshot } = loadMarkdown('Một\r\nhai\r\n\r\nB *x*\nline\r\n\r\nC\n');
    const blocks = children(doc);
    blocks.push(paragraph('D'));
    expect(saveMarkdown(editWordInBlock(doc, 0, 'Bốn'), snapshot)).toBe(
      'Bốn\r\nhai\r\n\r\nB *x*\nline\r\n\r\nC\n',
    );
    expect(saveMarkdown(withChildren(doc, blocks), snapshot)).toBe(
      'Một\r\nhai\r\n\r\nB *x*\nline\r\n\r\nC\r\n\r\nD\n',
    );
  });

  it('keeps NFD text as it is, edited or not', () => {
    const nfd = 'Gia\u0309i ti\u0301ch mo\u0302n\n\nĐa\u0323i so\u0302\u0301 *tuye\u0302\u0301n*\n';
    const { doc, snapshot } = loadMarkdown(nfd);
    const output = saveMarkdown(editWordInBlock(doc, 1, 'X'), snapshot);
    expect(output.startsWith('Gia\u0309i ti\u0301ch mo\u0302n\n\n')).toBe(true);
    expect(output.normalize('NFC')).not.toBe(output);
  });

  it('forgets a deleted link definition in the returned snapshot', () => {
    const { doc, snapshot } = loadMarkdown(
      'See [x] here.\n\nPlain text.\n\n[x]: https://example.com\n',
    );
    expect(snapshot.definitionsPrefix).toContain('[x]: https://example.com');
    const saved = saveMarkdownWithSnapshot(withChildren(doc, children(doc).slice(0, 2)), snapshot);
    expect(saved.text).toBe('See [x] here.\n\nPlain text.\n');
    expect(saved.snapshot.definitionsPrefix).toBe('');
  });

  it('chains edits through the returned snapshot; an unchanged document saves identically', () => {
    const { doc, snapshot } = loadMarkdown(source);
    const first = saveMarkdownWithSnapshot(editWordInBlock(doc, 1, 'Opening'), snapshot);
    const secondDoc = editWordInBlock(editWordInBlock(doc, 1, 'Opening'), 2, 'Next');
    const second = saveMarkdownWithSnapshot(secondDoc, first.snapshot);
    expect(second.text).toBe('# Title\n\nOpening  paragraph.\n\nNext *para*.\n\n- a\n- b\n');
    expect(saveMarkdown(secondDoc, second.snapshot)).toBe(second.text);
  });
});

describe('list items stay local (P2, F3.1)', () => {
  it('adds an item with the list’s own marker and keeps the other lines', () => {
    const { doc, snapshot } = loadMarkdown('* one  \n* two\n\nend\n');
    const list = doc.child(0);
    const item = list.child(0).type.create(null, paragraph('three'));
    const blocks = children(doc);
    blocks[0] = list.copy(list.content.append(Fragment.from(item)));
    expect(saveMarkdown(withChildren(doc, blocks), snapshot)).toBe(
      '* one  \n* two\n* three\n\nend\n',
    );
  });

  it('keeps the start number when the first item is deleted', () => {
    const { doc, snapshot } = loadMarkdown('1. a\n2. b\n3. c\n');
    expect(saveMarkdown(replaceItem(doc, 0, 0, null), snapshot)).toBe('1. b\n3. c\n');
  });

  it('edits a parent item without touching its children', () => {
    const source = '- parent  *x*\n  - child   one\n  - child two\n';
    const { doc, snapshot } = loadMarkdown(source);
    expect(saveMarkdown(editWordInBlock(doc, 0, 'Mother'), snapshot)).toBe(
      '- Mother  *x*\n  - child   one\n  - child two\n',
    );
  });

  it('ticks a task whose text continues after a hard break', () => {
    const source = '- [ ] first line\\\n  second   line\n- [ ] other\n';
    const { doc, snapshot } = loadMarkdown(source);
    const task = findTasks(doc)[0]!;
    expect(saveMarkdown(tickTask(doc, task.pos), snapshot)).toBe(
      '- [x] first line ✅ 2026-10-19\\\n  second   line\n- [ ] other\n',
    );
  });

  it('ticks tasks inside block quotes and nested lists line by line', () => {
    const source = '> * [ ] alpha\n> * [ ] beta\n>   * [ ] gamma\n>\n> Some   *para*\n';
    const { doc, snapshot } = loadMarkdown(source);
    for (const task of findTasks(doc)) {
      const output = saveMarkdown(tickTask(doc, task.pos), snapshot);
      const changed = output
        .split('\n')
        .filter((line, index) => line !== source.split('\n')[index]);
      expect(changed, output).toHaveLength(1);
    }
  });

  it('ticks tab-indented nested tasks line by line', () => {
    const source = '- [ ] parent\n\t- [ ] child\n\t\t- [ ] grandchild\n\t- [ ] second child\n';
    const { doc, snapshot } = loadMarkdown(source);
    for (const task of findTasks(doc)) {
      const output = saveMarkdown(tickTask(doc, task.pos), snapshot);
      const changed = output
        .split('\n')
        .filter((line, index) => line !== source.split('\n')[index]);
      expect(changed, output).toHaveLength(1);
    }
  });

  it('keeps blank lines of a loose list when an item changes', () => {
    const { doc, snapshot } = loadMarkdown('- one\n\n- two\n\n- three\n');
    expect(saveMarkdown(editWordInBlock(doc, 0, 'uno'), snapshot)).toBe(
      '- uno\n\n- two\n\n- three\n',
    );
  });
});
