/**
 * Vault-wide unique attachment names (SPEC §4.8): `![[name.png]]` and `[[name.pdf]]` resolve by
 * file name across the whole vault, so a new file must not share its name, compared after NFC
 * and case-insensitively, with any file in the vault – nor with a note title, because a title
 * match wins over a file name in link resolution (`[[báo cáo.pdf]]` would open `báo cáo.pdf.md`).
 */
import { catalogIndex } from '../markdown/link-catalog.js';
import { isNotePath, noteTitleFromPath } from '../markdown/content-classes.js';
import type { LinkCatalog } from '../markdown/markdown-types.js';
import { linkIdentityKey } from '../markdown/normalize-text.js';
import { withNameSuffix } from '../vault/vault-write-ops.js';
import type { VaultPath } from '../vault/vault-types.js';

const MAX_SUFFIX = 9999;

const nameOf = (path: VaultPath) => path.slice(path.lastIndexOf('/') + 1);

/** Identity keys a new name must avoid: every file name, and every note title. */
export function takenNameKeys(catalog: LinkCatalog): Set<string> {
  const taken = new Set<string>();
  for (const path of catalog.notePaths) {
    taken.add(linkIdentityKey(nameOf(path)));
    taken.add(linkIdentityKey(noteTitleFromPath(path)));
  }
  for (const path of catalog.filePaths) taken.add(linkIdentityKey(nameOf(path)));
  return taken;
}

export function isNameTaken(taken: ReadonlySet<string>, name: string): boolean {
  if (taken.has(linkIdentityKey(name))) return true;
  return isNotePath(name) && taken.has(linkIdentityKey(noteTitleFromPath(name)));
}

/** `image.png`, `image 2.png`, `image 3.png`, … */
export function* nameCandidates(name: string): Generator<string> {
  yield name;
  for (let n = 2; n <= MAX_SUFFIX; n += 1) yield withNameSuffix(name, ` ${n}`);
}

/**
 * True when the title form `[[name]]` resolves to `path` from any note: no note has that title
 * and no other file has that name. Otherwise the link must use the path form.
 */
export function nameLinksUniquely(catalog: LinkCatalog, path: VaultPath): boolean {
  const index = catalogIndex(catalog);
  const name = nameOf(path);
  if (isNotePath(path)) {
    const notes = index.byTitle.get(linkIdentityKey(noteTitleFromPath(path)));
    return notes?.length === 1 && notes[0] === path;
  }
  if (index.byTitle.has(linkIdentityKey(name))) return false;
  const files = index.byFileName.get(linkIdentityKey(name));
  return files?.length === 1 && files[0] === path;
}
