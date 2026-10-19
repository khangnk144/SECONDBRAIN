import type { VaultPath } from '../vault/vault-types.js';

/** One file of the sample set: text notes as strings, PDFs as bytes. */
export interface SampleFile {
  path: VaultPath;
  content: string | Uint8Array;
}
