/**
 * One entry point for "open this vault file" (a click on `[[x.pdf]]`, an embed card, a source
 * node in the brain map, a row in the documents view). Notes open as note tabs; PDFs open in the
 * in-app viewer tab; images and every other file are offered as a download (SPEC §4.8: HTML and
 * other files are never rendered in the app origin).
 *
 * Callers only rely on the signature below. The app installs the real behaviour at start
 * (`features/viewer/open-vault-file-in-app.ts`, via `startTabsSync`); until then, and in tests that
 * install nothing, a call does nothing.
 */
import type { VaultPath } from './api/vault-types';

export interface OpenVaultFileOptions {
  /** Ctrl+click, middle-click, Ctrl+Enter: open beside the current tab. */
  newTab?: boolean;
  /** PDFs: the viewer opens at this page (1-based; an invalid page opens page 1). */
  page?: number;
}

export type VaultFileKind = 'note' | 'image' | 'pdf' | 'other';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

export function vaultFileKind(path: VaultPath): VaultFileKind {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  const extension = dot > slash + 1 ? path.slice(dot + 1).toLowerCase() : '';
  if (extension === 'md') return 'note';
  if (extension === 'pdf') return 'pdf';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  return 'other';
}

let implementation: ((path: VaultPath, options: OpenVaultFileOptions) => void) | null = null;

/** The viewer track registers the real behaviour at app start (tests may register a fake). */
export function setOpenVaultFileImplementation(
  next: ((path: VaultPath, options: OpenVaultFileOptions) => void) | null,
): void {
  implementation = next;
}

export function openVaultFile(path: VaultPath, options: OpenVaultFileOptions = {}): void {
  implementation?.(path, options);
}
