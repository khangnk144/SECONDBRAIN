/**
 * How an embed or a Markdown image is shown (SPEC F15.2): an image file of the vault inline, any
 * other file as a card, a missing file as a placeholder naming it, a web image as a quiet
 * placeholder (never fetched: CSP and offline). Note embeds stay links.
 */
import type { VaultPath } from '../../lib/api/vault-types';
import type { LinkResolution } from '../../lib/link-resolution';
import { useLinkTargetsStore } from '../../lib/link-targets-store';
import { vaultFileKind } from '../../lib/open-vault-file';
import { baseName, isNotePath } from '../../lib/vault-paths';
import { isFileTarget, isImageTarget } from '../link-actions';
import type { WikilinkAttributes } from '../schema/wikilink-node';
import type { VaultImageSpec } from './vault-image-view';

export type EmbedDisplay =
  | { mode: 'link' }
  | { mode: 'image'; image: VaultImageSpec; path: VaultPath | null }
  | { mode: 'card'; name: string; path: VaultPath | null };

/** Obsidian's `![[x.png|300]]` / `|300x200` sizes an image; any other alias is its alt text. */
const SIZE_ALIAS = /^(\d{1,4})(?:x(\d{1,4}))?$/;

export function wikilinkDisplay(
  attrs: WikilinkAttributes,
  resolution: LinkResolution,
): EmbedDisplay {
  if (!attrs.embed) return { mode: 'link' };
  if (resolution.status === 'resolved') {
    const { path } = resolution;
    if (isNotePath(path)) return { mode: 'link' };
    const name = baseName(path);
    if (vaultFileKind(path) !== 'image') return { mode: 'card', name, path };
    const size = attrs.alias ? SIZE_ALIAS.exec(attrs.alias) : null;
    const image: VaultImageSpec = {
      kind: 'vault',
      path,
      name,
      alt: size ? name : (attrs.alias ?? name),
      ...(size?.[1] ? { width: Number(size[1]) } : {}),
      ...(size?.[2] ? { height: Number(size[2]) } : {}),
    };
    return { mode: 'image', image, path };
  }
  if (resolution.status === 'ambiguous') return { mode: 'link' };
  const name = baseName(attrs.target);
  if (isImageTarget(attrs.target)) {
    return { mode: 'image', image: { kind: 'missing', name }, path: null };
  }
  return isFileTarget(attrs.target) ? { mode: 'card', name, path: null } : { mode: 'link' };
}

/** `![alt](src)`: relative to the note's folder first, then from the vault root. */
export function markdownImageDisplay(src: string, alt: string, notePath: VaultPath): EmbedDisplay {
  if (/^data:image\//i.test(src)) {
    return { mode: 'image', image: { kind: 'inline', src, name: alt, alt }, path: null };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')) {
    return { mode: 'image', image: { kind: 'external', url: src }, path: null };
  }
  const resolution = resolveImageSource(src, notePath);
  if (resolution.status === 'resolved' && !isNotePath(resolution.path)) {
    const { path } = resolution;
    const name = baseName(path);
    if (vaultFileKind(path) !== 'image') return { mode: 'card', name, path };
    return { mode: 'image', image: { kind: 'vault', path, name, alt: alt || name }, path };
  }
  const name = baseName(decodeSource(src)) || src;
  return { mode: 'image', image: { kind: 'missing', name }, path: null };
}

function resolveImageSource(src: string, notePath: VaultPath): LinkResolution {
  const store = useLinkTargetsStore.getState();
  const candidates = [...new Set([decodeSource(src), src])];
  for (const candidate of candidates) {
    const relative = store.resolve(candidate, notePath, 'markdown');
    if (relative.status !== 'ghost') return relative;
    const fromRoot = store.resolve(`/${candidate.replace(/^\/+/, '')}`, notePath, 'markdown');
    if (fromRoot.status !== 'ghost') return fromRoot;
  }
  return { status: 'ghost' };
}

/** Markdown destinations are often percent-encoded (`b%C3%A0i%20gi%E1%BA%A3ng.png`). */
function decodeSource(src: string): string {
  try {
    return decodeURIComponent(src);
  } catch {
    return src;
  }
}
