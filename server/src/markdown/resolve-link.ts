/**
 * Link resolution (SPEC §4.4, §4.8): one function used by navigation, backlinks, graph and
 * rename-relink, so every view agrees on where a link points.
 */
import type { VaultPath } from '../vault/vault-types.js';
import { catalogIndex } from './link-catalog.js';
import type { LinkCatalog, LinkResolution, ParsedLink } from './markdown-types.js';
import { linkIdentityKey } from './normalize-text.js';

const GHOST: LinkResolution = Object.freeze({ status: 'ghost' });

export function resolveLink(
  catalog: LinkCatalog,
  link: Pick<ParsedLink, 'kind' | 'target'>,
  fromPath: VaultPath,
): LinkResolution {
  if (link.kind === 'markdown') return resolveRelativePath(catalog, link.target, fromPath);
  const target = link.target;
  // `[[#Heading]]` points into the linking note itself.
  if (target === '') return { status: 'resolved', path: fromPath };
  if (target.includes('/')) return resolveVaultPath(catalog, target.replace(/^\/+/, ''));
  return resolveTitle(catalog, target, fromPath);
}

/** Path form: vault-relative, `.md` optional for notes, exact path for other files. */
function resolveVaultPath(catalog: LinkCatalog, target: string): LinkResolution {
  const index = catalogIndex(catalog);
  const key = linkIdentityKey(target);
  const candidates = /\.md$/i.test(target)
    ? index.byFilePath.get(key)
    : (index.byNotePath.get(key) ?? index.byFilePath.get(key));
  return pickExact(candidates, target);
}

/** Title form: notes (not templates) by title, then non-note files by file name. */
function resolveTitle(catalog: LinkCatalog, target: string, fromPath: VaultPath): LinkResolution {
  const index = catalogIndex(catalog);
  const title = target.replace(/\.md$/i, '');
  const notes = index.byTitle.get(linkIdentityKey(title));
  if (notes) return pickPreferred(notes, fromPath);
  const files = index.byFileName.get(linkIdentityKey(target));
  if (files) return pickPreferred(files, fromPath);
  return GHOST;
}

/**
 * Markdown links resolve relative to the linking note's folder (a leading `/` means the vault
 * root); `..` may climb but never above the vault root; `.md` is optional.
 */
function resolveRelativePath(
  catalog: LinkCatalog,
  target: string,
  fromPath: VaultPath,
): LinkResolution {
  const segments = target.startsWith('/') ? [] : parentSegments(fromPath);
  for (const part of target.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (segments.length === 0) return GHOST;
      segments.pop();
    } else segments.push(part);
  }
  if (segments.length === 0) return GHOST;
  const joined = segments.join('/');
  const index = catalogIndex(catalog);
  const exact = index.byFilePath.get(linkIdentityKey(joined));
  if (exact) return pickExact(exact, joined);
  if (/\.md$/i.test(joined)) return GHOST;
  return pickExact(index.byNotePath.get(linkIdentityKey(joined)), joined);
}

/**
 * Several paths can share a case-insensitive key only on case-sensitive file systems; an exact
 * spelling wins, anything else is ambiguous rather than a guess.
 */
function pickExact(candidates: readonly VaultPath[] | undefined, target: string): LinkResolution {
  if (!candidates || candidates.length === 0) return GHOST;
  if (candidates.length === 1) return { status: 'resolved', path: candidates[0] as VaultPath };
  const nfc = target.normalize('NFC');
  const exact = candidates.filter((p) => p === nfc || p === `${nfc}.md`);
  if (exact.length === 1) return { status: 'resolved', path: exact[0] as VaultPath };
  return { status: 'ambiguous', candidates: [...candidates] };
}

/** Same folder as the linking note first, then fewest path segments; a tie is ambiguous. */
function pickPreferred(candidates: readonly VaultPath[], fromPath: VaultPath): LinkResolution {
  if (candidates.length === 1) return { status: 'resolved', path: candidates[0] as VaultPath };
  const fromFolder = linkIdentityKey(parentSegments(fromPath).join('/'));
  const sameFolder = candidates.filter(
    (p) => linkIdentityKey(parentSegments(p).join('/')) === fromFolder,
  );
  const pool = sameFolder.length > 0 ? sameFolder : candidates;
  const fewest = Math.min(...pool.map(segmentCount));
  const best = pool.filter((p) => segmentCount(p) === fewest);
  if (best.length === 1) return { status: 'resolved', path: best[0] as VaultPath };
  return { status: 'ambiguous', candidates: [...candidates] };
}

function parentSegments(path: VaultPath): string[] {
  const parts = path.split('/');
  parts.pop();
  return parts;
}

function segmentCount(path: VaultPath): number {
  return path.split('/').length;
}
