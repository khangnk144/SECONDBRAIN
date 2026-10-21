/**
 * Citations in a text answer. The server turns each `[S1]` marker into a link right where the
 * model put it (`…thông tin mới [[path|Xác suất thống kê]].`, several joined by ", ", a PDF page
 * as " (tr. 3)" after its link), and text answers carry no other links (the prompt forbids them).
 * Shown bare, a title reads as part of the sentence; grouped, it renders as "(Xác suất thống kê)".
 */
import type { Inline } from './answer-markdown';

export interface CitedLink {
  target: string;
  label: string;
  page: number | null;
}

export interface CitedGroup {
  kind: 'cite';
  links: CitedLink[];
}

export interface CitedEmphasis {
  kind: 'bold' | 'italic';
  children: CitedInline[];
}

export type CitedInline =
  Exclude<Inline, { kind: 'bold' | 'italic' | 'link' }> | CitedGroup | CitedEmphasis;

const PAGE_TEXT = /^ \((?:tr\.|p\.) \d{1,5}\)/;
const JOIN = ', ';

/** Groups each run of links (`a, b`) into one citation; a page text moves into the group. */
export function groupCitations(nodes: readonly Inline[]): CitedInline[] {
  const out: CitedInline[] = [];
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i];
    i += 1;
    if (!node) continue;
    if (node.kind === 'bold' || node.kind === 'italic') {
      out.push({ kind: node.kind, children: groupCitations(node.children) });
      continue;
    }
    if (node.kind !== 'link') {
      out.push(node);
      continue;
    }
    const group: CitedGroup = { kind: 'cite', links: [] };
    let link: Inline | undefined = node;
    while (link?.kind === 'link') {
      group.links.push({ target: link.target, label: link.label, page: link.page });
      // `i` is now the node after this link: the joiner, the sentence going on, or nothing.
      const next = nodes[i];
      let after = next?.kind === 'text' ? next.text : null;
      if (after !== null && link.page !== null) after = after.replace(PAGE_TEXT, '');
      link = undefined;
      if (after === JOIN && nodes[i + 1]?.kind === 'link') {
        link = nodes[i + 1];
        i += 2;
      } else if (after !== null) {
        // The rest of that text (its page text taken out) follows the group.
        i += 1;
        out.push(group);
        if (after !== '') out.push({ kind: 'text', text: after });
      } else out.push(group);
    }
  }
  return out;
}
