/**
 * What kind of file a vault file is, judged by its extension, and where a dropped file is saved
 * (SPEC §4.8): images under `Attachments/<YYYY-MM>/`, everything else under `3 Resources/`.
 */
import { isNotePath } from '../markdown/content-classes.js';
import type { VaultPath } from '../vault/vault-types.js';

export type FileKind = 'image' | 'pdf' | 'document' | 'note' | 'other';

/** Where a non-image upload goes; `auto` picks from the extension. */
export const ATTACHMENT_TARGETS = ['auto', 'papers', 'slides', 'other'] as const;
export type AttachmentTarget = (typeof ATTACHMENT_TARGETS)[number];

/** Images the app shows inline (SVG only ever as `<img>`, see the files route). */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const SLIDE_EXTENSIONS = new Set(['ppt', 'pptx', 'key', 'odp']);
/** Office-style documents a student keeps next to papers and slides. */
const DOCUMENT_EXTENSIONS = new Set([
  ...SLIDE_EXTENSIONS,
  'doc',
  'docx',
  'odt',
  'rtf',
  'xls',
  'xlsx',
  'ods',
  'csv',
  'txt',
  'epub',
  'pages',
  'numbers',
]);

export const ATTACHMENTS_FOLDER = 'Attachments';
export const RESOURCES_FOLDER = '3 Resources';

/** Lower-case extension without the dot ('' when the name has none). */
export function extensionOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function fileKindOf(name: string): FileKind {
  if (isNotePath(name)) return 'note';
  const extension = extensionOf(name);
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (extension === 'pdf') return 'pdf';
  return DOCUMENT_EXTENSIONS.has(extension) ? 'document' : 'other';
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Folder for a dropped file: images by local month (the chooser does not apply to them), PDFs to
 * `papers`, slide decks to `slides` and everything else to `other` unless the user chose.
 */
export function attachmentFolder(name: string, target: AttachmentTarget, now: Date): VaultPath {
  if (fileKindOf(name) === 'image') {
    return `${ATTACHMENTS_FOLDER}/${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  }
  if (target !== 'auto') return `${RESOURCES_FOLDER}/${target}`;
  const extension = extensionOf(name);
  if (extension === 'pdf') return `${RESOURCES_FOLDER}/papers`;
  if (SLIDE_EXTENSIONS.has(extension)) return `${RESOURCES_FOLDER}/slides`;
  return `${RESOURCES_FOLDER}/other`;
}
