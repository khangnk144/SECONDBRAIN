/** `GET /api/link-targets`: every linkable note and non-note file (autocomplete, ghost links). */
import type { ContentClass, VaultPath } from './vault-types';

export interface LinkTargetNote {
  path: VaultPath;
  title: string;
  /** First path segment ('' for root-level notes). */
  folder: string;
  class: ContentClass;
  /** The title resolves to exactly one note vault-wide (else insert the path form). */
  unique: boolean;
}

export interface LinkTargetFile {
  path: VaultPath;
  name: string;
}

export interface LinkTargetsResponse {
  notes: LinkTargetNote[];
  files: LinkTargetFile[];
}
