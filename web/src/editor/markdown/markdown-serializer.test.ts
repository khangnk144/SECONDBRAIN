// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { editorSchema } from '../schema/editor-schema';
import { loadMarkdown, saveMarkdownWithSnapshot } from './markdown-document';
import type { MarkdownSnapshot } from './markdown-snapshot';
import { serializeBlock } from './markdown-serializer';

/** Every block of `source` written canonically (as if all were new). */
function canonical(source: string): string {
  const { doc, snapshot } = loadMarkdown(source);
  const empty: MarkdownSnapshot = {
    ...snapshot,
    bom: false,
    frontmatter: '',
    blocks: [],
    trailing: '',
  };
  return saveMarkdownWithSnapshot(doc, empty).text;
}

function first(source: string): ProseMirrorNode {
  return loadMarkdown(source).doc.child(0);
}

describe('canonical Markdown for edited blocks (P3)', () => {
  it.each([
    ['* a\n+ b', '- a\n\n* b'],
    ['1) one\n2) two', '1. one\n2. two'],
    ['__bold__ and _it_ and ~del~', '**bold** and *it* and ~~del~~'],
    ['Setext\n===', '# Setext'],
    ['***', '***'],
    ['text\n\n- - -', 'text\n\n---'],
    ['~~~js\ncode\n~~~', '```js\ncode\n```'],
    ['    indented', '```\nindented\n```'],
    ['a  \nb', 'a\\\nb'],
  ])('%j → %j', (source, expected) => {
    expect(canonical(source)).toBe(expected);
  });

  it('writes GFM tables with their alignment', () => {
    expect(serializeBlock(first('| a | b | c |\n|:-|:-:|-:|\n| 1 | 2 | 3 |'))).toBe(
      '| a  |  b  |  c |\n| :- | :-: | -: |\n| 1  |  2  |  3 |',
    );
  });

  it('writes a tag at the start of a line without escaping it', () => {
    const doc = editorSchema.nodes['doc']!.create(null, [
      editorSchema.nodes['paragraph']!.create(
        null,
        editorSchema.text('#tag and #môn/giải-tích\n#todo_now'),
      ),
    ]);
    expect(serializeBlock(doc.child(0))).toBe('#tag and #môn/giải-tích\n#todo_now');
  });

  it('still escapes text that would become a heading or a list', () => {
    const text = '# not a heading\n- not a list\n1. not ordered\n-\n- [ ] not a task';
    const node = editorSchema.nodes['paragraph']!.create(null, editorSchema.text(text));
    const written = serializeBlock(node);
    expect(loadMarkdown(written).doc.child(0).eq(node)).toBe(true);
  });

  it('does not write a rule as `---` on the first line of a file without front matter', () => {
    const output = canonical('***\n\nText\n\n---\n\nMore');
    expect(output.startsWith('***')).toBe(true);
    expect(loadMarkdown(output).frontmatter).toBeNull();
  });

  it('gives a new list a marker that does not continue the list next to it', () => {
    expect(canonical('- a\n\n* b\n\n+ c')).toBe('- a\n\n* b\n\n- c');
    expect(canonical('1. a\n\n1) b')).toBe('1. a\n\n1) b');
  });

  it('keeps emphasis and code combined', () => {
    const source = '**`code` in bold** and [`code` link](https://example.com) and ~~*x*~~';
    expect(canonical(source)).toBe(source);
    const marks = new Set<string>();
    first(source).descendants((node) => {
      node.marks.forEach((mark) => marks.add(mark.type.name));
    });
    expect([...marks].sort()).toEqual(['bold', 'code', 'italic', 'link', 'strike']);
  });

  it('writes autolinks only when they parse back as autolinks', () => {
    expect(canonical('<https://example.com/a_b> and https://x.y/z and www.example.com')).toBe(
      '<https://example.com/a_b> and <https://x.y/z> and [www.example.com](http://www.example.com)',
    );
    const odd = canonical('mail@ex.orgsnake_case');
    expect(loadMarkdown(odd).doc.eq(loadMarkdown('mail@ex.orgsnake_case').doc)).toBe(true);
  });
});
