/**
 * The small Markdown of AI answers, parsed into a tree that React renders as text (never HTML
 * from the answer): paragraphs, `-`/`*` and `1.` lists, `**bold**`, `*italic*`, `` `code` ``,
 * `[[target|alias]]` and `[[target]]` links. A heading line is shown as a bold paragraph. Anything
 * else stays literal text. Line breaks inside a paragraph are kept (answers are short and the
 * structured lists rely on them).
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; children: Inline[] }
  | { kind: 'italic'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'break' }
  /** `page` comes from a "(tr. 3)" / "(p. 3)" right after a link to a PDF. */
  | { kind: 'link'; target: string; label: string; page: number | null };

export type Block =
  { kind: 'paragraph'; children: Inline[] } | { kind: 'list'; ordered: boolean; items: Inline[][] };

const LIST_ITEM = /^\s{0,3}([-*+]|\d{1,3}[.)])\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const PAGE_AFTER_LINK = /^ \((?:tr\.|p\.) (\d{1,5})\)/;

/**
 * A `[[…]]` link, found exactly where the server's citation check finds one (it checks every link
 * it would render, escaped or not): the innermost `[[` opens (`[[[x]]]` links `x`), a link never
 * spans lines nor holds another `[[`, and `\|` also separates the alias.
 */
function parseLink(text: string, start: number): { node: Inline; end: number } | null {
  if (text[start + 2] === '[') return null;
  const close = text.indexOf(']]', start + 2);
  if (close === -1) return null;
  const inner = text.slice(start + 2, close);
  if (inner.includes('[[') || inner.includes('\n') || inner.trim() === '') return null;
  const bar = inner.indexOf('|');
  const targetPart = bar === -1 ? inner : inner.slice(0, bar).replace(/\\$/, '');
  const target = targetPart.trim();
  const alias = bar === -1 ? '' : inner.slice(bar + 1).trim();
  const page = PAGE_AFTER_LINK.exec(text.slice(close + 2));
  return {
    node: {
      kind: 'link',
      target,
      label: alias || target.replace(/\.md$/i, '').split('/').pop() || target,
      page: page ? Number(page[1]) : null,
    },
    end: close + 2,
  };
}

/** `*x*` opens on a non-space and closes after one (so `2 * 3 * 4` stays text). */
function parseEmphasis(text: string, start: number, marker: '**' | '*') {
  const open = start + marker.length;
  if (open >= text.length || /\s/.test(text[open] ?? ' ')) return null;
  let close = text.indexOf(marker, open);
  // A single `*` must not close on the first half of a `**`.
  while (marker === '*' && close !== -1 && text[close + 1] === '*') {
    close = text.indexOf(marker, close + 2);
  }
  if (close === -1 || close === open || /\s/.test(text[close - 1] ?? ' ')) return null;
  const children = parseInline(text.slice(open, close));
  const node: Inline = marker === '**' ? { kind: 'bold', children } : { kind: 'italic', children };
  return { node, end: close + marker.length };
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer !== '') out.push({ kind: 'text', text: buffer });
    buffer = '';
  };
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    let parsed: { node: Inline; end: number } | null = null;
    if (char === '\n') parsed = { node: { kind: 'break' }, end: i + 1 };
    else if (char === '`') {
      const close = text.indexOf('`', i + 1);
      if (close > i + 1)
        parsed = { node: { kind: 'code', text: text.slice(i + 1, close) }, end: close + 1 };
    } else if (text.startsWith('[[', i)) parsed = parseLink(text, i);
    else if (text.startsWith('**', i)) parsed = parseEmphasis(text, i, '**');
    else if (char === '*') parsed = parseEmphasis(text, i, '*');
    if (parsed) {
      flush();
      out.push(parsed.node);
      i = parsed.end;
    } else {
      buffer += char;
      i += 1;
    }
  }
  flush();
  return out;
}

export function parseAnswer(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] | null = null;
  let list: { ordered: boolean; items: string[] } | null = null;
  const close = () => {
    if (paragraph) blocks.push({ kind: 'paragraph', children: parseInline(paragraph.join('\n')) });
    if (list) {
      blocks.push({ kind: 'list', ordered: list.ordered, items: list.items.map(parseInline) });
    }
    paragraph = null;
    list = null;
  };
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim() === '') {
      close();
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const ordered = /\d/.test(item[1] ?? '');
      if (!list || list.ordered !== ordered) {
        close();
        list = { ordered, items: [] };
      }
      list.items.push(item[2] ?? '');
      continue;
    }
    if (list && /^\s{2,}/.test(line)) {
      // An indented line continues the item above it.
      list.items[list.items.length - 1] += `\n${line.trim()}`;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      close();
      blocks.push({
        kind: 'paragraph',
        children: [{ kind: 'bold', children: parseInline(heading[1] ?? '') }],
      });
      continue;
    }
    if (list) close();
    (paragraph ??= []).push(line);
  }
  close();
  return blocks;
}
