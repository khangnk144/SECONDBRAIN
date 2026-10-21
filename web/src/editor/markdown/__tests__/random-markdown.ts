/**
 * Seeded random Markdown for property tests. `supportedDocument` builds notes from the supported
 * grammar (with the characters that need escaping; underline as `<u>…</u>`), `adversarialDocument` mixes container
 * prefixes, block starts and inline fragments the way the server's differential fuzzer does.
 * The same seed always gives the same document.
 */

export type Random = () => number;

/** mulberry32: small deterministic PRNG. */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(random: Random, list: readonly T[]): T {
  return list[Math.floor(random() * list.length)] as T;
}

function count(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

// prettier-ignore
const WORDS = [
  'giải', 'tích', 'đạo', 'hàm', 'Đồ', 'án', 'note', 'text', 'Bài', 'giảng', 'Gia\u0309i', 'Việt',
  'snake_case', 'a*b', 'x_y_z', '2*3', 'C#', 'file.md', 'www.ex.com', 'https://ex.com/a_b',
  'mail@ex.org', '&', '&amp;', '<b>', '1.', '-', '+', '>', '|', '~', '!', '\\', '[x]', 'a]b',
  '(p)', '#', '😀', 'é', 'end.',
];
// prettier-ignore
const ATOMS = [
  '[[Bài 1]]', '[[Bài 1|bài một]]', '[[Bài 1#Ý chính]]', '[[A#H|x]]', '![[sơ đồ.png]]',
  '[[2 Areas/Giải tích 1]]', '[[#Tóm tắt]]', '#tag', '#môn/giải-tích', '#snake_tag', '📅 2026-10-20',
  '`code`', '`[[in code]]`', '``a`b``', '[link](x.md)', '[t](https://e.com "T")', '![img](a.png)',
  '<https://e.com>', '[**b** l](u.md)',
];

function inline(random: Random, depth = 0): string {
  const parts: string[] = [];
  for (let i = count(random, 1, 5); i > 0; i -= 1) {
    const roll = random();
    if (roll < 0.45) parts.push(pick(random, WORDS));
    else if (roll < 0.7) parts.push(pick(random, ATOMS));
    else if (depth < 2) {
      const marker = pick(random, ['*', '_', '**', '__', '~~', '***', '<u>']);
      const close = marker === '<u>' ? '</u>' : marker;
      parts.push(`${marker}${inline(random, depth + 1)}${close}`);
    } else parts.push(pick(random, WORDS));
  }
  return parts.join(random() < 0.9 ? ' ' : '');
}

function paragraph(random: Random): string[] {
  const lines = [inline(random)];
  for (let i = count(random, 0, 2); i > 0; i -= 1) {
    const end = pick(random, ['', '', '  ', '\\']);
    lines[lines.length - 1] += end;
    lines.push(inline(random));
  }
  return lines;
}

function list(random: Random, depth: number): string[] {
  const kind = pick(random, ['bullet', 'ordered', 'task']);
  const marker = kind === 'ordered' ? pick(random, ['.', ')']) : pick(random, ['-', '*', '+']);
  const start = count(random, 0, 3) === 0 ? 0 : 1;
  const loose = random() < 0.25;
  const lines: string[] = [];
  for (let i = 0, n = count(random, 1, 3); i < n; i += 1) {
    const head =
      kind === 'ordered'
        ? `${start + i}${marker} `
        : `${marker} ${kind === 'task' ? pick(random, ['[ ] ', '[x] ']) : ''}`;
    const indent = ' '.repeat(head.length - (kind === 'task' ? 4 : 0));
    if (loose && i > 0) lines.push('');
    const body = paragraph(random);
    lines.push(head + body[0], ...body.slice(1).map((line) => indent + line));
    if (depth < 2 && random() < 0.3)
      lines.push(...list(random, depth + 1).map((line) => (line ? indent + line : line)));
  }
  return lines;
}

function table(random: Random): string[] {
  const columns = count(random, 1, 3);
  const row = (): string =>
    `| ${Array.from({ length: columns }, () => inline(random, 2).replace(/\|/g, '\\|')).join(' | ')} |`;
  const align = Array.from({ length: columns }, () => pick(random, ['---', ':--', '--:', ':-:']));
  return [row(), `| ${align.join(' | ')} |`, ...Array.from({ length: count(random, 0, 3) }, row)];
}

function block(random: Random): string[] {
  const roll = random();
  if (roll < 0.3) return paragraph(random);
  if (roll < 0.4) return [`${'#'.repeat(count(random, 1, 3))} ${inline(random)}`];
  if (roll < 0.62) return list(random, 0);
  // Quoted lines start with a word: a list inside a quote followed by more quoted blocks hits
  // a known parser quirk (see README) that the strict properties do not cover.
  if (roll < 0.7)
    return paragraph(random).map((line) => `> ${pick(random, ['giải', 'Bài', 'text'])} ${line}`);
  if (roll < 0.78) {
    const fence = pick(random, ['```', '~~~']);
    return [`${fence}${pick(random, ['', 'js', 'md'])}`, inline(random), `[[x]] #y`, fence];
  }
  if (roll < 0.82) return ['    indented code', '    [[x]] #y'];
  if (roll < 0.92) return table(random);
  return [pick(random, ['---', '***', '___'])];
}

/** A note built from supported constructs (some inline fragments still make a block verbatim). */
export function supportedDocument(random: Random): string {
  const blocks: string[] = [];
  for (let i = count(random, 1, 8); i > 0; i -= 1) blocks.push(block(random).join('\n'));
  let doc = '';
  blocks.forEach((text, index) => {
    if (index > 0) doc += pick(random, ['\n\n', '\n\n', '\n\n', '\n\n\n', '\n \n']);
    doc += text;
  });
  if (random() < 0.8) doc += '\n';
  if (random() < 0.15) doc = `---\ntags: [a]\ncourse: "[[X]]"\n---\n${doc}`;
  return doc;
}

// prettier-ignore
const PREFIXES = [
  '', '', '', '', '> ', '>', '> > ', '- ', '* ', '+ ', '1. ', '2) ', '  ', '   ', '    ', '\t',
  '- [ ] ', '- [x] ', '1. [ ] ', '-', '> - ', '- > ', '  - [ ] ', '\t- [ ] ', '- - ', '-     ',
];
// prettier-ignore
const BLOCK_STARTS = [
  '# ', '## ', '#### ', '```', '~~~', '```js', '<div>', '</div>', '<!-- ', '-->', '<pre>', '---',
  '***', '===', '| a | b |', '|---|---|', 'a | b', '[d]: x.md', '[^n]: z', ':::', '$$', '> [!note]',
];
// prettier-ignore
const FRAGMENTS = [
  ...WORDS, ...ATOMS, '$5', '[[x', 'y]]', '\\[[esc]]', '[x][d]', '[^n]', '<span>', '<!-- c -->', '$x$',
  '`', '*', '_', '[', ']', '(', ')', '  ', '<u>', '</u>', '<u>gạch</u>', '<U>', '<u class="a">',
];

/** Adversarial lines: container prefixes, block starts and inline fragments in random order. */
export function adversarialDocument(random: Random): string {
  const lines: string[] = [];
  for (let i = count(random, 1, 14); i > 0; i -= 1) {
    if (random() < 0.15) {
      lines.push('');
      continue;
    }
    let text = '';
    for (let p = count(random, 0, 2); p > 0; p -= 1) text += pick(random, PREFIXES);
    if (random() < 0.3) text += pick(random, BLOCK_STARTS) + (random() < 0.5 ? ' ' : '');
    for (let f = count(random, 0, 5); f > 0; f -= 1)
      text += pick(random, FRAGMENTS) + (random() < 0.7 ? ' ' : '');
    lines.push(text);
  }
  const eol = random() < 0.25 ? '\r\n' : '\n';
  let doc = lines.join(eol);
  if (random() < 0.5) doc += eol;
  if (random() < 0.1) doc = `---${eol}tags: [a]${eol}---${eol}${doc}`;
  if (random() < 0.05) doc = `\uFEFF${doc}`;
  return doc;
}
