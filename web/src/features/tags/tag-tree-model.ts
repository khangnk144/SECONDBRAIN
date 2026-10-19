import type { TagCount } from '../../lib/api/search-types';

export interface TagNode {
  /** Normalized path of the node (`môn/giải-tích`), unique among all nodes. */
  key: string;
  /** Last segment as displayed (`giải-tích`). */
  segment: string;
  /** Displayed tag up to this node (`môn/giải-tích`), used for `tag:` searches. */
  tag: string;
  /** Notes carrying exactly this tag, as the server counts them; null for a pure group. */
  count: number | null;
  children: TagNode[];
}

const splitTag = (tag: string) => tag.split('/').filter((segment) => segment !== '');

/**
 * Nests tags by `/` (`môn/giải-tích` under `môn`); a parent nobody tagged directly becomes a
 * group without a count. Siblings are sorted the Vietnamese way (`Intl.Collator('vi')`).
 */
export function buildTagTree(tags: readonly TagCount[], locale = 'vi'): TagNode[] {
  const roots: TagNode[] = [];
  const byKey = new Map<string, TagNode>();
  for (const entry of tags) {
    const shown = splitTag(entry.tag);
    const norm = splitTag(entry.norm);
    // Both spellings have the same shape in practice; fall back to the displayed one if not.
    const keys = norm.length === shown.length ? norm : shown;
    let siblings = roots;
    keys.forEach((_, depth) => {
      const key = keys.slice(0, depth + 1).join('/');
      let node = byKey.get(key);
      if (!node) {
        node = {
          key,
          segment: shown[depth] ?? '',
          tag: shown.slice(0, depth + 1).join('/'),
          count: null,
          children: [],
        };
        byKey.set(key, node);
        siblings.push(node);
      }
      if (depth === keys.length - 1) node.count = (node.count ?? 0) + entry.count;
      siblings = node.children;
    });
  }
  const collator = new Intl.Collator(locale, { numeric: true });
  const sort = (nodes: TagNode[]) => {
    nodes.sort((a, b) => collator.compare(a.segment, b.segment) || (a.key < b.key ? -1 : 1));
    nodes.forEach((node) => sort(node.children));
  };
  sort(roots);
  return roots;
}
