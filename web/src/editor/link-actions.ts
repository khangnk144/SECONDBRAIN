import { i18n } from '../i18n';
import type { VaultPath } from '../lib/api/vault-types';
import type { LinkResolution } from '../lib/link-resolution';
import { useLinkTargetsStore } from '../lib/link-targets-store';
import { createNote } from '../lib/note-operations';
import { openVaultFile } from '../lib/open-vault-file';
import { useTabsStore } from '../lib/tabs-store';
import { showToast } from '../lib/toast-store';
import { isNotePath } from '../lib/vault-paths';
import type { WikilinkAttributes } from './schema/wikilink-node';

/** Where a wikilink written in `notePath` points (same answer as the server). */
export function resolveWikilink(attrs: WikilinkAttributes, notePath: VaultPath): LinkResolution {
  return useLinkTargetsStore
    .getState()
    .resolve(attrs.target, notePath, attrs.embed ? 'embed' : 'wikilink');
}

const FILE_EXTENSIONS =
  /\.(png|jpe?g|gif|webp|svg|bmp|avif|pdf|pptx?|docx?|xlsx?|csv|txt|html?|zip|mp3|mp4|mov|wav)$/i;

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

export function isImageTarget(target: string): boolean {
  return IMAGE_EXTENSIONS.test(target);
}

/** A target naming a file that is not a note (`sơ đồ.png`); such ghosts are never created. */
export function isFileTarget(target: string): boolean {
  return FILE_EXTENSIONS.test(target);
}

/**
 * Follows a wikilink: a resolved link opens its note (Ctrl+click: new tab) or, for any other file
 * (`[[bài giảng 3.pdf]]`, an `.html` page), hands it to `openVaultFile` (the viewer decides how;
 * nothing is rendered here); an ambiguous one asks which note is meant, a ghost creates
 * `0 Inbox/<Target>.md` and opens it (F4.5).
 */
export async function followWikilink(
  attrs: WikilinkAttributes,
  notePath: VaultPath,
  options: { newTab: boolean; onAmbiguous: (candidates: VaultPath[]) => void },
): Promise<void> {
  const resolution = resolveWikilink(attrs, notePath);
  if (resolution.status === 'resolved') {
    if (isNotePath(resolution.path)) {
      useTabsStore.getState().openNote(resolution.path, { newTab: options.newTab });
    } else {
      openVaultFile(resolution.path, { newTab: options.newTab });
    }
    return;
  }
  if (resolution.status === 'ambiguous') {
    options.onAmbiguous(resolution.candidates);
    return;
  }
  if (isFileTarget(attrs.target)) {
    showToast({ message: i18n.t('editor.wikilink.fileMissing', { name: attrs.target }) });
    return;
  }
  // Invalid file names (e.g. a path form with "/") get a friendly toast from createNote.
  await createNote({ title: attrs.target, newTab: options.newTab });
}

/** The text a wikilink node shows: its alias, else its target (with the heading). */
export function wikilinkLabel(attrs: WikilinkAttributes): string {
  if (attrs.alias) return attrs.alias;
  if (attrs.target && attrs.heading) return `${attrs.target} › ${attrs.heading}`;
  return attrs.target || attrs.heading || '';
}

/** The target text that names `path` unambiguously: the vault path, without `.md` for notes. */
export function pathFormTarget(path: VaultPath): string {
  return path.replace(/\.md$/i, '');
}
