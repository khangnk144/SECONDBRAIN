import type { VaultPath } from './vault-types.js';

/** Disk operations a test can make fail: content writes, file moves, and the cross-volume copy. */
export type FaultOperation = 'write' | 'move' | 'copy';

/**
 * Test-only hooks to simulate disk errors and crashes. Production code never sets them.
 * - `failOperation` returns an errno code (`ENOSPC`, `EACCES`, `EXDEV` for moves, …) to make that
 *   operation on `path` fail as if the OS refused it; `undefined` lets it run.
 * - `crashBeforeRename` simulates a crash after the temp file is flushed and before the rename.
 * - `crashAfterJournalStep` simulates a crash right after step `applied` (1-based count of applied
 *   steps) was applied and recorded; the automatic rollback is skipped, as in a real crash.
 * - `crashAfterUndoStep` does the same during an undo, after `reverted` steps were reverted.
 */
export interface VaultFaults {
  failOperation?: (operation: FaultOperation, path: VaultPath) => string | undefined;
  crashBeforeRename?: (path: VaultPath) => boolean;
  crashAfterJournalStep?: (journalId: string, applied: number) => boolean;
  crashAfterUndoStep?: (journalId: string, reverted: number) => boolean;
}

/** Thrown by fault hooks to stand for a process crash: nothing may clean up after it. */
export class SimulatedCrashError extends Error {
  constructor(where: string) {
    super(`Simulated crash ${where}`);
    this.name = 'SimulatedCrashError';
  }
}

export function isSimulatedCrash(error: unknown): error is SimulatedCrashError {
  return error instanceof SimulatedCrashError;
}

export function injectedErrnoError(code: string, operation: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: injected failure during ${operation}`), { code });
}
