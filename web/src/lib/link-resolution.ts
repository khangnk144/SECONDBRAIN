/**
 * Client-side link resolution for rendering (SPEC §4.4), a mirror of
 * `server/src/markdown/resolve-link.ts` + `link-catalog.ts`: unique title, same-folder preference,
 * fewest path segments, tie → ambiguous, path form with no title fallback, NFC + lowercase identity
 * (`đ` stays distinct from `d`). Keep both in step; the tests share the same matrix.
 */
import type { VaultPath } from './api/vault-types';
import { isNotePath, noteTitleFromPath } from './vault-paths';

export type LinkKind = 'wikilink' | 'embed' | 'markdown';

export type LinkResolution =
  | { status: 'resolved'; path: VaultPath }
  | { status: 'ambiguous'; candidates: VaultPath[] }
  | { status: 'ghost' };

export interface LinkCatalog {
  /** Note titles, excluding templates (the path form still reaches them). */
  byTitle: ReadonlyMap<string, readonly VaultPath[]>;
  /** Note paths without `.md`. */
  byNotePath: ReadonlyMap<string, readonly VaultPath[]>;
  /** Full paths of every file. */
  byFilePath: ReadonlyMap<string, readonly VaultPath[]>;
  /** File names (with extension) of non-note files. */
  byFileName: ReadonlyMap<string, readonly VaultPath[]>;
}

const GHOST: LinkResolution = Object.freeze({ status: 'ghost' });

export function linkIdentityKey(value: string): string {
  return value.normalize('NFC').toLowerCase();
}

function isTemplatePath(path: VaultPath): boolean {
  const segments = path.split('/');
  return segments.length > 1 && linkIdentityKey(segments[0] ?? '') === 'templates';
}

export function buildLinkCatalog(paths: Iterable<VaultPath>): LinkCatalog {
  const byTitle = new Map<string, VaultPath[]>();
  const byNotePath = new Map<string, VaultPath[]>();
  const byFilePath = new Map<string, VaultPath[]>();
  const byFileName = new Map<string, VaultPath[]>();
  const add = (map: Map<string, VaultPath[]>, key: string, path: VaultPath) => {
    const norm = linkIdentityKey(key);
    const list = map.get(norm);
    if (list) list.push(path);
    else map.set(norm, [path]);
  };
  for (const path of new Set(paths)) {
    add(byFilePath, path, path);
    if (isNotePath(path)) {
      if (!isTemplatePath(path)) add(byTitle, noteTitleFromPath(path), path);
      add(byNotePath, path.slice(0, -3), path);
    } else {
      add(byFileName, path.slice(path.lastIndexOf('/') + 1), path);
    }
  }
  for (const map of [byTitle, byNotePath, byFilePath, byFileName]) {
    for (const list of map.values()) list.sort();
  }
  return { byTitle, byNotePath, byFilePath, byFileName };
}

/** Where a link written in the note at `fromPath` points. */
export function resolveLinkTarget(
  catalog: LinkCatalog,
  target: string,
  fromPath: VaultPath,
  kind: LinkKind = 'wikilink',
): LinkResolution {
  if (kind === 'markdown') return resolveRelativePath(catalog, target, fromPath);
  // `[[#Heading]]` points into the linking note itself.
  if (target === '') return { status: 'resolved', path: fromPath };
  if (target.includes('/')) return resolveVaultPath(catalog, target.replace(/^\/+/, ''));
  const title = target.replace(/\.md$/i, '');
  const notes = catalog.byTitle.get(linkIdentityKey(title));
  if (notes) return pickPreferred(notes, fromPath);
  const files = catalog.byFileName.get(linkIdentityKey(target));
  return files ? pickPreferred(files, fromPath) : GHOST;
}

function resolveVaultPath(catalog: LinkCatalog, target: string): LinkResolution {
  const key = linkIdentityKey(target);
  const candidates = /\.md$/i.test(target)
    ? catalog.byFilePath.get(key)
    : (catalog.byNotePath.get(key) ?? catalog.byFilePath.get(key));
  return pickExact(candidates, target);
}

/** Relative to the linking note's folder (`/` = vault root); `..` never climbs above the root. */
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
  const exact = catalog.byFilePath.get(linkIdentityKey(joined));
  if (exact) return pickExact(exact, joined);
  if (/\.md$/i.test(joined)) return GHOST;
  return pickExact(catalog.byNotePath.get(linkIdentityKey(joined)), joined);
}

function pickExact(candidates: readonly VaultPath[] | undefined, target: string): LinkResolution {
  if (!candidates || candidates.length === 0) return GHOST;
  if (candidates.length === 1) return { status: 'resolved', path: candidates[0] as VaultPath };
  const nfc = target.normalize('NFC');
  const exact = candidates.filter((p) => p === nfc || p === `${nfc}.md`);
  if (exact.length === 1) return { status: 'resolved', path: exact[0] as VaultPath };
  return { status: 'ambiguous', candidates: [...candidates] };
}

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
