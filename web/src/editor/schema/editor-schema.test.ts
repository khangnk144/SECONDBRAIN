// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createSchemaExtensions, editorSchema } from './editor-schema';

const schema = editorSchema;
const node = (name: string) => schema.nodes[name]!;

describe('editor schema', () => {
  it('defines exactly the Markdown node and mark types', () => {
    expect(Object.keys(schema.nodes).sort()).toEqual(
      [
        'blockquote',
        'bulletList',
        'codeBlock',
        'doc',
        'hardBreak',
        'heading',
        'horizontalRule',
        'image',
        'listItem',
        'orderedList',
        'paragraph',
        'table',
        'tableCell',
        'tableHeader',
        'tableRow',
        'taskItem',
        'taskList',
        'text',
        'verbatimBlock',
        'wikilink',
      ].sort(),
    );
    expect(Object.keys(schema.marks).sort()).toEqual(['bold', 'code', 'italic', 'link', 'strike']);
    expect(createSchemaExtensions().some((extension) => extension.name === 'underline')).toBe(
      false,
    );
  });

  it('lets code combine with the other marks', () => {
    const marks = [
      schema.marks['bold']!.create(),
      schema.marks['code']!.create(),
      schema.marks['link']!.create({ href: 'u' }),
    ];
    expect(schema.text('x', marks).marks.map((mark) => mark.type.name)).toEqual([
      'link',
      'bold',
      'code',
    ]);
  });

  it('allows verbatim blocks only at the top level', () => {
    const verbatim = node('verbatimBlock').create({ source: '#### h4' });
    expect(() => node('doc').create(null, [verbatim]).check()).not.toThrow();
    expect(() => node('blockquote').create(null, [verbatim]).check()).toThrow();
    expect(() =>
      node('listItem')
        .create(null, [node('paragraph').create(), verbatim])
        .check(),
    ).toThrow();
  });

  it('gives wikilinks, lists, tasks, cells and images their Markdown attributes', () => {
    expect(node('wikilink').create().attrs).toEqual({
      target: '',
      heading: null,
      alias: null,
      embed: false,
    });
    expect(node('wikilink').isInline && node('wikilink').isAtom).toBe(true);
    for (const list of ['bulletList', 'orderedList', 'taskList']) {
      expect(
        node(list).create(
          null,
          node(list === 'taskList' ? 'taskItem' : 'listItem').create(
            null,
            node('paragraph').create(),
          ),
        ).attrs['loose'],
      ).toBe(false);
    }
    expect(node('taskItem').create().attrs['checked']).toBe(false);
    expect(node('tableCell').create().attrs['align']).toBeNull();
    expect(node('tableCell').spec.content).toBe('paragraph');
    expect(node('image').isInline).toBe(true);
    expect(node('codeBlock').create().attrs['language']).toBeNull();
  });

  it('lets task items hold nested lists', () => {
    const nested = node('taskList').create(
      null,
      node('taskItem').create(null, node('paragraph').create()),
    );
    expect(() =>
      node('taskItem')
        .create(null, [node('paragraph').create(), nested])
        .check(),
    ).not.toThrow();
  });
});
