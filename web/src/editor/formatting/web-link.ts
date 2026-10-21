/**
 * "Liên kết web": asks for an address and links the selection to it. Inside a link it shows the
 * current address; saving it changes the whole link, saving an empty field removes the link.
 * A caret outside any link inserts the address itself as linked text.
 */
import type { Editor } from '@tiptap/core';
import { i18n } from '../../i18n';
import { promptDialog } from '../../lib/dialogs/dialog-requests';

/** The address as it will be stored, `''` to remove the link, or null when it is not usable. */
export function normalizeWebAddress(value: string): string | null {
  const address = value.trim();
  if (/\s/.test(address)) return null;
  // `www.example.com` means the web, not a file named like that next to the note.
  return /^www\./i.test(address) ? `https://${address}` : address;
}

export function currentLinkHref(editor: Editor): string | null {
  if (!editor.isActive('link')) return null;
  const href = editor.getAttributes('link')['href'];
  return typeof href === 'string' ? href : null;
}

/** Applies a normalized address (see `normalizeWebAddress`); returns whether the text changed. */
export function applyWebLink(editor: Editor, href: string): boolean {
  const inLink = editor.isActive('link');
  const chain = editor.chain().focus();
  if (href === '') return inLink ? chain.extendMarkRange('link').unsetLink().run() : false;
  if (inLink) return chain.extendMarkRange('link').setLink({ href }).run();
  if (editor.state.selection.empty) {
    return chain
      .insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
      .run();
  }
  return chain.setLink({ href }).run();
}

/** The dialog, then the edit; focus goes back to the editor either way. */
export async function editWebLinkWithDialog(editor: Editor): Promise<void> {
  const current = currentLinkHref(editor);
  const value = await promptDialog({
    title: i18n.t('editor.toolbar.linkDialog.title'),
    label: i18n.t(
      current === null ? 'editor.toolbar.linkDialog.label' : 'editor.toolbar.linkDialog.editLabel',
    ),
    initialValue: current ?? '',
    confirmLabel: i18n.t(
      current === null ? 'editor.toolbar.linkDialog.add' : 'editor.toolbar.linkDialog.save',
    ),
    validate: (input) => {
      const address = normalizeWebAddress(input);
      if (address === null) return i18n.t('editor.toolbar.linkDialog.spaces');
      if (address === '' && current === null) return i18n.t('editor.toolbar.linkDialog.empty');
      return null;
    },
  });
  if (editor.isDestroyed) return;
  const address = value === null ? null : normalizeWebAddress(value);
  if (address === null || !applyWebLink(editor, address)) editor.commands.focus();
}
