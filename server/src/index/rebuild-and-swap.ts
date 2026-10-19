/**
 * One full rebuild: build a fresh database next to the live one, remember what the old index
 * knew about changes waiting behind the rebuild, then swap the files. The caller attaches the
 * returned connection (the new one, or the old one reopened when the swap failed).
 */
import type Database from 'better-sqlite3';
import type { VaultPath, VaultService } from '../vault/vault-types.js';
import type { DeferredSnapshots } from './deferred-snapshots.js';
import { BuildCancelledError, buildIndexFile } from './index-builder.js';
import { swapDatabase, type SwapFaults } from './database-swap.js';
import { buildingFileOf, removeDatabaseFiles } from './index-database.js';
import type { RebuildProgress } from './index-types.js';

export interface RebuildAndSwapInput {
  vault: VaultService;
  dbFile: string;
  /** The live connection (closed by the swap), or null when there is none. */
  current: Database.Database | null;
  deferred: DeferredSnapshots;
  report: (progress: RebuildProgress) => void;
  isCancelled: () => boolean;
  warn: (message: string, details?: Record<string, unknown>) => void;
  faults: SwapFaults;
}

export type RebuildOutcome =
  | { swapped: true; db: Database.Database; paths: VaultPath[] }
  | { swapped: false; db: Database.Database | null; error: Error };

export async function rebuildAndSwap(input: RebuildAndSwapInput): Promise<RebuildOutcome> {
  const buildFile = buildingFileOf(input.dbFile);
  const built = await buildIndexFile({
    vault: input.vault,
    file: buildFile,
    onProgress: input.report,
    isCancelled: input.isCancelled,
    warn: input.warn,
  });
  // Closed while the last batch was being written: never put a file in place nobody will close.
  if (input.isCancelled()) {
    removeDatabaseFiles(buildFile);
    throw new BuildCancelledError();
  }
  const total = built.paths.length;
  input.report({ phase: 'swap', done: total, total });
  input.deferred.capture(input.current);
  const swap = swapDatabase(buildFile, input.dbFile, input.current, input.faults);
  return swap.swapped ? { swapped: true, db: swap.db, paths: built.paths } : swap;
}
