import type { NodeViewRendererProps } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { NodeView } from '@tiptap/pm/view';
import { useLinkTargetsStore } from '../../lib/link-targets-store';
import { openVaultFile } from '../../lib/open-vault-file';
import { markdownImageDisplay, type EmbedDisplay } from '../attachments/embed-display';
import { renderFileCard } from '../attachments/file-card-view';
import { createVaultImageView } from '../attachments/vault-image-view';
import type { EditorContext } from '../editor-context';

/**
 * A Markdown image `![alt](src "title")`: a vault image is fetched with the token and shown inline
 * (the raw `src` never reaches an `<img>`, so nothing is requested from the app origin or the
 * web); a web image is a placeholder with its address; another vault file is a card. A double
 * click opens the file. Rendering never changes the document.
 */
export function createImageView(context: EditorContext) {
  return ({ node }: NodeViewRendererProps): NodeView => {
    let current = node;
    let signature = '';
    let display: EmbedDisplay = { mode: 'link' };
    const dom = document.createElement('span');
    dom.className = 'markdown-image';
    dom.setAttribute('contenteditable', 'false');
    const imageView = createVaultImageView();

    const render = () => {
      const src = String(current.attrs['src'] ?? '');
      const alt = String(current.attrs['alt'] ?? '');
      const title = current.attrs['title'] as string | null;
      display = markdownImageDisplay(src, alt, context.getNotePath());
      const next = JSON.stringify([display, title]);
      if (next === signature) return;
      signature = next;
      dom.title = title ?? '';
      dom.dataset['display'] = display.mode;
      if (display.mode === 'card') {
        const path = display.path;
        renderFileCard(dom, {
          name: display.name,
          found: path !== null,
          onOpen: ({ newTab }) => {
            if (path) openVaultFile(path, { newTab });
          },
        });
        return;
      }
      if (display.mode === 'image') imageView.show(display.image);
      if (dom.firstChild !== imageView.dom) dom.replaceChildren(imageView.dom);
    };
    render();

    dom.addEventListener('dblclick', (event) => {
      if (display.mode === 'link' || !display.path) return;
      event.preventDefault();
      openVaultFile(display.path, { newTab: event.ctrlKey || event.metaKey });
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
      ignoreMutation: () => true,
      destroy: () => {
        unsubscribeTargets();
        unsubscribePath();
        imageView.destroy();
      },
    };
  };
}
