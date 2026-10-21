/** `GET /api/resources`, mirrored from `server/src/attachments/resource-listing.ts`. */
import type { VaultPath } from './vault-types';

export type ResourceKind = 'image' | 'pdf' | 'document' | 'note' | 'other';

export interface ResourceReference {
  path: VaultPath;
  title: string;
}

/** Text read from a source file (SPEC F30.2): `none` = "Không đọc được chữ", `reason` says why. */
export interface ResourceText {
  quality: 'ok' | 'low' | 'none' | 'pending';
  pages: number | null;
  /** `no-text`, `sparse-text`, `encrypted`, `damaged`, `too-large`, `timeout`… (null when ok). */
  reason: string | null;
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
  /** Text state of a supported source file (PDF, text formats); null otherwise or unknown. */
  text?: ResourceText | null;
}

export interface ResourcesResponse {
  files: ResourceFile[];
}
