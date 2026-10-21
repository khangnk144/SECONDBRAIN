/**
 * Version history on a git repository in the vault (SPEC F20). Every git command runs in one
 * serial queue; nothing here changes the working tree – a restore is an ordinary
 * revision-checked vault write between two commits (the text it replaces, then the restore).
 * Failures are logged as codes and never block saving: the vault does not wait for git.
 */
import path from 'node:path';
import { errorCodeOf } from '../app-context/app-context-errors.js';
import type { AppContext } from '../app-context/create-app-context.js';
import { SerialQueue } from '../index/serial-queue.js';
import type { AppLogger } from '../logging/rotating-file-logger.js';
import { conflict, decodeStrict } from '../vault/vault-errors.js';
import {
  isVaultError,
  VaultError,
  type VaultPath,
  type WriteResult,
} from '../vault/vault-types.js';
import {
  clearStaleIndexLock,
  commitVaultChanges,
  type CommitResult,
} from './commit-vault-changes.js';
import type { GitRunner } from './git-runner.js';
import {
  HistoryUnavailableError,
  type HistoryService,
  type HistoryStatus,
  type NoteVersion,
} from './history-types.js';
import { blobAtCommit, noteHistoryCommits } from './note-history-log.js';

export interface GitHistoryServiceOptions {
  context: AppContext;
  git: GitRunner;
  logger: AppLogger;
  now: () => Date;
  lockStaleMs: number;
  lastCommitAt: string | null;
}

export function createGitHistoryService(options: GitHistoryServiceOptions): HistoryService {
  const { context, git, logger } = options;
  const root = context.vault.root;
  const queue = new SerialQueue();
  let lastCommitAt = options.lastCommitAt;
  let closed = false;

  const assertOpen = () => {
    if (closed) throw new HistoryUnavailableError('closed');
  };

  /** The path as the file system spells it (git stores those bytes); the request's when gone. */
  async function gitPathOf(vaultPath: VaultPath): Promise<string> {
    try {
      const abs = await context.vault.resolveExisting(vaultPath);
      return path.relative(root, abs).split(path.sep).join('/');
    } catch (error) {
      if (isVaultError(error) && error.code === 'NOT_FOUND') return vaultPath;
      throw error;
    }
  }

  function commitAll(message: (files: number) => string): Promise<CommitResult | null> {
    return queue.enqueue(async () => {
      try {
        const lock = await clearStaleIndexLock(git, root, options.lockStaleMs, options.now());
        if (lock === 'removed') logger.warn('History: removed a stale git index lock.');
        const result = await commitVaultChanges(git, message);
        if (result) {
          lastCommitAt = result.date;
          logger.info(`History: committed ${result.files} changed files.`);
        }
        return result;
      } catch (error) {
        logger.warn(`History: commit failed (${errorCodeOf(error)}); retrying later.`);
        return null;
      }
    });
  }

  /**
   * Commits whatever is pending (the text since the last auto-commit included), then checks
   * that HEAD holds exactly the bytes at `expectedRevision`. A failed commit, a file git could
   * not read or one the user's own ignore rules leave out all answer false.
   */
  async function replacedTextIsCommitted(
    vaultPath: VaultPath,
    expectedRevision: string,
  ): Promise<boolean> {
    const before = await context.vault.readBytes(vaultPath);
    if (before.revision !== expectedRevision) throw conflict(before.path, before);
    await commitAll((files) => `auto: ${files} files`);
    try {
      const gitPath = await gitPathOf(before.path);
      const head = await queue.enqueue(() => blobAtCommit(git, 'HEAD', gitPath));
      return head?.equals(before.bytes) ?? false;
    } catch (error) {
      logger.warn(`History: checking the commit before a restore failed (${errorCodeOf(error)}).`);
      return false;
    }
  }

  /** The replaced text goes to the trash first; if even that fails, nothing is restored. */
  async function writeKeepingTrashCopy(
    vaultPath: VaultPath,
    content: string,
    expectedRevision: string,
  ): Promise<WriteResult> {
    logger.warn('History: the text a restore replaces is not committed; a trash copy is kept.');
    try {
      return await context.vault.writeKeepingConflictCopy(
        vaultPath,
        content,
        expectedRevision,
        'history-restore',
      );
    } catch (error) {
      // A changed revision or a non-UTF-8 note answers as for any write.
      if (isVaultError(error) && error.code !== 'WRITE_FAILED') throw error;
      logger.warn(`History: keeping a trash copy failed (${errorCodeOf(error)}); not restored.`);
      throw new VaultError(
        'WRITE_FAILED',
        'The current text could not be kept, so the old version was not restored.',
        { path: vaultPath, reason: 'copy-failed' },
      );
    }
  }

  async function findVersion(
    vaultPath: VaultPath,
    commit: string,
  ): Promise<(NoteVersion & { shortCommit: string }) | null> {
    const gitPath = await gitPathOf(vaultPath);
    const found = await queue.enqueue(async () => {
      const commits = await noteHistoryCommits(git, gitPath);
      const match = commits.find((entry) => entry.commit.startsWith(commit));
      const at = match ?? { commit, gitPath, shortCommit: commit.slice(0, 7) };
      const bytes = await blobAtCommit(git, at.commit, at.gitPath);
      return bytes && { bytes, gitPath: at.gitPath, shortCommit: at.shortCommit };
    });
    if (!found) return null;
    const content = decodeStrict(found.bytes);
    if (content === null) {
      throw new VaultError('VALIDATION', 'That version is not UTF-8 text.', {
        path: vaultPath,
        reason: 'not-utf8',
      });
    }
    return {
      content,
      pathAtCommit: found.gitPath.normalize('NFC'),
      shortCommit: found.shortCommit,
    };
  }

  return {
    status: (): HistoryStatus => ({ available: !closed, lastCommitAt }),
    async noteHistory(vaultPath) {
      assertOpen();
      const gitPath = await gitPathOf(vaultPath);
      const commits = await queue.enqueue(() => noteHistoryCommits(git, gitPath));
      return commits.map(({ gitPath: _gitPath, deleted: _deleted, ...entry }) => entry);
    },
    async noteVersion(vaultPath, commit) {
      assertOpen();
      const version = await findVersion(vaultPath, commit);
      return version && { content: version.content, pathAtCommit: version.pathAtCommit };
    },
    async restore(vaultPath, commit, expectedRevision) {
      assertOpen();
      // v1 restores existing notes only; a note deleted since stays deleted.
      const current = await context.vault.stat(vaultPath);
      if (!current)
        throw new VaultError('NOT_FOUND', 'The note no longer exists.', { path: vaultPath });
      const version = await findVersion(vaultPath, commit);
      if (!version) {
        throw new VaultError('NOT_FOUND', 'The note did not exist in that version.', {
          path: vaultPath,
          reason: 'not-in-commit',
        });
      }
      // The text being replaced stays reachable: in a commit, else in the trash.
      const written = (await replacedTextIsCommitted(current.path, expectedRevision))
        ? await context.vault.write(current.path, version.content, expectedRevision)
        : await writeKeepingTrashCopy(current.path, version.content, expectedRevision);
      await context.settled();
      const made = await commitAll(() => `restore: ${written.path} @ ${version.shortCommit}`);
      return { revision: written.revision, commit: made?.commit ?? null };
    },
    async commitNow() {
      const result = await commitAll((files) => `auto: ${files} files`);
      return result && { commit: result.commit, files: result.files };
    },
    idle: () => queue.idle(),
    /** Refuses new requests, then the on-close auto-commit (after any queued work). */
    async close() {
      closed = true;
      await commitAll((files) => `auto: ${files} files`);
    },
  };
}
