import type { Editor, NodeViewRendererProps } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { NodeView } from '@tiptap/pm/view';
import { i18n } from '../../i18n';
import { useLinkTargetsStore } from '../../lib/link-targets-store';
import type { EditorContext } from '../editor-context';
import { createInlineIcon } from '../inline-icons';
import { isImageTarget, resolveWikilink, wikilinkLabel } from '../link-actions';
import type { WikilinkAttributes } from '../schema/wikilink-node';
import { followLinkNode } from './wikilink-follow';

/**
 * A wikilink as an accent-coloured link: dashed when it points nowhere (ghost), with a warning
 * badge when several notes share its title. Click opens, Ctrl/⌘+click or middle click opens in a
 * new tab; the badge (or a click on an ambiguous link) offers "Chọn đích…".
 */
export function createWikilinkView(context: EditorContext) {
  return ({ node, getPos, editor }: NodeViewRendererProps): NodeView => {
    let current = node;
    let signature = '';
    const dom = document.createElement('span');
    dom.className = 'wikilink';
    dom.setAttribute('contenteditable', 'false');
    dom.setAttribute('role', 'link');
    const label = document.createElement('span');
    label.className = 'wikilink__label';
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'wikilink__badge';
    badge.tabIndex = -1;
    badge.append(createInlineIcon('warning', 'wikilink__badge-icon'));

    const position = () => (typeof getPos === 'function' ? getPos() : undefined);
    const follow = (newTab: boolean) => {
      const pos = position();
      if (typeof pos === 'number') followLinkNode(editor as Editor, context, pos, { newTab });
    };

    const render = () => {
      const attrs = current.attrs as WikilinkAttributes;
      const status = resolveWikilink(attrs, context.getNotePath()).status;
      const next = [status, attrs.target, attrs.heading, attrs.alias, attrs.embed].join('\u0000');
      if (next === signature) return;
      signature = next;
      dom.dataset['status'] = status;
      dom.toggleAttribute('data-embed', attrs.embed);
      label.textContent = wikilinkLabel(attrs);
      dom.title = titleFor(attrs, status);
      dom.replaceChildren();
      if (attrs.embed) {
        const icon = isImageTarget(attrs.target) ? 'image' : 'paperclip';
        dom.append(createInlineIcon(icon, 'wikilink__embed-icon'));
      }
      dom.append(label);
      if (status === 'ambiguous') {
        badge.setAttribute('aria-label', i18n.t('editor.wikilink.chooseTarget'));
        badge.title = i18n.t('editor.wikilink.chooseTarget');
        dom.append(badge);
      }
    };
    render();

    dom.addEventListener('click', (event) => {
      event.preventDefault();
      follow(event.ctrlKey || event.metaKey);
    });
    dom.addEventListener('auxclick', (event) => {
      if (event.button !== 1) return;
      event.preventDefault();
      follow(true);
    });
    const unsubscribeTargets = useLinkTargetsStore.subscribe(render);
    const unsubscribePath = context.subscribe(render);

    return {
      dom,
      update: (updated: ProseMirrorNode) => {
        if (updated.type !== current.type) return false;
        current = updated;
        render();
        return true;
      },
      selectNode: () => dom.classList.add('is-selected'),
      deselectNode: () => dom.classList.remove('is-selected'),
      // Pointer events open the link instead of moving the caret; keys stay with the editor.
      stopEvent: (event) => /^(mouse|click|auxclick|pointer)/.test(event.type),
      ignoreMutation: () => true,
      destroy: () => {
        unsubscribeTargets();
        unsubscribePath();
      },
    };
  };
}

function titleFor(attrs: WikilinkAttributes, status: string): string {
  const target = attrs.target || attrs.heading || '';
  if (status === 'ghost') return i18n.t('editor.wikilink.ghostTitle', { target });
  if (status === 'ambiguous') return i18n.t('editor.wikilink.ambiguousTitle', { target });
  if (attrs.embed) return i18n.t('editor.wikilink.embedTitle', { target });
  return i18n.t('editor.wikilink.openTitle', { target });
}
