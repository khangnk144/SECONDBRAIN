/**
 * Pages the AI wrote on a local day (SPEC F34: Today's "não hôm nay" counts them), read from the
 * ingest manifests `state/ingest/<sourceId>.json` (F32): the `outputs` of every run that
 * succeeded that day. The manifests are the durable record of `ingest_complete` – the very
 * outputs the server broadcasts as `ai:touched` – so the count survives a restart and does not
 * depend on a window having been open. (MCP `write_note` calls outside an ingest leave no durable
 * record of their own; they are touched notes like any other edit.)
 *
 * Each manifest is parsed once and kept until its size or mtime changes, so a Today request only
 * lists the folder and stats its files.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { toLocalDate } from '../lib/local-date.js';
import type { VaultPath } from '../vault/vault-types.js';

interface FinishedRun {
  /** Local day the run succeeded. */
  day: string;
  outputs: VaultPath[];
}

interface CachedManifest {
  size: number;
  mtimeMs: number;
  runs: FinishedRun[];
}

/** Per ingest folder (one per vault opened in this process). */
const caches = new Map<string, Map<string, CachedManifest>>();

function finishedRuns(text: string): FinishedRun[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const runs = (parsed as { runs?: unknown } | null)?.runs;
  if (!Array.isArray(runs)) return [];
  const out: FinishedRun[] = [];
  for (const run of runs as Record<string, unknown>[]) {
    if (run?.status !== 'succeeded' || typeof run.finishedAt !== 'string') continue;
    const finished = new Date(run.finishedAt);
    if (Number.isNaN(finished.getTime()) || !Array.isArray(run.outputs)) continue;
    const outputs = run.outputs.filter((output): output is string => typeof output === 'string');
    out.push({ day: toLocalDate(finished), outputs });
  }
  return out;
}

async function manifestNames(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((name) => name.endsWith('.json'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function readManifest(
  file: string,
  cached: CachedManifest | undefined,
): Promise<CachedManifest | null> {
  try {
    const info = await stat(file);
    if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) return cached;
    return {
      size: info.size,
      mtimeMs: info.mtimeMs,
      runs: finishedRuns(await readFile(file, 'utf8')),
    };
  } catch {
    // Being replaced right now (atomic rename) or unreadable: the next request reads it.
    return cached ?? null;
  }
}

/** Unique vault paths written by AI ingest runs that succeeded on `day`, sorted. */
export async function aiTouchedPagesOn(ingestDir: string, day: string): Promise<VaultPath[]> {
  const names = await manifestNames(ingestDir);
  const before = caches.get(ingestDir) ?? new Map<string, CachedManifest>();
  const after = new Map<string, CachedManifest>();
  await Promise.all(
    names.map(async (name) => {
      const manifest = await readManifest(path.join(ingestDir, name), before.get(name));
      if (manifest) after.set(name, manifest);
    }),
  );
  caches.set(ingestDir, after);
  const pages = new Set<VaultPath>();
  for (const manifest of after.values()) {
    for (const run of manifest.runs) {
      if (run.day === day) for (const output of run.outputs) pages.add(output.normalize('NFC'));
    }
  }
  return [...pages].sort();
}
