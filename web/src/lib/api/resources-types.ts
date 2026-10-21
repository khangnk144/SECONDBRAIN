/** `GET /api/resources`, mirrored from `server/src/attachments/resource-listing.ts`. */
import type { VaultPath } from './vault-types';

export type ResourceKind = 'image' | 'pdf' | 'document' | 'note' | 'other';

export interface ResourceReference {
  path: VaultPath;
  title: string;
}

export interface ResourceFile {
  path: VaultPath;
  name: string;
  /** Parent folder of the file (`3 Resources/papers`, `Attachments/2026-10`…). */
  folder: VaultPath;
  kind: ResourceKind;
  /** Bytes. */
  size: number;
  /** Epoch milliseconds. */
  mtime: number;
  /** Notes with a resolved link to this file, sorted by title. */
  referencedBy: ResourceReference[];
}

export interface ResourcesResponse {
  files: ResourceFile[];
}
