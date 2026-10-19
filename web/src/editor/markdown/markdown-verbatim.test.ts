// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { corpusFile, lineEndingVariants } from './__tests__/corpus-files';
import { editWordInBlock } from './__tests__/document-edits';
import { loadMarkdown, saveMarkdown } from './markdown-document';

/** Each unsupported construct of the corpus and the exact verbatim source it must keep. */
const UNSUPPORTED: Array<{ file: string; construct: string; source: string }> = [
  { file: '36-headings-4-6.md', construct: 'heading 4', source: '#### Tiêu đề bốn ####' },
  { file: '36-headings-4-6.md', construct: 'heading 5', source: '##### Tiêu đề năm with [[Link]]' },
  { file: '36-headings-4-6.md', construct: 'heading 6', source: '###### Sáu' },
  {
    file: '36-headings-4-6.md',
    construct: 'heading 4 in a quote',
    source: '> #### Heading four inside a quote',
  },
  {
    file: '32-html-blocks.md',
    construct: 'HTML block',
    source: '<div class="note">\n  <p>HTML block with [[Trong HTML]]</p>\n</div>',
  },
  {
    file: '32-html-blocks.md',
    construct: 'script block',
    source: '<script>\nconst x = "[[not a link]]";\n\n</script>',
  },
  {
    file: '33-html-inline.md',
    construct: 'inline HTML',
    source: 'Text with <span title="[[Trong HTML]]">[[Ngoài HTML]]</span> inline HTML.',
  },
  {
    file: '34-html-comments.md',
    construct: 'HTML comment',
    source: '<!--\nmulti-line\ncomment with [[Link]]\n-->',
  },
  {
    file: '31-math.md',
    construct: 'inline math',
    source: 'Inline math $x^2 + y^2$ in a sentence.',
  },
  { file: '31-math.md', construct: 'display math', source: '$$\n\\int_0^1 f(x)\\,dx\n$$' },
  { file: '31-math.md', construct: 'display math with a blank line', source: '$$\na\n\nb\n$$' },
  {
    file: '35-footnotes.md',
    construct: 'footnote reference',
    source: 'Text with a footnote[^1] and another[^ghi-chú].',
  },
  {
    file: '35-footnotes.md',
    construct: 'footnote definition',
    source: '[^ghi-chú]: Chú thích thứ hai.',
  },
  {
    file: '30-reference-links.md',
    construct: 'reference links',
    source: 'Xem [tài liệu][ref] và [Wikipedia][] và [shortcut].',
  },
  { file: '30-reference-links.md', construct: 'link definition', source: '[img]: hình.png' },
  {
    file: '37-custom-containers.md',
    construct: 'custom container',
    source: ':::note\nContainer on consecutive lines with [[Link]].\n:::',
  },
  {
    file: '37-custom-containers.md',
    construct: 'container with blank lines',
    source: '::: warning Title\n\nContainer with blank lines inside.\n\n- and a list\n\n:::',
  },
  {
    file: '46-callouts.md',
    construct: 'callout',
    source: '> [!note] Ghi chú\n> Callout có [[Bài 1]] và #callout',
  },
  {
    file: '23-code-fenced-backtick.md',
    construct: 'code info beyond the language',
    source: '```python title="x.py"\nprint("meta makes it verbatim")\n```',
  },
  {
    file: '48-mixed-task-lists.md',
    construct: 'mixed task list',
    source: '- [ ] task\n- plain item\n- [x] done',
  },
  {
    file: '12-wikilinks-all-forms.md',
    construct: 'wikilink inside link text',
    source: 'A [link with [[wiki]] inside](x.md) stays verbatim.',
  },
];

const FILES = [...new Set(UNSUPPORTED.map((entry) => entry.file))];

describe('unsupported constructs stay verbatim (F3.2)', () => {
  it.each(UNSUPPORTED)(
    '$construct is one verbatim block with its exact source',
    ({ file, source }) => {
      const { doc } = loadMarkdown(corpusFile(file));
      const sources: string[] = [];
      doc.forEach((node) => {
        if (node.type.name === 'verbatimBlock') sources.push(String(node.attrs['source']));
      });
      expect(sources).toContain(source);
    },
  );

  it.each(
    FILES.flatMap((file) => lineEndingVariants(corpusFile(file)).map((v) => ({ file, ...v }))),
  )(
    '$file [$label]: editing another paragraph keeps every verbatim block byte-identical',
    ({ content }) => {
      const { doc, snapshot } = loadMarkdown(content);
      let paragraph = -1;
      doc.forEach((node, _offset, index) => {
        if (
          paragraph === -1 &&
          node.type.name === 'paragraph' &&
          /\p{L}{3,}/u.test(node.textContent)
        ) {
          paragraph = index;
        }
      });
      expect(paragraph).toBeGreaterThanOrEqual(0);
      const output = saveMarkdown(editWordInBlock(doc, paragraph), snapshot);
      snapshot.blocks.forEach((block, index) => {
        if (block.node.type.name === 'verbatimBlock' && index !== paragraph) {
          expect(output).toContain(block.source);
        }
      });
      const reloaded = loadMarkdown(output);
      const verbatimBefore = snapshot.blocks.filter((b) => b.node.type.name === 'verbatimBlock');
      const verbatimAfter = reloaded.snapshot.blocks.filter(
        (b) => b.node.type.name === 'verbatimBlock',
      );
      expect(verbatimAfter.map((b) => b.source)).toEqual(verbatimBefore.map((b) => b.source));
    },
  );

  it('keeps a verbatim block in the editor as a top-level atom only', () => {
    const { doc } = loadMarkdown(corpusFile('36-headings-4-6.md'));
    const verbatim = doc.child(1);
    expect(verbatim.type.name).toBe('verbatimBlock');
    expect(verbatim.isAtom).toBe(true);
    const blockquote = doc.type.schema.nodes['blockquote']!;
    expect(
      blockquote.validContent(doc.type.schema.nodes['doc']!.create(null, [verbatim]).content),
    ).toBe(false);
  });
});
