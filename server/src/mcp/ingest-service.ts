import { toLocalDate } from '../lib/local-date.js';
import { guardVaultPath } from '../security/path-guard.js';
import type { SourceText } from '../sources/source-types.js';
import { createUlidGenerator } from '../vault/ulid.js';
import { isVaultError, type VaultPath } from '../vault/vault-types.js';
import {
  checkSourceId,
  failStaleRuns,
  latestSucceeded,
  manifestFile,
  pruneRuns,
  readManifest,
  runIdFor,
  sourceIdOfRun,
  writeManifest,
  type IngestManifest,
  type IngestRun,
} from './ingest-manifest.js';
import { assertRealPath } from './linked-path-guard.js';
import { sourceService, type McpDeps } from './mcp-deps.js';
import { McpToolError } from './mcp-tool-result.js';
import { appendWikiLogLine, oneLine, WIKI_LOG_PATH } from './wiki-files.js';

const unique = (paths: VaultPath[]) => [...new Set(paths)];
const isWikiMarkdown = (path: VaultPath) => /^wiki\/.+\.md$/i.test(path.normalize('NFC'));

function lockKey(deps: McpDeps, sourceId: string): string {
  return manifestFile(deps.context.vault.paths.ingestDir, sourceId);
}

/** Current text of the source (first page only: the hash, title and quality are what count). */
async function currentText(deps: McpDeps, path: VaultPath): Promise<SourceText | null> {
  try {
    return await sourceService(deps).read(path, { fromPage: 1, toPage: 1 });
  } catch (error) {
    if (isVaultError(error) && error.code === 'NOT_FOUND') return null;
    throw error;
  }
}

async function finishRun(deps: McpDeps, manifest: IngestManifest, run: IngestRun, reason: string) {
  Object.assign(run, { status: 'failed', finishedAt: deps.context.now().toISOString(), reason });
  await writeManifest(deps.context.vault.paths.ingestDir, manifest);
}

/** `ingest_begin`: refuses a running run (CONFLICT) and an already ingested hash (EXISTS). */
export async function ingestBegin(deps: McpDeps, input: string, force: boolean) {
  const sourceId = checkSourceId(input);
  const service = sourceService(deps);
  const listed = (await service.listSources()).find((source) => source.sourceId === sourceId);
  if (!listed) {
    throw new McpToolError('NOT_FOUND', 'No source with this id; call list_sources.', { sourceId });
  }
  const dir = deps.context.vault.paths.ingestDir;
  return deps.locks.run(lockKey(deps, sourceId), async () => {
    const text = await service.read(listed.path, { fromPage: 1, toPage: 1 });
    const now = deps.context.now();
    const manifest: IngestManifest = (await readManifest(dir, sourceId, true)) ?? {
      version: 1,
      sourceId,
      path: text.path,
      runs: [],
    };
    manifest.path = text.path;
    const swept = failStaleRuns(manifest, now);
    const running = manifest.runs.find((run) => run.status === 'running');
    const done = latestSucceeded(manifest.runs);
    let refusal: McpToolError | null = null;
    if (running) {
      refusal = new McpToolError(
        'CONFLICT',
        'An ingest of this source is running; finish or fail it first.',
        {
          runId: running.runId,
          reason: 'running',
        },
      );
    } else if (!force && done && done.contentHash === text.contentHash) {
      refusal = new McpToolError(
        'EXISTS',
        'This content is already ingested; pass force to ingest it again.',
        {
          runId: done.runId,
          contentHash: text.contentHash,
          reason: 'already-ingested',
        },
      );
    }
    if (refusal) {
      if (swept) await writeManifest(dir, manifest);
      throw refusal;
    }
    const run: IngestRun = {
      runId: runIdFor(sourceId, createUlidGenerator(() => now)()),
      contentHash: text.contentHash,
      startedAt: now.toISOString(),
      finishedAt: null,
      status: 'running',
      outputs: [],
      logLine: null,
      reason: null,
    };
    manifest.runs = pruneRuns([...manifest.runs, run]);
    await writeManifest(dir, manifest);
    const { path, title, contentHash, extractionQuality } = text;
    return { runId: run.runId, source: { path, title, contentHash, extractionQuality } };
  });
}

const completed = (manifest: IngestManifest, run: IngestRun) => ({
  runId: run.runId,
  status: run.status,
  source: manifest.path,
  outputs: run.outputs,
  logLine: run.logLine,
});

/** Whether the last non-empty line of `wiki/log.md` is `line`. */
async function logEndsWith(deps: McpDeps, line: string): Promise<boolean> {
  try {
    const { content } = await deps.context.vault.read(WIKI_LOG_PATH);
    const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');
    return lines.at(-1) === line;
  } catch (error) {
    if (isVaultError(error) && error.code === 'NOT_FOUND') return false;
    throw error;
  }
}

async function checkOutputs(deps: McpDeps, outputs: VaultPath[]): Promise<void> {
  const notWiki = outputs.filter((path) => !isWikiMarkdown(path));
  const missing: VaultPath[] = [];
  for (const path of outputs) {
    if (isWikiMarkdown(path) && (await deps.context.vault.stat(path)) === null) missing.push(path);
  }
  if (notWiki.length > 0 || missing.length > 0) {
    throw new McpToolError('VALIDATION', 'Every output must be an existing page under wiki/.', {
      missing,
      notWiki,
    });
  }
}

/**
 * `ingest_complete`: the run must still be running and the source unchanged; a source without
 * usable text fails the run (NEEDS_REVIEW). Then the server appends the log line, marks the run
 * succeeded and tells the clients which pages it touched. A second call for a succeeded run
 * answers the same and writes nothing.
 */
export async function ingestComplete(deps: McpDeps, runId: string, inputs: string[]) {
  const sourceId = sourceIdOfRun(runId);
  const outputs = unique(inputs.map((input) => guardVaultPath(input)));
  const dir = deps.context.vault.paths.ingestDir;
  return deps.locks.run(lockKey(deps, sourceId), async () => {
    const manifest = await readManifest(dir, sourceId);
    const run = manifest?.runs.find((candidate) => candidate.runId === runId);
    if (!manifest || !run)
      throw new McpToolError('NOT_FOUND', 'No ingest run with this id.', { runId });
    if (run.status === 'succeeded') return completed(manifest, run);
    if (run.status !== 'running') {
      throw new McpToolError('CONFLICT', 'This run has ended; start a new one with ingest_begin.', {
        runId,
        status: run.status,
        reason: run.reason,
      });
    }
    const current = await currentText(deps, manifest.path);
    if (!current || current.contentHash !== run.contentHash) {
      await finishRun(deps, manifest, run, 'source-changed');
      throw new McpToolError('CONFLICT', 'The source changed during the ingest; begin again.', {
        runId,
        reason: 'source-changed',
        currentHash: current?.contentHash ?? null,
      });
    }
    if (current.extractionQuality === 'none') {
      await finishRun(deps, manifest, run, 'needs-review');
      throw new McpToolError(
        'NEEDS_REVIEW',
        'The source has no readable text; the owner must look at it.',
        {
          runId,
          reason: current.reason,
        },
      );
    }
    await checkOutputs(deps, outputs);
    await assertRealPath(deps.context.vault, WIKI_LOG_PATH);
    const now = deps.context.now();
    // The line is stored (run still running) before it is appended: a retry after a failed
    // manifest write then finds it at the end of the log and does not append it twice.
    const retry = run.logLine !== null;
    if (!retry) {
      const title = oneLine(current.title, 200) || oneLine(manifest.path);
      run.logLine = `## [${toLocalDate(now)}] ingest | ${title}`;
      await writeManifest(dir, manifest);
    }
    const logLine = run.logLine!;
    if (!(retry && (await logEndsWith(deps, logLine)))) {
      await appendWikiLogLine(deps.context.vault, logLine);
    }
    Object.assign(run, { status: 'succeeded', finishedAt: now.toISOString(), outputs, logLine });
    await writeManifest(dir, manifest);
    await deps.context.settled();
    deps.context.hub.broadcast({ type: 'ai:touched', source: manifest.path, outputs });
    return completed(manifest, run);
  });
}

/** `ingest_fail`: a running run ends as failed with the model's reason; repeating it is harmless. */
export async function ingestFail(deps: McpDeps, runId: string, input: string) {
  const sourceId = sourceIdOfRun(runId);
  const reason = oneLine(input);
  if (reason === '')
    throw new McpToolError('VALIDATION', 'Give a short reason.', { reason: 'empty' });
  const dir = deps.context.vault.paths.ingestDir;
  return deps.locks.run(lockKey(deps, sourceId), async () => {
    const manifest = await readManifest(dir, sourceId);
    const run = manifest?.runs.find((candidate) => candidate.runId === runId);
    if (!manifest || !run)
      throw new McpToolError('NOT_FOUND', 'No ingest run with this id.', { runId });
    if (run.status === 'succeeded') {
      throw new McpToolError('CONFLICT', 'This run already succeeded.', {
        runId,
        status: run.status,
      });
    }
    if (run.status === 'running') await finishRun(deps, manifest, run, reason);
    return { runId, status: run.status, reason: run.reason };
  });
}
