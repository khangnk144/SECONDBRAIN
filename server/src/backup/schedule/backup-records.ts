/**
 * `<home>/.secondbrain/backups.json` (SPEC F27.1): machine-wide state of the scheduled backups,
 * one entry per vault id. Every update re-reads the file, changes one vault's entry and writes
 * it atomically, in one queue per file. A file that cannot be parsed is kept as
 * `.corrupt-<ts>` and starts empty (retention then knows no zip, so it deletes nothing).
 */
import { copyFile, readFile } from 'node:fs/promises';
import { atomicWriteFile } from '../../fs/atomic-write-file.js';
import type { AppLogger } from '../../logging/rotating-file-logger.js';
import type { BackupRun, PushRecord, VaultBackupRecord } from './schedule-types.js';

export const BACKUP_RECORDS_FILE = 'backups.json';
/** Runs kept per vault, besides the successful ones whose zip is still on disk. */
export const MAX_RUNS = 60;
/** Upper bound of the list, zips on disk included (they may sit in an older folder). */
const MAX_LIVE_RUNS = 200;

interface RecordsFile {
  version: 1;
  vaults: Record<string, VaultBackupRecord>;
}

export const emptyRecord = (): VaultBackupRecord => ({
  runs: [],
  lastSuccessAt: null,
  lastAttemptAt: null,
  retryAt: null,
  push: null,
});

const isIso = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const isoOrNull = (value: unknown): string | null => (isIso(value) ? value : null);

function parseRun(raw: unknown): BackupRun | null {
  const run = raw as Partial<BackupRun> | null;
  if (!run || typeof run !== 'object' || !isIso(run.at) || typeof run.ok !== 'boolean') return null;
  return {
    at: run.at,
    kind: run.kind ?? 'scheduled',
    file: typeof run.file === 'string' ? run.file : null,
    bytes: Number.isFinite(run.bytes) ? Number(run.bytes) : 0,
    ok: run.ok,
    ...(typeof run.error === 'string' ? { error: run.error } : {}),
    ...(run.removed === true ? { removed: true } : {}),
  };
}

function parsePush(raw: unknown): PushRecord | null {
  const push = raw as Partial<PushRecord> | null;
  if (!push || typeof push !== 'object' || !isIso(push.at) || typeof push.ok !== 'boolean')
    return null;
  return { at: push.at, ok: push.ok, ...(push.error ? { error: push.error } : {}) };
}

function parseRecord(raw: unknown): VaultBackupRecord {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const runs = Array.isArray(record.runs) ? record.runs.map(parseRun) : [];
  return {
    runs: runs.filter((run): run is BackupRun => run !== null),
    lastSuccessAt: isoOrNull(record.lastSuccessAt),
    lastAttemptAt: isoOrNull(record.lastAttemptAt),
    retryAt: isoOrNull(record.retryAt),
    push: parsePush(record.push),
  };
}

/** Parsed file, or null when it is not a records file at all. */
export function parseRecordsFile(text: string): RecordsFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const vaults = (raw as { vaults?: unknown } | null)?.vaults;
  if (!vaults || typeof vaults !== 'object' || Array.isArray(vaults)) return null;
  const out: Record<string, VaultBackupRecord> = {};
  for (const [id, record] of Object.entries(vaults)) out[id] = parseRecord(record);
  return { version: 1, vaults: out };
}

/** Keeps every zip still on disk plus the newest other runs, `MAX_RUNS` in all. */
export function trimRuns(runs: readonly BackupRun[]): BackupRun[] {
  const live = (run: BackupRun) => run.ok && !run.removed;
  let budget = MAX_RUNS - runs.filter(live).length;
  const kept: BackupRun[] = [];
  // Newest first, so the runs that fall off are the oldest ones.
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    const run = runs[i] as BackupRun;
    if (live(run)) kept.push(run);
    else if (budget > 0) {
      kept.push(run);
      budget -= 1;
    }
  }
  // Zips of a folder no longer configured are never deleted by retention: cap the list anyway.
  return kept.slice(0, MAX_LIVE_RUNS).reverse();
}

export interface BackupRecords {
  readonly file: string;
  read(vaultId: string): Promise<VaultBackupRecord>;
  /** Applies `change` to a copy of the vault's entry and writes the file; resolves with it. */
  update(vaultId: string, change: (record: VaultBackupRecord) => void): Promise<VaultBackupRecord>;
}

export function openBackupRecords(options: {
  file: string;
  now: () => Date;
  logger: AppLogger;
}): BackupRecords {
  const { file, logger } = options;
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
  };

  /** `keepCorrupt`: only a write keeps a garbled file aside (a read never changes the disk). */
  async function load(keepCorrupt: boolean): Promise<RecordsFile> {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, vaults: {} };
      throw error; // locked or unreadable: the caller's run fails, nothing is overwritten
    }
    const parsed = parseRecordsFile(text);
    if (parsed) return parsed;
    if (!keepCorrupt) return { version: 1, vaults: {} };
    const stamp = options.now().toISOString().replace(/[:.]/g, '-');
    await copyFile(file, `${file}.corrupt-${stamp}`);
    logger.warn('Backup records were unreadable; a copy was kept and they start empty.');
    return { version: 1, vaults: {} };
  }

  return {
    file,
    read: (vaultId) =>
      enqueue(async () => structuredClone((await load(false)).vaults[vaultId] ?? emptyRecord())),
    update: (vaultId, change) =>
      enqueue(async () => {
        const data = await load(true);
        const record = structuredClone(data.vaults[vaultId] ?? emptyRecord());
        change(record);
        record.runs = trimRuns(record.runs);
        data.vaults[vaultId] = record;
        await atomicWriteFile(file, `${JSON.stringify(data, null, 2)}\n`);
        return structuredClone(record);
      }),
  };
}
