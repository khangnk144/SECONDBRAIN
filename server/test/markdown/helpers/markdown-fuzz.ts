/**
 * Seeded generator of adversarial Markdown for differential tests: random lines built from
 * container prefixes (quotes, list markers, tabs, indentation), block starts (fences, HTML,
 * headings, setext underlines, tables) and inline fragments (brackets, code spans, HTML,
 * entities, emphasis, wikilinks, tags, task tokens). The same seed always yields the same docs.
 */

// prettier-ignore
const PREFIXES = [
  '', '', '', '', '> ', '>', '> > ', '- ', '* ', '+ ', '1. ', '2) ', '10. ', '01. ', '  ', '   ',
  '    ', '     ', '\t', '\t\t', ' \t', '   - ', '  > ', '- [ ] ', '- [x] ', '* [X] ', '1. [ ] ',
  '- [ ]', '- [x]\t', '-', '- ', '-\t', '> - ', '- > ', '  - [ ] ', '\t- [ ] ', '- - ', '-    ',
  '-      ', '[ ] ', '> [x] ',
];

// prettier-ignore
const BLOCK_STARTS = [
  '#', '# ', '## ', '###### ', '####### ', '#\t', '```', '~~~', '```js', '````', '``` a`b',
  '<div>', '</div>', '<div class="x">', '<!-- ', '-->', '<pre>', '</pre>', '<span>',
  '<custom-tag>', '<?', '?>', '<!DOCTYPE html>', '<![CDATA[', ']]>', '<script>', '</script>',
  '<details>', '---', '***', '___', '===', '- - -', '* * *', '--', '==', '| a | b |', '|---|---|',
  '| - | :-: |', 'a | b', '- | -', ':-', '|a|', '|-|', '| --- |', 'x | y | z', '-|-|-', '|', '||',
  '\\|', '[d]: x.md', '[r]: <a b.md> "t"', '[^n]: z', '[^1]:', '[^n]:', '[ref]:', '[^a b]: y',
];

// prettier-ignore
const INLINE = [
  'text', 'Giải tích', 'Đồ án', 'Gia\u0309i ti\u0301ch', '[[Bài 1]]', '[[A|b]]', '[[A#H]]',
  '![[img.png]]', '[[a\\|b]]', '[[2 Areas/X]]', '[[#Heading]]', '[[]]', '[[x', 'y]]', '`code`',
  '``a`b``', '`', '``', '` [[in code]] `', '[link](a.md)', '[l](<a b.md>)', '[l](a.md "t")',
  "[l](a.md 'title')", '[l](a.md (t))', '![i](x.png)', '[a [b](c.md)](d.md)',
  '[![img](i.png)](t.md)', '![a [b](c.md)](d.png)', '[', ']', '(', ')', '](x.md)', '[x]', '[x][y]',
  '[^1]', '<b>', '</b>', '<a href="x">', '<a href="](y.md)">', '<br/>', '<http://x.y>', '<a@b.co>',
  '<!-- c -->', '&amp;', '&#35;', '&#x5B;', '&#0;', '&lt;', '\\[', '\\`', '\\*', '\\', '\\#tag',
  '*em*', '**b**', '_u_', '__s__', '~~s~~', '~x~', '*', '_', 'snake_case', '#tag', '#1',
  '#môn/giải-tích', '#a/', '(#x)', '](#x)', '#tag#tag', 'x#y', '📅 2026-10-20',
  '📅\uFE0F 2026-01-01', '✅ 2026-02-30', '📅 2026-13-01', 'www.example.com', 'http://e.com/#frag',
  '[a](#frag)', '[a](../up.md#h)', '[a](%C3%A1.md)', '[a](b%2.md)', '[a](mailto:x@y.z)',
  '[a](https://x)', '[a](<>)', '[a]()', '[a]( b.md )', '[a](b.md\n"t")', '  ', '\t', 'é', '😀',
  '[x](y.md)z', 'a|b', '[^n]', '[^1]', '[r]', '[r][r]', '[x][r]', '[r][]', '![r]', '![^n]', '[d](z.md)',
  'https://x.com/a[b](c.md)', 'www.x.com[b]', 'http://e.com/`c`', '(https://q.com)', '&mdash;',
  '&eacute;', '&copy;', 'https://a.b/c_(d)_', 'www.e.com&amp;',
];

/** Small deterministic PRNG (mulberry32). */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, list: readonly T[]): T {
  return list[Math.floor(random() * list.length)] as T;
}

function line(random: () => number): string {
  const roll = random();
  if (roll < 0.12) return '';
  let text = '';
  const prefixes = Math.floor(random() * 3);
  for (let i = 0; i < prefixes; i += 1) text += pick(random, PREFIXES);
  if (random() < 0.3) text += pick(random, BLOCK_STARTS) + (random() < 0.5 ? ' ' : '');
  const fragments = Math.floor(random() * 5);
  for (let i = 0; i < fragments; i += 1) {
    text += pick(random, INLINE) + (random() < 0.7 ? ' ' : '');
  }
  return text;
}

/** One random document of 1–14 lines (LF or CRLF, sometimes a BOM or front matter). */
export function fuzzDocument(random: () => number): string {
  const count = 1 + Math.floor(random() * 14);
  const lines: string[] = [];
  for (let i = 0; i < count; i += 1) lines.push(line(random));
  const eol = random() < 0.2 ? '\r\n' : '\n';
  let doc = lines.join(eol);
  if (random() < 0.5) doc += eol;
  if (random() < 0.1) doc = `---${eol}tags: [a]${eol}course: "[[X]]"${eol}---${eol}${doc}`;
  if (random() < 0.05) doc = `\uFEFF${doc}`;
  return doc;
}
