import type { Editor, NodeViewRendererProps } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import type { NodeView } from '@tiptap/pm/view';
import { i18n } from '../../i18n';
import { useLinkTargetsStore } from '../../lib/link-targets-store';
import { openVaultFile } from '../../lib/open-vault-file';
import { wikilinkDisplay, type EmbedDisplay } from '../attachments/embed-display';
import { renderFileCard } from '../attachments/file-card-view';
import { createVaultImageView, type VaultImageView } from '../attachments/vault-image-view';
import type { EditorContext } from '../editor-context';
import { createInlineIcon } from '../inline-icons';
import { isFileTarget, resolveWikilink, wikilinkLabel } from '../link-actions';
import type { WikilinkAttributes } from '../schema/wikilink-node';
import { followLinkNode } from './wikilink-follow';

/**
 * A wikilink as an accent-coloured link: dashed when it points nowhere (ghost), with a warning
 * badge when several notes share its title. Click opens, Ctrl/⌘+click or middle click opens in a
 * new tab; the badge (or a click on an ambiguous link) offers "Chọn đích…". Embedded files are
 * shown instead of linked: images inline, other files as a card (F15.2); a click selects them,
 * Enter or a double click opens them. Rendering never changes the document.
 */
export function createWikilinkView(context: EditorContext) {
  return ({ node, getPos, editor }: NodeViewRendererProps): NodeView => {
    let current = node;
    let signature = '';
    let display: EmbedDisplay = { mode: 'link' };
    let imageView: VaultImageView | null = null;
    const dom = document.createElement('span');
    dom.className = 'wikilink';
    dom.setAttribute('contenteditable', 'false');
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
    const select = () => {
      const pos = position();
      if (typeof pos !== 'number' || editor.isDestroyed) return;
      const { view } = editor;
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
      view.focus();
    };
    const openFile = (newTab: boolean) => {
      if (display.mode !== 'link' && display.path) openVaultFile(display.path, { newTab });
      else follow(newTab);
    };

    const render = () => {
      const attrs = current.attrs as WikilinkAttributes;
      const resolution = resolveWikilink(attrs, context.getNotePath());
      display = wikilinkDisplay(attrs, resolution);
      const path = display.mode === 'link' ? '' : (display.path ?? '');
      const next = [resolution.status, display.mode, path, ...Object.values(attrs)].join('\u0000');
      if (next === signature) return;
      signature = next;
      dom.dataset['status'] = resolution.status;
      dom.dataset['display'] = display.mode;
      dom.toggleAttribute('data-embed', attrs.embed);
      dom.title = titleFor(attrs, resolution.status, display);
      if (display.mode !== 'image') {
        imageView?.destroy();
        imageView = null;
      }
      if (display.mode === 'image') {
        dom.removeAttribute('role');
        imageView ??= createVaultImageView();
        imageView.show(display.image);
        if (dom.firstChild !== imageView.dom) dom.replaceChildren(imageView.dom);
        return;
      }
      if (display.mode === 'card') {
        dom.removeAttribute('role');
        renderFileCard(dom, {
          name: display.name,
          found: display.path !== null,
          onOpen: ({ newTab }) => openFile(newTab),
        });
        return;
      }
      dom.setAttribute('role', 'link');
      label.textContent = wikilinkLabel(attrs);
      dom.replaceChildren();
      if (attrs.embed) dom.append(createInlineIcon('paperclip', 'wikilink__embed-icon'));
      dom.append(label);
      if (resolution.status === 'ambiguous') {
        badge.setAttribute('aria-label', i18n.t('editor.wikilink.chooseTarget'));
        badge.title = i18n.t('editor.wikilink.chooseTarget');
        dom.append(badge);
      }
    };
    render();

    dom.addEventListener('click', (event) => {
      event.preventDefault();
      if (display.mode === 'link') follow(event.ctrlKey || event.metaKey);
      else select();
    });
    dom.addEventListener('dblclick', (event) => {
      if (display.mode === 'link') return;
      event.preventDefault();
      openFile(event.ctrlKey || event.metaKey);
    });
    dom.addEventListener('auxclick', (event) => {
      if (event.button !== 1) return;
      event.preventDefault();
      if (display.mode === 'link') follow(true);
      else openFile(true);
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
      stopEvent: (event) => /^(mouse|click|dblclick|auxclick|pointer)/.test(event.type),
      ignoreMutation: () => true,
      destroy: () => {
        unsubscribeTargets();
        unsubscribePath();
        imageView?.destroy();
      },
    };
  };
}

function titleFor(attrs: WikilinkAttributes, status: string, display: EmbedDisplay): string {
  const target = attrs.target || attrs.heading || '';
  if (status === 'ghost') {
    if (display.mode !== 'link') return '';
    return isFileTarget(attrs.target)
      ? i18n.t('editor.wikilink.fileMissing', { name: target })
      : i18n.t('editor.wikilink.ghostTitle', { target });
  }
  if (status === 'ambiguous') return i18n.t('editor.wikilink.ambiguousTitle', { target });
  if (display.mode === 'image') return i18n.t('attachments.image.title', { name: target });
  if (attrs.embed) return i18n.t('editor.wikilink.embedTitle', { target });
  return i18n.t('editor.wikilink.openTitle', { target });
}
