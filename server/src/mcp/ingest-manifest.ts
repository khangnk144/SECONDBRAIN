import { mkdir, readFile, readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../fs/atomic-write-file.js';
import type { VaultPath } from '../vault/vault-types.js';
import { McpToolError } from './mcp-tool-result.js';

/**
 * Ingest manifests (SPEC F32 "Ingest manifest"): `state/ingest/<sourceId>.json`, durable state
 * written only by the server. A source counts as ingested only after `ingest_complete` checked
 * the outputs and appended the log line itself.
 */
export type IngestRunStatus = 'running' | 'succeeded' | 'failed';

export interface IngestRun {
  runId: string;
  contentHash: string;
  startedAt: string;
  finishedAt: string | null;
  status: IngestRunStatus;
  outputs: VaultPath[];
  logLine: string | null;
  /** Why a run failed: the model's reason, `stale`, `needs-review` or `source-changed`. */
  reason: string | null;
}

export interface IngestManifest {
  version: 1;
  sourceId: string;
  path: VaultPath;
  runs: IngestRun[];
}

export type SourceIngestStatus =
  'new' | 'ingested' | 'changed' | 'running' | 'failed' | 'needs-review';

export const MAX_RUNS = 20;
/** A run still `running` after this long was abandoned (the model stopped half-way). */
export const STALE_RUN_MS = 60 * 60 * 1000;

const SOURCE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const RUN_ID = /^([A-Za-z0-9_-]{1,80})\.([0-9A-HJKMNP-TV-Z]{26})$/;

export function checkSourceId(sourceId: string): string {
  if (!SOURCE_ID.test(sourceId)) {
    throw new McpToolError('VALIDATION', 'Unknown source id format.', { reason: 'source-id' });
  }
  return sourceId;
}

/** Run ids name their source (`<sourceId>.<ulid>`), so a run is found from its id alone. */
export function runIdFor(sourceId: string, ulid: string): string {
  return `${sourceId}.${ulid}`;
}

export function sourceIdOfRun(runId: string): string {
  const match = RUN_ID.exec(runId);
  if (!match) throw new McpToolError('NOT_FOUND', 'No ingest run with this id.', { runId });
  return match[1] as string;
}

export function manifestFile(dir: string, sourceId: string): string {
  return path.join(dir, `${checkSourceId(sourceId)}.json`);
}

function isRun(value: unknown): value is IngestRun {
  const run = value as Partial<IngestRun> | null;
  return (
    typeof run === 'object' &&
    run !== null &&
    typeof run.runId === 'string' &&
    typeof run.contentHash === 'string' &&
    typeof run.startedAt === 'string' &&
    (run.status === 'running' || run.status === 'succeeded' || run.status === 'failed') &&
    Array.isArray(run.outputs)
  );
}

function isManifest(value: unknown, sourceId: string): value is IngestManifest {
  const manifest = value as Partial<IngestManifest> | null;
  return (
    typeof manifest === 'object' &&
    manifest !== null &&
    manifest.version === 1 &&
    manifest.sourceId === sourceId &&
    typeof manifest.path === 'string' &&
    Array.isArray(manifest.runs) &&
    manifest.runs.every(isRun)
  );
}

/**
 * The manifest of a source, null when there is none. An unreadable one is set aside as
 * `<id>.json.corrupt` when `setAsideCorrupt` (before a write replaces it), else ignored.
 */
export async function readManifest(
  dir: string,
  sourceId: string,
  setAsideCorrupt = false,
): Promise<IngestManifest | null> {
  const file = manifestFile(dir, sourceId);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (isManifest(parsed, sourceId)) return parsed;
  } catch {
    // fall through: not JSON
  }
  if (setAsideCorrupt) await rename(file, `${file}.corrupt`);
  return null;
}

export async function writeManifest(dir: string, manifest: IngestManifest): Promise<void> {
  await mkdir(dir, { recursive: true });
  await atomicWriteFile(
    manifestFile(dir, manifest.sourceId),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

export function isStale(run: IngestRun, now: Date): boolean {
  return run.status === 'running' && now.getTime() - Date.parse(run.startedAt) > STALE_RUN_MS;
}

/** Marks abandoned runs failed (`stale`); true when something changed. */
export function failStaleRuns(manifest: IngestManifest, now: Date): boolean {
  let changed = false;
  for (const run of manifest.runs) {
    if (!isStale(run, now)) continue;
    Object.assign(run, { status: 'failed', finishedAt: now.toISOString(), reason: 'stale' });
    changed = true;
  }
  return changed;
}

export function latestSucceeded(runs: readonly IngestRun[]): IngestRun | null {
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    if (runs[i]?.status === 'succeeded') return runs[i] as IngestRun;
  }
  return null;
}

/** Oldest runs go first, but the newest succeeded run is always kept (it says "ingested"). */
export function pruneRuns(runs: IngestRun[]): IngestRun[] {
  if (runs.length <= MAX_RUNS) return runs;
  const keep = runs.slice(-MAX_RUNS);
  const success = latestSucceeded(runs);
  if (success && !keep.includes(success)) keep.splice(0, 1, success);
  return keep;
}

/** Status shown by `list_sources`; an abandoned run counts as failed even before it is swept. */
export function ingestStatusOf(
  manifest: IngestManifest | null,
  currentHash: string,
  now: Date,
): SourceIngestStatus {
  const runs = manifest?.runs ?? [];
  const last = runs.at(-1);
  if (last?.status === 'running' && !isStale(last, now)) return 'running';
  const success = latestSucceeded(runs);
  if (success) return success.contentHash === currentHash ? 'ingested' : 'changed';
  if (!last) return 'new';
  return last.reason === 'needs-review' ? 'needs-review' : 'failed';
}

/** Run summary for listings (`stale` runs shown as failed). */
export function runSummary(run: IngestRun | undefined, now: Date) {
  if (!run) return null;
  const stale = isStale(run, now);
  return {
    runId: run.runId,
    status: stale ? 'failed' : run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    reason: stale ? 'stale' : run.reason,
  };
}

/** Ids of every manifest in the folder (for the sweep at MCP start). */
export async function manifestIds(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir))
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length))
      .filter((id) => SOURCE_ID.test(id));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
