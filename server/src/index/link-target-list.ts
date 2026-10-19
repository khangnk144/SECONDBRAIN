/**
 * Everything a wikilink can point to (F4 autocomplete, ghost and ambiguous rendering): every note
 * (templates included, with class `template`: they are reached by path only) and every other file
 * (for `![[…]]` embeds and attachments).
 */
import { catalogIndex } from '../markdown/link-catalog.js';
import { isNotePath } from '../markdown/content-classes.js';
import type { ContentClass, LinkCatalog } from '../markdown/markdown-types.js';
import { linkIdentityKey } from '../markdown/normalize-text.js';
import type { VaultPath } from '../vault/vault-types.js';

export interface LinkTargetNote {
  path: VaultPath;
  title: string;
  /** Parent folder path ('' at the vault root), shown next to the title to tell notes apart. */
  folder: string;
  class: ContentClass;
  /**
   * The title resolves to exactly this one note vault-wide (else links use the path form). Always
   * false for templates: title lookup leaves them out, as the server's resolver does.
   */
  unique: boolean;
}

export interface LinkTargetFile {
  path: VaultPath;
  /** File name with extension. */
  name: string;
}

export interface LinkTargets {
  notes: LinkTargetNote[];
  files: LinkTargetFile[];
}

const parentOf = (path: VaultPath) => path.slice(0, Math.max(path.lastIndexOf('/'), 0));
const nameOf = (path: VaultPath) => path.slice(path.lastIndexOf('/') + 1);

export function buildLinkTargets(
  rows: readonly { path: VaultPath; title: string; class: ContentClass }[],
  catalog: LinkCatalog,
): LinkTargets {
  const { byTitle } = catalogIndex(catalog);
  const notes = rows
    .filter((row) => isNotePath(row.path))
    .map((row) => {
      const sameTitle = byTitle.get(linkIdentityKey(row.title));
      return {
        path: row.path,
        title: row.title,
        folder: parentOf(row.path),
        class: row.class,
        unique: sameTitle?.length === 1 && sameTitle[0] === row.path,
      };
    });
  const files = [...catalog.filePaths]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((path) => ({ path, name: nameOf(path) }));
  return { notes, files };
}
