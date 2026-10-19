/** Why a save did not reach the disk, and when to try again on our own. */
import { ApiError } from '../../lib/api-client';

export type SaveErrorKind = 'offline' | 'disk-full' | 'locked' | 'write-failed' | 'other';

export function classifySaveError(error: unknown): SaveErrorKind {
  if (!(error instanceof ApiError)) return 'offline';
  if (error.code === 'WRITE_FAILED') {
    const cause = error.details.cause;
    if (cause === 'ENOSPC' || cause === 'EDQUOT') return 'disk-full';
    if (cause === 'EBUSY' || cause === 'EACCES' || cause === 'EPERM') return 'locked';
    return 'write-failed';
  }
  // The server or a proxy failing (502/503/504 while it restarts) counts as "not reachable".
  if (error.status >= 500 && error.code.startsWith('HTTP_')) return 'offline';
  return 'other';
}

/** Refusals that will not change by themselves (validation, permissions) wait for the user. */
export function retriesOnItsOwn(kind: SaveErrorKind): boolean {
  return kind !== 'other';
}

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

/** Backoff for automatic retries: 1 s, 2 s, 4 s … then every 30 s. */
export function retryDelayMs(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] ?? 30_000;
}
