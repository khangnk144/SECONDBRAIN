/** What kind of file was dropped or pasted, and where a document goes by default (SPEC §4.8). */
import type { DocumentTarget } from '../../lib/api/attachments-types';

/** Images the server keeps in `Attachments/<YYYY-MM>/` and the editor shows inline. */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const SLIDE_EXTENSIONS = new Set(['ppt', 'pptx', 'key', 'odp']);

const EXTENSION_FOR_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function isImageFile(file: File): boolean {
  return IMAGE_EXTENSIONS.has(fileExtension(file.name));
}

/** The folder a document goes to when nobody chose one yet (same rule as the server's `auto`). */
export function guessDocumentTarget(name: string): DocumentTarget {
  const extension = fileExtension(name);
  if (extension === 'pdf') return 'papers';
  return SLIDE_EXTENSIONS.has(extension) ? 'slides' : 'other';
}

/**
 * A clipboard image may come without a usable name (`image` or an empty string); give it one
 * with the extension of its type so the server files it as an image.
 */
export function withUsableName(file: File): File {
  const extension = EXTENSION_FOR_TYPE[file.type];
  if (!extension || fileExtension(file.name) !== '') return file;
  const base = file.name.trim() || 'image';
  return new File([file], `${base}.${extension}`, {
    type: file.type,
    lastModified: file.lastModified,
  });
}

/** Files of a drop or paste, in the order given (strings and other items are left out). */
export function transferFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = Array.from(data.files ?? []);
  if (files.length > 0) return files.map(withUsableName);
  const fromItems: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file' || typeof item.getAsFile !== 'function') continue;
    const file = item.getAsFile();
    if (file) fromItems.push(withUsableName(file));
  }
  return fromItems;
}
