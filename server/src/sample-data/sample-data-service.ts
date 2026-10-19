import { readFile } from 'node:fs/promises';
import { atomicWriteFile } from '../fs/atomic-write-file.js';
import { toLocalDate } from '../lib/local-date.js';
import { classifyPath } from '../markdown/content-classes.js';
import { VaultError, type VaultPath, type VaultService } from '../vault/vault-types.js';
import { buildSampleDataSet } from './sample-data-set.js';

/** `state/sample.json`: which files the sample set created, at which revision. */
interface SampleManifest {
  version: 1;
  createdAt: string;
  files: { path: VaultPath; revision: string }[];
  /** Set once the set was removed; keeps the first-run offer from coming back. */
  removedAt?: string;
}

export interface SampleDataStatus {
  /** First run: no manifest yet and no notes of the user's own. */
  offered: boolean;
  /** Sample files are recorded and may be removed. */
  present: boolean;
}

export interface SampleDataRemoval {
  removed: VaultPath[];
  /** Recorded files the user edited since: they are the user's now and stay. */
  kept: VaultPath[];
  trashId: string | null;
  journalId: string | null;
}

export interface SampleDataService {
  status(): Promise<SampleDataStatus>;
  create(): Promise<{ created: VaultPath[] }>;
  remove(): Promise<SampleDataRemoval>;
}

const NOT_USER_CONTENT = new Set(['template', 'control', 'attachment']);

export function createSampleDataService(vault: VaultService, now: () => Date): SampleDataService {
  const file = vault.paths.sampleFile;
  // One operation at a time: two quick clicks must not create or trash the set twice.
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  async function readManifest(): Promise<SampleManifest | null> {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    try {
      const parsed = JSON.parse(text) as Partial<SampleManifest>;
      return { version: 1, createdAt: '', ...parsed, files: parsed.files ?? [] };
    } catch {
      // Unreadable manifest: treat the set as already handled rather than offering it again.
      return { version: 1, createdAt: '', files: [] };
    }
  }

  const writeManifest = (manifest: SampleManifest) =>
    atomicWriteFile(file, `${JSON.stringify(manifest, null, 2)}\n`);

  async function hasUserNotes(): Promise<boolean> {
    const { files } = await vault.list();
    return files.some(
      (entry) =>
        entry.path.toLowerCase().endsWith('.md') && !NOT_USER_CONTENT.has(classifyPath(entry.path)),
    );
  }

  async function create(): Promise<{ created: VaultPath[] }> {
    const existing = await readManifest();
    if (existing && existing.files.length > 0) {
      throw new VaultError('EXISTS', 'Sample data is already present.', {});
    }
    const set = buildSampleDataSet(toLocalDate(now()));
    const taken: VaultPath[] = [];
    for (const entry of set) if ((await vault.stat(entry.path)) !== null) taken.push(entry.path);
    if (taken.length > 0) {
      throw new VaultError('EXISTS', 'Some sample file names are already used.', { paths: taken });
    }
    const manifest: SampleManifest = { version: 1, createdAt: now().toISOString(), files: [] };
    try {
      for (const entry of set) {
        const result = await vault.create(entry.path, entry.content);
        manifest.files.push({ path: result.path, revision: result.revision });
      }
    } finally {
      // Also after a partial failure, so "remove sample data" can clean up what was created.
      if (manifest.files.length > 0) await writeManifest(manifest);
    }
    return { created: manifest.files.map((entry) => entry.path) };
  }

  async function remove(): Promise<SampleDataRemoval> {
    const manifest = await readManifest();
    if (!manifest || manifest.files.length === 0) {
      throw new VaultError('NOT_FOUND', 'There is no sample data to remove.', {});
    }
    const unchanged: { path: VaultPath; revision: string }[] = [];
    const kept: VaultPath[] = [];
    for (const entry of manifest.files) {
      if ((await vault.stat(entry.path)) === null) continue; // already deleted by the user
      const current = await vault.readBytes(entry.path);
      if (current.revision === entry.revision) unchanged.push(entry);
      else kept.push(entry.path);
    }
    const trashed =
      unchanged.length > 0
        ? await vault.trash(
            unchanged.map((entry) => entry.path),
            unchanged.map((entry) => entry.revision),
            'sample-data',
          )
        : null;
    await writeManifest({ ...manifest, files: [], removedAt: now().toISOString() });
    return {
      removed: unchanged.map((entry) => entry.path),
      kept,
      trashId: trashed?.trashId ?? null,
      journalId: trashed?.journalId ?? null,
    };
  }

  return {
    async status() {
      const manifest = await readManifest();
      return {
        offered: manifest === null && !(await hasUserNotes()),
        present: manifest !== null && manifest.files.length > 0,
      };
    },
    create: () => serialized(create),
    remove: () => serialized(remove),
  };
}
