/** `GET /api/tree` and `GET /api/templates`, mirrored from `server/src/api/build-vault-tree.ts`. */
import type { ContentClass, VaultPath } from './vault-types';

export interface TreeFile {
  path: VaultPath;
  /** File name with extension. */
  name: string;
  /** Note title (name without `.md`) for notes, the file name otherwise. */
  title: string;
  class: ContentClass;
  isNote: boolean;
  size: number;
  mtime: number;
}

export interface TreeFolder {
  /** '' for the vault root. */
  path: VaultPath;
  name: string;
  /** Notes in this folder and all folders below it. */
  noteCount: number;
  /** Some note in this subtree has an open `urgent` deadline item (sidebar accent dot). */
  urgent: boolean;
  /** Vault order (numeric prefixes sort naturally). */
  folders: TreeFolder[];
  /** Notes by title; Daily newest first. */
  files: TreeFile[];
}

export interface VaultTree {
  root: TreeFolder;
  /** `.md` files directly in `0 Inbox`. */
  inboxCount: number;
}

export interface TemplateInfo {
  path: VaultPath;
  title: string;
  bundled: boolean;
}

export interface TemplatesResponse {
  templates: TemplateInfo[];
  missingBundled: VaultPath[];
}
