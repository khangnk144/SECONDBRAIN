/**
 * An image from the vault inside a node view (plain DOM): fetched with the token through
 * `vault-file-blob` and shown as an `<img>` with the object URL – SVG included, never as inline
 * SVG markup (SPEC §5). Missing, failing and web images get a quiet placeholder that names them.
 * Showing an image never changes the document (SPEC §4.9 P1).
 */
import { i18n } from '../../i18n';
import type { VaultPath } from '../../lib/api/vault-types';
import { watchVaultFileBlob, type VaultFileBlob } from '../../lib/vault-file-blob';
import { createInlineIcon, type InlineIconName } from '../inline-icons';

export type VaultImageSpec =
  | { kind: 'vault'; path: VaultPath; name: string; alt: string; width?: number; height?: number }
  /** A `data:image/…` source: nothing to fetch. */
  | { kind: 'inline'; src: string; name: string; alt: string }
  | { kind: 'missing'; name: string }
  | { kind: 'external'; url: string };

export interface VaultImageView {
  dom: HTMLElement;
  show(spec: VaultImageSpec): void;
  destroy(): void;
}

export function createVaultImageView(): VaultImageView {
  const dom = document.createElement('span');
  dom.className = 'embed-image';
  let shown = '';
  let spec: VaultImageSpec | null = null;
  let watchedPath: VaultPath | null = null;
  let blob: VaultFileBlob = { status: 'loading' };
  let unwatch: (() => void) | null = null;
  let image: HTMLImageElement | null = null;
  let broken = false;

  const placeholder = (state: string, icon: InlineIconName, text: string) => {
    const box = document.createElement('span');
    box.className = 'embed-placeholder';
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', text);
    const label = document.createElement('span');
    label.className = 'embed-placeholder__text';
    label.textContent = text;
    box.append(createInlineIcon(icon, 'embed-placeholder__icon'), label);
    dom.replaceChildren(box);
    dom.dataset['state'] = state;
    image = null;
  };

  const showImage = (src: string, alt: string, size: { width?: number; height?: number }) => {
    if (!image) {
      image = document.createElement('img');
      image.className = 'embed-image__img';
      image.decoding = 'async';
      image.draggable = false;
      // A file that is not an image after all (or a damaged one) cannot be decoded.
      image.addEventListener('error', () => {
        broken = true;
        paint();
      });
      dom.replaceChildren(image);
    }
    image.alt = alt;
    if (size.width) image.width = size.width;
    else image.removeAttribute('width');
    if (size.height) image.height = size.height;
    else image.removeAttribute('height');
    if (image.getAttribute('src') !== src) image.src = src;
    dom.dataset['state'] = 'ready';
  };

  const paint = () => {
    if (!spec) return;
    if (spec.kind === 'external') {
      placeholder('external', 'globe', i18n.t('attachments.image.external', { url: spec.url }));
      return;
    }
    const { name } = spec;
    if (spec.kind === 'missing') {
      placeholder('missing', 'imageBroken', i18n.t('attachments.image.missing', { name }));
    } else if (broken) {
      placeholder('failed', 'imageBroken', i18n.t('attachments.image.failed', { name }));
    } else if (spec.kind === 'inline') {
      showImage(spec.src, spec.alt, {});
    } else if (blob.status === 'ready') {
      showImage(blob.url, spec.alt, spec);
    } else if (blob.status === 'missing') {
      placeholder('missing', 'imageBroken', i18n.t('attachments.image.missing', { name }));
    } else if (blob.status === 'error') {
      placeholder('failed', 'imageBroken', i18n.t('attachments.image.failed', { name }));
    } else if (!image) {
      placeholder('loading', 'image', i18n.t('attachments.image.loading', { name }));
    }
  };

  const stopWatching = () => {
    unwatch?.();
    unwatch = null;
    watchedPath = null;
  };

  return {
    dom,
    show: (next) => {
      const key = JSON.stringify(next);
      if (key === shown) return;
      shown = key;
      spec = next;
      const path = next.kind === 'vault' ? next.path : null;
      if (path === watchedPath) {
        paint();
        return;
      }
      stopWatching();
      broken = false;
      blob = { status: 'loading' };
      if (path === null) {
        paint();
        return;
      }
      watchedPath = path;
      unwatch = watchVaultFileBlob(path, (state) => {
        blob = state;
        // A new version of the file gets a new chance to decode.
        if (state.status === 'ready') broken = false;
        paint();
      });
    },
    destroy: stopWatching,
  };
}
