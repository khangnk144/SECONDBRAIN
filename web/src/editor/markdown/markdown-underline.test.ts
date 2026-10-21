// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model';
import { editorSchema as schema } from '../schema/editor-schema';
import { corpusFile, lineEndingVariants } from './__tests__/corpus-files';
import { blockRanges, editWordInBlock } from './__tests__/document-edits';
import { createRandom, supportedDocument } from './__tests__/random-markdown';
import { loadMarkdown, saveMarkdown, saveMarkdownWithSnapshot } from './markdown-document';
import type { MarkdownSnapshot } from './markdown-snapshot';
import { normalizeForMarkdown } from './save-normalize';

/** Each inline leaf as `text:marks` (wikilinks as `[[target]]`). */
function leaves(node: ProseMirrorNode): string[] {
  const out: string[] = [];
  node.descendants((child) => {
    if (!child.isInline) return true;
    const label = child.isText ? child.text : `[[${String(child.attrs['target'] ?? '')}]]`;
    out.push(`${label}:${child.marks.map((mark) => mark.type.name).join('+')}`);
    return false;
  });
  return out;
}

function onlyBlock(source: string): ProseMirrorNode {
  const { doc } = loadMarkdown(source);
  expect(doc.childCount).toBe(1);
  return doc.child(0);
}

function emptySnapshot(snapshot: MarkdownSnapshot): MarkdownSnapshot {
  return {
    ...snapshot,
    bom: false,
    frontmatter: '',
    blocks: [],
    trailing: '',
    definitionsPrefix: '',
  };
}

/** A one-paragraph document from `[text, marks]` parts, written canonically. */
function canonicalParagraph(parts: Array<[string, Mark[]]>) {
  const paragraph = schema.nodes['paragraph']!.create(
    null,
    parts.map(([text, marks]) => schema.text(text, marks)),
  );
  const doc = schema.nodes['doc']!.create(null, [paragraph]);
  const saved = saveMarkdownWithSnapshot(doc, emptySnapshot(loadMarkdown('x').snapshot));
  return { ...saved, readsBack: loadMarkdown(saved.text).doc.eq(normalizeForMarkdown(doc)) };
}

const u = schema.marks['underline']!.create();
const bold = schema.marks['bold']!.create();
const italic = schema.marks['italic']!.create();
const code = schema.marks['code']!.create();

describe('underline is read from <u>…</u> pairs (P3)', () => {
  it.each([
    ['a <u>b</u> c', ['a :', 'b:underline', ' c:']],
    ['<u>**x**</u> **<u>y</u>**', ['x:bold+underline', ' :', 'y:bold+underline']],
    ['<u>`k`</u>', ['k:code+underline']],
    ['[<u>t</u>](x.md) <u>[s](y.md)</u>', ['t:link+underline', ' :', 's:link+underline']],
    ['<u>[[Bài 1]] và</u> [[Bài 2]]', ['[[Bài 1]]:underline', ' và:underline', ' :', '[[Bài 2]]:']],
  ])('%j', (source, expected) => {
    expect(leaves(onlyBlock(source))).toEqual(expected);
  });

  it('in list items, headings, quotes and table cells', () => {
    expect(leaves(onlyBlock('- <u>a</u>\n- b'))).toEqual(['a:underline', 'b:']);
    expect(onlyBlock('## <u>Tiêu đề</u>').type.name).toBe('heading');
    expect(leaves(onlyBlock('> <u>q</u>'))).toEqual(['q:underline']);
    expect(leaves(onlyBlock('| <u>a</u> | b |\n| - | - |\n| c | <u>d</u> |'))).toEqual([
      'a:underline',
      'b:',
      'c:',
      'd:underline',
    ]);
  });

  it.each([
    '<U>x</U>',
    '<u class="a">x</u>',
    '<u >x</u>',
    '<span>x</span>',
    '<b>x</b>',
    'open <u>only',
    'close only</u>',
    'empty <u></u>',
    '<u>a <u>b</u></u>',
    '<u>a **b</u> c**',
    '<u>a</u> and <span>b</span>',
  ])('anything else with inline HTML stays verbatim: %j', (source) => {
    const block = onlyBlock(source);
    expect(block.type.name).toBe('verbatimBlock');
    expect(block.attrs['source']).toBe(source);
  });

  it('keeps `<u>` inside code as code text', () => {
    expect(leaves(onlyBlock('`<u>x</u>`'))).toEqual(['<u>x</u>:code']);
  });
});

describe('underline is written as <u>…</u> (P3)', () => {
  it.each([
    [[['x', [u]]], '<u>x</u>'],
    [
      [
        ['a', [bold]],
        ['b', [bold, u]],
        ['c', [u]],
      ],
      '**a<u>b</u>**<u>c</u>',
    ],
    [
      [
        ['ab', [u]],
        ['cd', [u, bold]],
      ],
      '<u>ab**cd**</u>',
    ],
    [[['x', [u, bold]]], '<u>**x**</u>'],
    [
      [
        ['x', [u, italic]],
        ['y', [italic]],
      ],
      '*<u>x</u>y*',
    ],
    [[['x', [u, code]]], '<u>`x`</u>'],
    [[['<b>', [u]]], '<u>\\<b></u>'],
    [[['x</u>y', [u]]], '<u>x\\</u>y</u>'],
    [
      [
        ['a\\', [u]],
        ['b', []],
      ],
      '<u>a\\\\</u>b',
    ],
    [[['# x', [u]]], '<u># x</u>'],
  ] as Array<[Array<[string, Mark[]]>, string]>)('%j → %j', (parts, expected) => {
    const result = canonicalParagraph(parts);
    expect(result.text).toBe(expected);
    expect(result.exact).toBe(true);
    expect(result.readsBack).toBe(true);
  });

  it('never drops content that has no exact form (an underline starting a line)', () => {
    const result = canonicalParagraph([['\nb', [u]]]);
    expect(result.exact).toBe(false);
    expect(result.text).toContain('b');
  });
});

describe('underlined blocks keep their bytes (P1, P2)', () => {
  const file = corpusFile('58-underline.md');

  it.each(lineEndingVariants(file).concat([{ label: 'NFD', content: file.normalize('NFD') }]))(
    '[$label] editing the last paragraph leaves every underlined block byte-identical',
    ({ content }) => {
      const { doc, snapshot } = loadMarkdown(content);
      expect(saveMarkdown(doc, snapshot)).toBe(content);
      const last = doc.childCount - 1;
      const output = saveMarkdown(editWordInBlock(doc, last), snapshot);
      const lastStart = (blockRanges(snapshot)[last] as [number, number])[0];
      expect(output.slice(0, lastStart)).toBe(content.slice(0, lastStart));
      expect(output.slice(lastStart)).toContain('EDITED');
    },
  );

  it('an edited block with a non-canonical nesting is written in the canonical one', () => {
    const { doc, snapshot } = loadMarkdown('Một **<u>gạch đậm</u>** ở đây.\n\nKhác.\n');
    const saved = saveMarkdownWithSnapshot(editWordInBlock(doc, 0, 'Hai'), snapshot);
    expect(saved.text).toBe('Hai <u>**gạch đậm**</u> ở đây.\n\nKhác.\n');
    expect(saved.exact).toBe(true);
  });

  it('every block of the underline corpus file is supported', () => {
    const { doc } = loadMarkdown(file);
    const kinds: string[] = [];
    doc.forEach((node) => kinds.push(node.type.name));
    expect(kinds).not.toContain('verbatimBlock');
    expect(leaves(doc).filter((leaf) => leaf.endsWith('underline')).length).toBeGreaterThan(20);
  });
});

describe('the random grammar exercises underline', () => {
  it('many seeded documents load with underlined text', () => {
    let underlined = 0;
    for (let seed = 1; seed <= 520; seed += 1) {
      const { doc } = loadMarkdown(supportedDocument(createRandom(seed)));
      if (leaves(doc).some((leaf) => leaf.includes('underline'))) underlined += 1;
    }
    expect(underlined).toBeGreaterThan(50);
  }, 30_000);
});
