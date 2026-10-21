import { Extension } from '@tiptap/core';
import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { i18n } from '../../i18n';
import { showToast } from '../../lib/toast-store';
import { loadMarkdown } from '../markdown/markdown-document';

const BLOCK_SYNTAX = /^(#{1,6}\s|[-*+]\s|\d{1,9}[.)]\s|>|```|~~~|\|.*\|\s*$|(-{3,}|\*{3,})\s*$)/m;
const INLINE_SYNTAX =
  /\*\*[^*\n]+\*\*|~~[^~\n]+~~|`[^`\n]+`|\[\[[^\]\n]+\]\]|\[[^\]\n]+\]\([^)\n]+\)|<u>[^<\n]+<\/u>|(^|\s)[*_][^*_\s][^*_\n]*[*_](?=\s|$|[.,!?])/;

/** Plain text that carries Markdown syntax (as copied from another Markdown editor or a file). */
export function looksLikeMarkdown(text: string): boolean {
  return BLOCK_SYNTAX.test(text) || INLINE_SYNTAX.test(text);
}

/**
 * Paste: Markdown-looking plain text (`<u>…</u>` included) is parsed with the converter and
 * inserted as content (one line stays inline); HTML is limited to the schema (ProseMirror's
 * parser, which keeps `<u>` and `text-decoration: underline` as underline); pasted images are
 * left out with a toast until attachments exist.
 */
export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',

  addProseMirrorPlugins() {
    let droppedImages = false;
    return [
      new Plugin({
        key: new PluginKey('markdownPaste'),
        props: {
          transformPastedHTML: (html) => {
            droppedImages = !html.includes('data-pm-slice') && /<img[\s>]/i.test(html);
            return html;
          },
          transformPasted: (slice) => {
            if (!droppedImages) return slice;
            droppedImages = false;
            showImageToast();
            return new Slice(withoutImages(slice.content), slice.openStart, slice.openEnd);
          },
          handlePaste: (view, event) => {
            const data = event.clipboardData;
            if (!data) return false;
            const text = data.getData('text/plain');
            const html = data.getData('text/html');
            if (hasImageFile(data)) {
              showImageToast();
              if (!text && !html) return true;
            }
            if (
              !text ||
              html.includes('data-pm-slice') ||
              view.state.selection.$from.parent.type.spec.code
            ) {
              return false;
            }
            return looksLikeMarkdown(text) && insertMarkdown(view, text);
          },
        },
      }),
    ];
  },
});

function showImageToast(): void {
  showToast({ message: i18n.t('editor.paste.imageLater') });
}

function hasImageFile(data: DataTransfer): boolean {
  return Array.from(data.items ?? []).some(
    (item) => item.kind === 'file' && item.type.startsWith('image/'),
  );
}

function withoutImages(fragment: Fragment): Fragment {
  const nodes: ProseMirrorNode[] = [];
  fragment.forEach((node) => {
    if (node.type.name === 'image') return;
    nodes.push(node.isLeaf ? node : node.copy(withoutImages(node.content)));
  });
  return Fragment.fromArray(nodes);
}

/** Markdown parsing trims a line; inline pastes keep the spaces around the copied words. */
function withEdgeSpaces(content: Fragment, source: string): Fragment {
  const schema = content.firstChild?.type.schema;
  if (!schema) return content;
  const leading = /^[ \t]*/.exec(source)?.[0] ?? '';
  const trailing = /[ \t]*$/.exec(source.replace(/\n+$/, ''))?.[0] ?? '';
  let result = content;
  if (leading) result = Fragment.from(schema.text(leading)).append(result);
  if (trailing) result = result.append(Fragment.from(schema.text(trailing)));
  return result;
}

function insertMarkdown(view: EditorView, text: string): boolean {
  const source = text.replace(/\r\n?/g, '\n');
  const loaded = loadMarkdown(source);
  // Text starting with a YAML block is not something to paste as note content.
  if (loaded.frontmatter) return false;
  const { doc } = loaded;
  const { $from } = view.state.selection;
  const singleLine = !source.trim().includes('\n');
  let slice: Slice;
  if (singleLine && doc.childCount === 1 && doc.firstChild?.type.name === 'paragraph') {
    slice = new Slice(withEdgeSpaces(doc.firstChild.content, source), 0, 0);
  } else if (singleLine && $from.parent.content.size > 0) {
    return false; // one line of block syntax inside text stays text
  } else if ($from.parent.isTextblock && $from.parent.content.size === 0) {
    slice = new Slice(doc.content, 0, 0);
  } else {
    slice = Slice.maxOpen(doc.content);
  }
  const tr = view.state.tr.replaceSelection(slice).scrollIntoView();
  view.dispatch(tr.setMeta('paste', true).setMeta('uiEvent', 'paste'));
  return true;
}
