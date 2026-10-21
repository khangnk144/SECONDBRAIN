import { writeKeepingConflictCopy } from './conflict-copy-ops.js';
import { previewRenameFolder, renameFolder, trashFolder } from './folder-ops.js';
import { completeJournal, pendingJournal, undoJournal } from './journal-runner.js';
import { rewriteJournaled } from './journaled-rewrite-ops.js';
import {
  moveFileToFolder,
  previewMoveToFolder,
  previewRenameFile,
  renameFile,
} from './rename-ops.js';
import { listTrash, purgeTrash, restoreTrashEntry, trashFiles } from './trash-ops.js';
import { createUlidGenerator } from './ulid.js';
import type { VaultCore, VaultWarning } from './vault-core.js';
import type { VaultFaults } from './vault-faults.js';
import { buildStatePaths } from './vault-layout.js';
import {
  listVault,
  readVaultBytes,
  readVaultNote,
  resolveExistingEntry,
  resolveExistingFile,
  statVaultFile,
} from './vault-read-ops.js';
import {
  createFile,
  createUniqueFile,
  createVaultFolder,
  patchFile,
  patchFileWith,
  writeFile,
} from './vault-write-ops.js';
import { createWriteQueue } from './write-queue.js';
import type { VaultChange, VaultService } from './vault-types.js';

export interface VaultServiceOptions {
  /** Real path of an existing vault root whose layout is already in place. */
  root: string;
  id: string;
  now?: () => Date;
  faults?: VaultFaults;
  /** Housekeeping problems that did not stop the operation (counts and error codes, no content). */
  onWarning?: VaultWarning;
}

/** Assembles the VaultService over one vault root; `openVault` is the normal way to get one. */
export function createVaultService(options: VaultServiceOptions): VaultService {
  const now = options.now ?? (() => new Date());
  const listeners = new Set<(change: VaultChange) => void>();
  const core: VaultCore = {
    root: options.root,
    id: options.id,
    paths: buildStatePaths(options.root),
    faults: options.faults ?? {},
    now,
    newId: createUlidGenerator(now),
    queue: createWriteQueue(),
    planner: null,
    warn: (message, details) => {
      try {
        options.onWarning?.(message, details);
      } catch {
        // Reporting must never turn into a failure of the operation itself.
      }
    },
    emit: (change) => {
      for (const listener of listeners) {
        try {
          listener(change);
        } catch {
          // A failing listener must not turn a durable write into a reported failure.
        }
      }
    },
  };
  let closed = false;
  /** Reads go around the queue; after close() they fail like mutations do. */
  const open = <T>(read: () => Promise<T>): Promise<T> =>
    closed ? Promise.reject(new Error('The vault is closed')) : read();

  return {
    root: core.root,
    id: core.id,
    paths: core.paths,
    list: () => open(() => listVault(core)),
    stat: (path) => open(() => statVaultFile(core, path)),
    read: (path) => open(() => readVaultNote(core, path)),
    readBytes: (path) => open(() => readVaultBytes(core, path)),
    resolveExisting: (path) => open(() => resolveExistingFile(core, path)),
    resolveEntry: (path) => open(() => resolveExistingEntry(core, path)),
    create: (path, content) => createFile(core, path, content),
    createUnique: (path, content) => createUniqueFile(core, path, content),
    createFolder: (path) => createVaultFolder(core, path),
    write: (path, content, expectedRevision) => writeFile(core, path, content, expectedRevision),
    patch: (path, patches, expectedRevision) => patchFile(core, path, patches, expectedRevision),
    rename: (path, newPath, opts) => renameFile(core, path, newPath, opts, 'rename'),
    move: (path, folder, opts) => open(() => moveFileToFolder(core, path, folder, opts)),
    previewRename: (path, newPath, opts) => previewRenameFile(core, path, newPath, opts, 'rename'),
    previewMove: (path, folder, opts) => open(() => previewMoveToFolder(core, path, folder, opts)),
    patchWith: (path, expectedRevision, plan) => patchFileWith(core, path, expectedRevision, plan),
    rewriteJournaled: (path, expectedRevision, plan, op) =>
      rewriteJournaled(core, path, expectedRevision, plan, op),
    writeKeepingConflictCopy: (path, content, expectedRevision) =>
      writeKeepingConflictCopy(core, path, content, expectedRevision),
    renameFolder: (path, newPath, opts) => renameFolder(core, path, newPath, opts),
    previewRenameFolder: (path, newPath, opts) => previewRenameFolder(core, path, newPath, opts),
    trashFolder: (path) => trashFolder(core, path),
    trash: (paths, expectedRevisions, reason = 'user') =>
      trashFiles(core, paths, expectedRevisions, reason),
    restore: (trashId) => restoreTrashEntry(core, trashId),
    listTrash: () => open(() => listTrash(core)),
    purgeTrash: (maxAgeDays, at) => purgeTrash(core, maxAgeDays, at ?? now()),
    pendingJournal: () => open(() => pendingJournal(core)),
    completeJournal: (id) => completeJournal(core, id),
    undoJournal: (id) => undoJournal(core, id),
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setRelinkPlanner(planner) {
      core.planner = planner;
    },
    async close() {
      closed = true;
      await core.queue.close();
    },
  };
}
