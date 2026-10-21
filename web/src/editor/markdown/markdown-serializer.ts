/**
 * Canonical Markdown for edited blocks (SPEC §4.9 P3): `-` bullets, `1.` numbers, `**bold**`,
 * `*italic*`, `~~strike~~`, fenced code, `---` rules, ATX headings (setext only for a multi-line
 * heading), GFM tables, `<u>…</u>` for underline. Escaping comes from mdast-util-to-markdown, with
 * two adjustments so that the server reads the same tags: `#tag` at a line start is not escaped
 * (only a real heading marker is), and wikilinks are written raw.
 */
import type { Parents, Root, RootContent } from 'mdast';
import { gfmToMarkdown } from 'mdast-util-gfm';
import {
  defaultHandlers,
  toMarkdown,
  type Handle,
  type Info,
  type Options,
  type State,
  type Unsafe,
} from 'mdast-util-to-markdown';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { toMdastBlock } from './prosemirror-to-mdast';
import type { MdastLiteral, MdastUnderline, MdastWikilink } from './prosemirror-inline-to-mdast';
import { formatWikilink } from './wikilink-syntax';

export interface MarkerOptions {
  bullet?: '-' | '*' | '+';
  bulletOrdered?: '.' | ')';
}

// `peek` tells the serializer the first character, so text before the node is escaped right.
const wikilink = Object.assign(
  (node: MdastWikilink, _parent: unknown, state: { stack: string[] }) =>
    formatWikilink(node, state.stack.includes('tableCell')),
  { peek: (node: MdastWikilink) => (node.embed ? '!' : '[') },
);

const literal = Object.assign((node: MdastLiteral) => node.value, {
  peek: (node: MdastLiteral) => node.value.charAt(0),
});

const literalBlock: Handle = (node: MdastLiteral) => node.value;

// The tags are punctuation on both sides, so the content is escaped as if it sat between `>`
// and `<` (an emphasis run inside always flanks correctly), and text around it sees a `<`.
const underline = Object.assign(
  (node: MdastUnderline, _parent: unknown, state: State, info: Info) => {
    const tracker = state.createTracker(info);
    let value = tracker.move('<u>');
    value += tracker.move(
      state.containerPhrasing(node as unknown as Parents, {
        ...tracker.current(),
        before: '>',
        after: '<',
      }),
    );
    return value + tracker.move('</u>');
  },
  { peek: () => '<' },
);

// `#` only starts an ATX heading when one to six of them are followed by a space or line end.
const HEADING_HASH: Unsafe = { atBreak: true, character: '#', after: '#{0,5}(?:[ \\t\\r\\n]|$)' };
const adjusted = new WeakMap<Unsafe, Unsafe>();

/**
 * The escaping rules, adjusted: the `#` rule above, and every `after` condition turned into a
 * lookahead. A consuming `after` swallows the line break a following line-start rule needs, so
 * `-\n- [ ] x` would keep its second `-` unescaped and turn into a list.
 */
function adjust(pattern: Unsafe): Unsafe {
  let result = adjusted.get(pattern);
  if (!result) {
    const base =
      pattern.atBreak && pattern.character === '#' && !pattern.after ? HEADING_HASH : pattern;
    result = base.after ? { ...base, after: `(?=${base.after})` } : base;
    adjusted.set(pattern, result);
  }
  return result;
}

const root: Handle = (node: Root, parent, state, info) => {
  state.unsafe = state.unsafe.map(adjust);
  return defaultHandlers.root(node, parent, state, info);
};

// In a tight list item, `---` right below a paragraph would turn it into a setext heading.
const thematicBreak: Handle = (node, parent: Parents | undefined, state) => {
  const siblings = parent?.children ?? [];
  const previous = siblings[siblings.indexOf(node) - 1];
  if (parent && 'spread' in parent && !parent.spread && previous?.type === 'paragraph') {
    return '***';
  }
  return defaultHandlers.thematicBreak(node, parent, state);
};

// CommonMark autolinks: `<scheme:…>` and `<local@domain>`. Anything else needs `[text](url)`.
const URI_AUTOLINK = /^<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>\p{Cc}]*>$/u;
const EMAIL_AUTOLINK =
  /^<[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*>$/;

/** The default link writer, but never an autolink that would not parse back as one. */
const link: Handle = (node, parent, state, info) => {
  const value = defaultHandlers.link(node, parent, state, info);
  const pipeInTable = state.stack.includes('tableCell') && /\|/.test(String(node.url));
  const valid = URI_AUTOLINK.test(value) || EMAIL_AUTOLINK.test(value);
  if (!value.startsWith('<') || (valid && !pipeInTable)) return value;
  const resourceLink = state.options.resourceLink;
  state.options.resourceLink = true;
  try {
    return defaultHandlers.link(node, parent, state, info);
  } finally {
    state.options.resourceLink = resourceLink;
  }
};

const BASE_OPTIONS: Options = {
  bullet: '-',
  bulletOther: '*',
  bulletOrdered: '.',
  emphasis: '*',
  strong: '*',
  fence: '`',
  fences: true,
  rule: '-',
  ruleRepetition: 3,
  ruleSpaces: false,
  setext: false,
  closeAtx: false,
  listItemIndent: 'one',
  incrementListMarker: true,
  resourceLink: false,
  quote: '"',
  extensions: [gfmToMarkdown()],
  handlers: {
    root,
    link,
    thematicBreak,
    wikilink,
    literal,
    literalBlock,
    underline,
  } as Options['handlers'],
};

/** Serialises mdast flow content with `\n` line ends and no final line ending. */
export function serializeMdast(content: RootContent, markers: MarkerOptions = {}): string {
  const options: Options = { ...BASE_OPTIONS, ...markers };
  if (markers.bullet) options.bulletOther = markers.bullet === '*' ? '-' : '*';
  const output = toMarkdown({ type: 'root', children: [content] }, options);
  return output.endsWith('\n') ? output.slice(0, -1) : output;
}

export function serializeBlock(node: ProseMirrorNode, markers: MarkerOptions = {}): string {
  return serializeMdast(toMdastBlock(node), markers);
}
