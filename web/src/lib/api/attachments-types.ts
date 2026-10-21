/** `POST /api/attachments` (multipart), mirrored from the server's attachment route. */
import type { VaultPath } from './vault-types';

/**
 * Where a document goes (SPEC §4.8): `auto` lets the server decide by extension (pdf → papers,
 * slides → slides, else other). Images always go to `Attachments/<YYYY-MM>/`; the target is
 * ignored for them.
 */
export type AttachmentTarget = 'auto' | 'papers' | 'slides' | 'other';

/** The three folders a person can choose for a document (`3 Resources/<target>/`). */
export const DOCUMENT_TARGETS = ['papers', 'slides', 'other'] as const;
export type DocumentTarget = (typeof DOCUMENT_TARGETS)[number];

export type AttachmentKind = 'image' | 'pdf' | 'document' | 'other';

export interface AttachmentUploadResponse {
  /** Where the file was saved (unique name across the vault). */
  path: VaultPath;
  name: string;
  kind: AttachmentKind;
  /** The link to insert: `![[name.png]]` for images, `[[name.pdf]]` otherwise (or a path form). */
  link: string;
}
