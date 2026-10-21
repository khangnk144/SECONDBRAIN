/**
 * Where an answer's `[[…]]` link goes. The server keeps only links into the answer's own set
 * (retrieved sources, cited notes, listed deadline items), so a link is resolved against that set
 * first, with the same rules as the editor (SPEC §4.4), then against the whole vault.
 */
import type { MouseEvent, KeyboardEvent } from 'react';
import type { VaultPath } from '../../lib/api/vault-types';
import { fileRoute, noteRoute } from '../../lib/app-navigation';
import { resolveLinkTarget, type LinkCatalog } from '../../lib/link-resolution';
import { useLinkTargetsStore } from '../../lib/link-targets-store';
import { openVaultFile, vaultFileKind, type OpenVaultFileOptions } from '../../lib/open-vault-file';
import { useTabsStore } from '../../lib/tabs-store';
import { wantsNewTab } from '../backlinks/open-note-at-line';

export function resolveAnswerLink(
  target: string,
  known: LinkCatalog,
  fromPath: VaultPath,
): VaultPath | null {
  // `[[Note#Heading]]` and `[[Note^block]]` open the note itself.
  const clean = target.split(/[#^]/)[0]?.trim() ?? '';
  if (clean === '') return null;
  const own = resolveLinkTarget(known, clean, fromPath);
  if (own.status === 'resolved') return own.path;
  const anywhere = useLinkTargetsStore.getState().resolve(clean, fromPath);
  return anywhere.status === 'resolved' ? anywhere.path : null;
}

/** The app route a link stands for (its `href`; clicks are handled in the app). */
export function answerLinkHref(path: VaultPath): string {
  return `#${vaultFileKind(path) === 'note' ? noteRoute(path) : fileRoute(path)}`;
}

/** Notes open as note tabs; a PDF opens in the viewer (at its page when the answer names one). */
export function openAnswerTarget(path: VaultPath, page: number | null, newTab: boolean): void {
  if (vaultFileKind(path) === 'note') {
    useTabsStore.getState().openNote(path, { newTab });
    return;
  }
  // `page` is read by the viewer once it supports it (the option is ignored before that).
  const options: OpenVaultFileOptions & { page?: number } = { newTab };
  if (page !== null) options.page = page;
  openVaultFile(path, options);
}

/** Click, Ctrl/⌘+click or middle click, and Ctrl+Enter (new tab) on a link. */
export function answerLinkHandlers(open: (newTab: boolean) => void) {
  return {
    onClick: (event: MouseEvent) => {
      event.preventDefault();
      open(wantsNewTab(event));
    },
    onAuxClick: (event: MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      open(true);
    },
    // A middle press would otherwise start the browser's autoscroll.
    onMouseDown: (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      open(true);
    },
  };
}
