/**
 * mdast phrasing content → ProseMirror inline nodes. Wikilinks are cut out of `text` nodes at the
 * places where the server's raw-text scan finds them; a wikilink anywhere else (inside a link,
 * an image description, or across emphasis) cannot be represented and rejects the block.
 * Underline is the one piece of inline HTML the editor holds: an exact `<u>` … `</u>` pair of
 * sibling HTML nodes around supported content (see `underlineEnd`); any other HTML rejects the
 * block, which then stays verbatim.
 */
import type { Html, PhrasingContent, Text } from 'mdast';
import type { Mark, Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import { alignRawToValue } from './text-alignment';
import { UnsupportedConstruct } from './unsupported-constructs';
import type { WikilinkHit } from './wikilink-syntax';

export interface InlineContext {
  schema: Schema;
  /** The whole `\n`-only body text the mdast offsets point into. */
  text: string;
  /** Wikilinks the server sees in the current block, by absolute offset. */
  hits: readonly WikilinkHit[];
  claimed: Set<WikilinkHit>;
}

export function convertInline(
  children: readonly PhrasingContent[],
  context: InlineContext,
  marks: readonly Mark[] = [],
  inLink = false,
): ProseMirrorNode[] {
  const out: ProseMirrorNode[] = [];
  const { schema } = context;
  const mark = (name: string, attrs?: Record<string, unknown>): readonly Mark[] =>
    markType(schema, name).create(attrs).addToSet(marks);
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index] as PhrasingContent;
    switch (child.type) {
      case 'text':
        convertText(child, context, marks, inLink, out);
        break;
      case 'emphasis':
        out.push(...convertInline(child.children, context, mark('italic'), inLink));
        break;
      case 'strong':
        out.push(...convertInline(child.children, context, mark('bold'), inLink));
        break;
      case 'delete':
        out.push(...convertInline(child.children, context, mark('strike'), inLink));
        break;
      case 'inlineCode':
        if (child.value === '') throw new UnsupportedConstruct('empty code span');
        // A code span renders its line breaks as spaces (CommonMark); the editor holds it so.
        out.push(schema.text(child.value.replace(/\r\n|\r|\n/g, ' '), mark('code')));
        break;
      case 'link': {
        if (inLink || child.children.length === 0) throw new UnsupportedConstruct('link shape');
        const linkMarks = mark('link', { href: child.url, title: child.title || null });
        out.push(...convertInline(child.children, context, linkMarks, true));
        break;
      }
      case 'image':
        out.push(
          nodeType(schema, 'image').create(
            { src: child.url, alt: child.alt || null, title: child.title || null },
            null,
            marks,
          ),
        );
        break;
      case 'break':
        out.push(nodeType(schema, 'hardBreak').create(null, null, marks));
        break;
      case 'html': {
        const end = underlineEnd(children, index, marks);
        const inside = children.slice(index + 1, end);
        out.push(...convertInline(inside, context, mark('underline'), inLink));
        index = end;
        break;
      }
      default:
        throw new UnsupportedConstruct(child.type);
    }
  }
  return out;
}

function convertText(
  node: Text,
  context: InlineContext,
  marks: readonly Mark[],
  inLink: boolean,
  out: ProseMirrorNode[],
): void {
  const start = node.position?.start.offset ?? 0;
  const end = node.position?.end.offset ?? 0;
  const inside = inLink ? [] : context.hits.filter((hit) => hit.start >= start && hit.end <= end);
  const push = (value: string): void => {
    if (value !== '') out.push(context.schema.text(value, marks));
  };
  if (inside.length === 0) {
    push(node.value);
    return;
  }
  const alignment = alignRawToValue(context.text.slice(start, end), node.value);
  if (!alignment) throw new UnsupportedConstruct('text around a wikilink');
  let valuePos = 0;
  for (const hit of inside) {
    const rawStart = hit.start - start;
    const rawEnd = hit.end - start;
    if (!alignment.boundary[rawStart] || !alignment.boundary[rawEnd]) {
      throw new UnsupportedConstruct('escaped wikilink boundary');
    }
    push(node.value.slice(valuePos, alignment.valueAt[rawStart]));
    const { target, heading, alias, embed } = hit;
    out.push(
      nodeType(context.schema, 'wikilink').create({ target, heading, alias, embed }, null, marks),
    );
    valuePos = alignment.valueAt[rawEnd] as number;
    context.claimed.add(hit);
  }
  push(node.value.slice(valuePos));
}

const UNDERLINE_OPEN = '<u>';
const UNDERLINE_CLOSE = '</u>';

/**
 * Index of the `</u>` that closes the `<u>` at `start`: the next HTML sibling, exactly `</u>`,
 * with content in between. Anything else – other or uppercase tags, attributes, an unpaired or
 * empty pair, `<u>` inside underlined content – has no editor form and rejects the block.
 */
function underlineEnd(
  children: readonly PhrasingContent[],
  start: number,
  marks: readonly Mark[],
): number {
  const open = children[start] as Html;
  if (open.value !== UNDERLINE_OPEN || marks.some((mark) => mark.type.name === 'underline')) {
    throw new UnsupportedConstruct('inline HTML');
  }
  const end = children.findIndex((child, index) => index > start && child.type === 'html');
  if (end === -1 || (children[end] as Html).value !== UNDERLINE_CLOSE) {
    throw new UnsupportedConstruct('unpaired underline');
  }
  if (end === start + 1) throw new UnsupportedConstruct('empty underline');
  return end;
}

function markType(schema: Schema, name: string) {
  const type = schema.marks[name];
  if (!type) throw new UnsupportedConstruct(`mark ${name} missing from schema`);
  return type;
}

export function nodeType(schema: Schema, name: string) {
  const type = schema.nodes[name];
  if (!type) throw new UnsupportedConstruct(`node ${name} missing from schema`);
  return type;
}
