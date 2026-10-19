import type { VaultPath } from './api/vault-types';
import { cleanName, validateName } from './name-validation';
import { nameProblemMessage } from './operation-errors';
import { showToast } from './toast-store';

/** Outcome of a vault operation; failures were already shown to the user as a toast. */
export type OperationResult =
  { ok: true; path: VaultPath } | { ok: false; reason: 'invalid' | 'cancelled' | 'failed' };

export const FAILED = { ok: false, reason: 'failed' } as const;
export const CANCELLED = { ok: false, reason: 'cancelled' } as const;
export const INVALID = { ok: false, reason: 'invalid' } as const;

export interface RevisionOption {
  /** Revision the caller already holds; fetched from the server when omitted. */
  expectedRevision?: string;
}

/** Cleans and checks a name; shows the problem as a toast. Returns null when invalid. */
export function acceptName(name: string): string | null {
  const cleaned = cleanName(name);
  const problem = validateName(cleaned);
  if (problem === null) return cleaned;
  showToast({ message: nameProblemMessage(problem), tone: 'error' });
  return null;
}
