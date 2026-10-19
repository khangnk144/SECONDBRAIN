// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { loadMarkdown, saveMarkdown } from './markdown-document';
import { splitFrontmatter } from './frontmatter-split';

// Cases copied from the server's front matter tests (server/test/markdown/parse-note-frontmatter.test.ts):
// the editor must find the same block, from the opening fence through the closing fence's line end.
const SERVER_CASES: Array<{ content: string; raw: string | null }> = [
  {
    content: '\uFEFF---\r\ntype: note\r\ntags: [a]\r\n...\r\nBody #b\r\n',
    raw: '---\r\ntype: note\r\ntags: [a]\r\n...\r\n',
  },
  { content: '---\n---\nx', raw: '---\n---\n' },
  { content: '---\njust text\n---\n', raw: '---\njust text\n---\n' },
  { content: '\n---\na: 1\n---\n', raw: null },
  { content: '---\na: 1\nno closing fence\n', raw: null },
  { content: '--- \na: 1\n--- \n', raw: '--- \na: 1\n--- \n' },
  {
    content: '---\ncreated: {{date}}\ntitle: "{{title}}"\n---\n',
    raw: '---\ncreated: {{date}}\ntitle: "{{title}}"\n---\n',
  },
  {
    content: '---\ntitle: [unclosed\ncourse: "[[Giải tích 1]]"\n---\nBody with [[Link]] and #tag.',
    raw: '---\ntitle: [unclosed\ncourse: "[[Giải tích 1]]"\n---\n',
  },
];

const MORE_CASES: Array<{ name: string; content: string; raw: string | null }> = [
  { name: 'lone CR line ends', content: '---\ra: 1\r---\rbody', raw: '---\ra: 1\r---\r' },
  { name: 'closing fence at end of file', content: '---\na: 1\n---', raw: '---\na: 1\n---' },
  { name: 'four dashes', content: '----\na: 1\n----\n', raw: null },
  { name: 'indented fence', content: ' ---\na: 1\n---\n', raw: null },
  { name: 'fence with text', content: '---x\na: 1\n---\n', raw: null },
  { name: 'only an opening fence', content: '---\n', raw: null },
  { name: 'dots closer with spaces', content: '---\na: 1\n... \nbody', raw: '---\na: 1\n... \n' },
];

describe('front matter detection agrees with the server (F7)', () => {
  it.each(SERVER_CASES)('server case %#', ({ content, raw }) => {
    expect(splitFrontmatter(content).raw).toBe(raw);
  });

  it.each(MORE_CASES)('$name', ({ content, raw }) => {
    expect(splitFrontmatter(content).raw).toBe(raw);
  });

  it.each([...SERVER_CASES, ...MORE_CASES])(
    'keeps the block outside the editor and round-trips (%#)',
    ({ content, raw }) => {
      const loaded = loadMarkdown(content);
      expect(loaded.frontmatter?.raw ?? null).toBe(raw);
      expect(saveMarkdown(loaded.doc, loaded.snapshot)).toBe(content);
    },
  );
});
