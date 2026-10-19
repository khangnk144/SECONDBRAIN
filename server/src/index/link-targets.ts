/**
 * Link resolution inside the index. Resolution itself is the Markdown layer's `resolveLink`
 * (SPEC §4.4); this module keeps the catalog of every indexed path current and decides which
 * stored links must be resolved again when a path appears or disappears.
 *
 * Every link stores a `target_key` = normalized last segment of its target (`.md` stripped). A
 * file can only change how a link resolves if the link's key equals the file's own key, whatever
 * the link form (title, path, file name, relative Markdown link), so re-resolving the links with
 * the keys of added/removed paths is complete; it may re-check a few extra links, never too few.
 */
import { buildLinkCatalog } from '../markdown/link-catalog.js';
import type { LinkCatalog, LinkResolution, ParsedLink } from '../markdown/markdown-types.js';
import { normalizeForIndex } from '../markdown/normalize-text.js';
import { resolveLink } from '../markdown/resolve-link.js';
import type { VaultPath } from '../vault/vault-types.js';

function stripMd(key: string): string {
  return key.endsWith('.md') ? key.slice(0, -3) : key;
}

/** Last non-empty segment: `../notes/` and `notes` name the same file for the key. */
function lastSegment(value: string): string {
  const parts = value
    .trim()
    .split(/[/\\]/)
    .filter((part) => part !== '' && part !== '.');
  return parts[parts.length - 1] ?? '';
}

export function linkTargetKey(target: string): string {
  return stripMd(normalizeForIndex(lastSegment(target)).trim());
}

/** The key under which links to this path are stored (notes: title; other files: file name). */
export function pathTargetKey(path: VaultPath): string {
  return stripMd(normalizeForIndex(lastSegment(path)));
}

export interface ResolvedTarget {
  toPath: VaultPath | null;
  ambiguous: boolean;
}

export function toResolvedTarget(resolution: LinkResolution): ResolvedTarget {
  if (resolution.status === 'resolved') return { toPath: resolution.path, ambiguous: false };
  return { toPath: null, ambiguous: resolution.status === 'ambiguous' };
}

export type LinkResolver = (
  link: Pick<ParsedLink, 'kind' | 'target'>,
  fromPath: VaultPath,
) => ResolvedTarget;

/** Every indexed path (notes and other files) and the catalog built from it, rebuilt lazily. */
export class PathCatalog {
  private readonly paths = new Set<VaultPath>();
  private catalog: LinkCatalog | null = null;

  constructor(initial: Iterable<VaultPath> = []) {
    for (const p of initial) this.paths.add(p);
  }

  has(path: VaultPath): boolean {
    return this.paths.has(path);
  }

  add(path: VaultPath): void {
    if (this.paths.has(path)) return;
    this.paths.add(path);
    this.catalog = null;
  }

  delete(path: VaultPath): void {
    if (this.paths.delete(path)) this.catalog = null;
  }

  reset(paths: Iterable<VaultPath>): void {
    this.paths.clear();
    for (const p of paths) this.paths.add(p);
    this.catalog = null;
  }

  get(): LinkCatalog {
    this.catalog ??= buildLinkCatalog(this.paths);
    return this.catalog;
  }

  resolver(): LinkResolver {
    const catalog = this.get();
    return (link, fromPath) => toResolvedTarget(resolveLink(catalog, link, fromPath));
  }
}
