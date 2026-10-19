/**
 * What `loadMarkdown` remembers about the file so that `saveMarkdown` can write every unchanged
 * byte back as it was. All strings are original file bytes (CRLF kept) unless noted otherwise.
 */
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import type { Eol } from './line-endings';

export interface SourceBlock {
  /** The editor node parsed from `source`. */
  readonly node: ProseMirrorNode;
  /**
   * Bytes between the previous sibling and this block. For the first top-level block this is
   * the body's leading text; for the first child of a list item it is empty.
   */
  readonly gap: string;
  readonly source: string;
  /**
   * Line prefix for re-serialised text that starts where this block starts: the text before the
   * block on its first line, with every character except `>` turned into a space (so `> - [ ] `
   * gives `>       `); tabs are kept in place so the column stays the same.
   */
  readonly prefix: string | null;
  /** Item structure when the block is a list. */
  readonly list: ListSource | null;
  /** Child structure when the block is a block quote. */
  readonly quote: QuoteSource | null;
}

export interface QuoteSource {
  /** The quote marker(s) up to the first child (the whole quote when it is empty). */
  readonly head: string;
  readonly children: readonly SourceBlock[];
  readonly tail: string;
}

export interface ListSource {
  readonly ordered: boolean;
  /** Bullet character (`-`, `*`, `+`) or ordered delimiter (`.`, `)`) used by the items. */
  readonly marker: string;
  /** Ordered numbers go up by one from the first item. */
  readonly incrementing: boolean;
  readonly items: readonly ItemSource[];
  /** Bytes after the last item up to the list's end (a quote's blank `>` line can end a list). */
  readonly tail: string;
}

export interface ItemSource {
  readonly node: ProseMirrorNode;
  /** Bytes between the previous item and this one (empty for the first item). */
  readonly gap: string;
  /** Marker, spacing and checkbox up to the first child (the whole item when it is empty). */
  readonly head: string;
  /** The item's blocks; empty when the item has no content. */
  readonly children: readonly SourceBlock[];
  /** Bytes after the last child up to the item's end. */
  readonly tail: string;
  /** Line prefix at the item marker (see `SourceBlock.prefix`). */
  readonly prefix: string | null;
  /** The number written in an ordered item. */
  readonly number: number | null;
}

export interface MarkdownSnapshot {
  readonly schema: Schema;
  readonly bom: boolean;
  /** The front matter block with its fences and closing line ending; empty when absent. */
  readonly frontmatter: string;
  readonly eol: Eol;
  readonly blocks: readonly SourceBlock[];
  /** Bytes after the last block (the whole body when there is no block). */
  readonly trailing: string;
  /** Top-level definitions to parse in front of partial texts (see markdown-parser). */
  readonly definitionsPrefix: string;
}

/** The original bytes of an item or a quote: head, children with their gaps, tail. */
export function containerSource(container: ItemSource | QuoteSource): string {
  let source = container.head;
  for (const child of container.children) source += child.gap + child.source;
  return source + container.tail;
}
