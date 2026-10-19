import type { NodeViewRendererProps } from '@tiptap/core';
import type { NodeView } from '@tiptap/pm/view';
import { i18n } from '../../i18n';

/**
 * A block the editor cannot represent (SPEC §4.9): its raw Markdown, read-only, with a subtle
 * "nguồn" badge pointing to source mode. It can be selected and deleted as a whole, never edited.
 */
export function createVerbatimBlockView({ node }: NodeViewRendererProps): NodeView {
  let source = String(node.attrs['source'] ?? '');
  const dom = document.createElement('div');
  dom.className = 'verbatim-block';
  dom.setAttribute('contenteditable', 'false');
  dom.setAttribute('role', 'group');
  dom.setAttribute('aria-label', i18n.t('editor.verbatim.label'));
  const pre = document.createElement('pre');
  pre.className = 'verbatim-block__source';
  pre.textContent = source;
  const badge = document.createElement('span');
  badge.className = 'verbatim-block__badge';
  badge.textContent = i18n.t('editor.verbatim.badge');
  badge.title = i18n.t('editor.verbatim.tooltip');
  dom.append(pre, badge);

  return {
    dom,
    update: (updated) => {
      if (updated.type !== node.type) return false;
      const next = String(updated.attrs['source'] ?? '');
      if (next !== source) {
        source = next;
        pre.textContent = source;
      }
      return true;
    },
    selectNode: () => dom.classList.add('is-selected'),
    deselectNode: () => dom.classList.remove('is-selected'),
    ignoreMutation: () => true,
  };
}
