import { guardVaultPath, segmentProblem } from '../security/path-guard.js';
import type { JournalEntry, JournalStep } from './journal-types.js';
import { isUlid } from './ulid.js';
import { isVaultTempFileName } from './vault-layout.js';
import type { TrashMeta } from './vault-types.js';

/**
 * Journal and trash files are JSON on disk that anything can edit; before an id or path read back
 * from them names a file to move or overwrite, it must have the shape this service writes.
 */
const REVISION = /^[0-9a-f]{64}$/;
const COPY_REF = /^(before|after)\/\d+$/;
const OPS = new Set(['rename', 'move', 'trash', 'restore', 'reschedule']);
const STATUSES = new Set(['planned', 'running', 'done', 'failed', 'undone', 'undoing']);
const KINDS = new Set(['write', 'rename', 'trash', 'restore']);
const REASONS = new Set(['user', 'conflict', 'sample-data', 'restore-collision']);

type Loose = Record<string, unknown>;
const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null;

/** A stored vault path is already canonical: the guard accepts it and leaves it unchanged. */
export function isStoredVaultPath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return guardVaultPath(value) === value;
  } catch {
    return false;
  }
}

const isPlainName = (value: unknown): value is string =>
  typeof value === 'string' && !/[\\/]/.test(value) && segmentProblem(value) === null;

const isRef = (value: unknown) =>
  value === null || (typeof value === 'string' && COPY_REF.test(value));

function isValidStep(step: unknown): step is JournalStep {
  if (!isObject(step) || typeof step.kind !== 'string' || !KINDS.has(step.kind)) return false;
  const needsNewPath = step.kind === 'rename' || step.kind === 'restore';
  const sameFile = step.viaTemp !== undefined || step.fromName !== undefined;
  return (
    isStoredVaultPath(step.path) &&
    (needsNewPath ? isStoredVaultPath(step.newPath) : step.newPath === undefined) &&
    typeof step.expectedRevision === 'string' &&
    REVISION.test(step.expectedRevision) &&
    typeof step.afterRevision === 'string' &&
    REVISION.test(step.afterRevision) &&
    isRef(step.before) &&
    isRef(step.after) &&
    (step.kind !== 'write' || (step.before !== null && step.after !== null)) &&
    (!sameFile ||
      (step.kind === 'rename' &&
        isPlainName(step.viaTemp) &&
        isVaultTempFileName(step.viaTemp) &&
        isPlainName(step.fromName))) &&
    typeof step.applied === 'boolean'
  );
}

export function isValidTrashMeta(meta: unknown): meta is TrashMeta {
  return (
    isObject(meta) &&
    typeof meta.opId === 'string' &&
    isUlid(meta.opId) &&
    Array.isArray(meta.originalPaths) &&
    meta.originalPaths.length > 0 &&
    meta.originalPaths.every(isStoredVaultPath) &&
    typeof meta.reason === 'string' &&
    REASONS.has(meta.reason) &&
    typeof meta.deletedAt === 'string'
  );
}

export function isValidJournalEntry(value: unknown, id: string): value is JournalEntry {
  if (!isObject(value) || value.id !== id || !isUlid(id)) return false;
  const needsTrash = value.op === 'trash' || value.op === 'restore';
  const trash = value.trash;
  return (
    typeof value.op === 'string' &&
    OPS.has(value.op) &&
    typeof value.status === 'string' &&
    STATUSES.has(value.status) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    Array.isArray(value.steps) &&
    value.steps.every(isValidStep) &&
    (trash === undefined
      ? !needsTrash
      : isObject(trash) &&
        typeof trash.id === 'string' &&
        isUlid(trash.id) &&
        isValidTrashMeta(trash))
  );
}
