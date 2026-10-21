/**
 * Per-vault text extraction of raw sources and PDFs (SPEC F30, F32): a vault plugin that keeps
 * `.secondbrain/cache/sources/` up to date in the background, one file at a time, and hands PDF
 * page text to the index so PDFs are searchable. Started first, so the other plugins can use it.
 * Logs carry codes and counts only, never file names or text.
 */
import { errorCodeOf } from '../app-context/app-context-errors.js';
import {
  SOURCES_PLUGIN,
  type VaultPlugin,
  type VaultPluginHost,
} from '../app-context/vault-plugins.js';
import { CLASS_RULES, classifyPath } from '../markdown/content-classes.js';
import { isVaultError, type VaultPath } from '../vault/vault-types.js';
import type { ServerEvent } from '../ws/server-events.js';
import { BackgroundQueue } from './background-queue.js';
import { DebounceTimers } from './debounce-timers.js';
import { LaneClosedError } from './extraction-lane.js';
import { createWorkerPdfExtractor, type PdfExtractor } from './pdf-worker-extractor.js';
import { indexablePages, pruneCachedTexts, readPathIndex, sourceCacheDir } from './source-cache.js';
import { DEFAULT_EXTRACTION_LIMITS, type ExtractionLimits } from './source-extraction.js';
import { isBackgroundSource } from './source-formats.js';
import { SourcePathIndex } from './source-path-index.js';
import { SourcesClosedError, SourceStore, type ResolvedText } from './source-store.js';
import { createSourceTextService } from './source-text-service.js';
import type { SourceTextService } from './source-types.js';

export interface SourcesPluginOptions {
  /** PDF extractor (tests inject a fake); default: the worker-thread extractor. */
  extractor?: PdfExtractor;
  /** File, page, character and time caps (defaults: 50 MB, 500 pages, 100,000 chars, 60 s). */
  limits?: Partial<ExtractionLimits>;
  /** Quiet time after a file event before the file is queued (default 2 s). */
  debounceMs?: number;
}

const DEBOUNCE_MS = 2000;

/** PDFs whose pages the index keeps (searchable classes, i.e. `3 Resources`; SPEC §4.2). */
const indexedInSearch = (path: VaultPath) => CLASS_RULES[classifyPath(path)].searchable;

const isQuietError = (error: unknown) =>
  error instanceof SourcesClosedError ||
  error instanceof LaneClosedError ||
  (isVaultError(error) && (error.code === 'NOT_FOUND' || error.code === 'INVALID_PATH'));

/** The plugin instance: the service plus `idle()` (background work and cache writes done). */
export type SourcesPluginService = SourceTextService & { idle(): Promise<void> };

async function startSources(
  host: VaultPluginHost,
  options: SourcesPluginOptions,
): Promise<SourcesPluginService> {
  const { context, logger } = host;
  const dir = sourceCacheDir(context.vault.paths.cacheDir);
  const paths = new SourcePathIndex(dir, await readPathIndex(dir), (error) =>
    logger.warn(`Sources: saving the text cache index failed (${errorCodeOf(error)}).`),
  );
  const store = new SourceStore({
    vault: context.vault,
    dir,
    paths,
    extractor: options.extractor ?? createWorkerPdfExtractor(),
    limits: { ...DEFAULT_EXTRACTION_LIMITS, ...options.limits },
  });
  let closed = false;
  let extractedCount = 0;

  /**
   * Hands PDF page text to the index, then tells clients (so a refresh finds it searchable).
   * Callers waiting for text (`read`) do not wait for this: the index may be mid-rebuild.
   */
  function onResolved(resolved: ResolvedText): Promise<void> {
    const indexed =
      resolved.format === 'pdf' && indexedInSearch(resolved.path)
        ? context.index.setSourceText(
            resolved.path,
            resolved.contentHash,
            indexablePages(resolved.entry),
          )
        : Promise.resolve();
    return indexed.then(
      () => {
        if (!resolved.extracted || closed) return;
        extractedCount += 1;
        context.hub.broadcast({
          type: 'source:extracted',
          path: resolved.path,
          quality: resolved.entry.quality,
        });
      },
      (error: unknown) =>
        logger.warn(`Sources: updating the search index failed (${errorCodeOf(error)}).`),
    );
  }

  /** Checks one file; extracts only when the cache or the index lacks its current content. */
  async function processPath(path: VaultPath): Promise<void> {
    const located = await store.locate(path);
    if (located.format === null || !isBackgroundSource(located.stat.path)) return;
    const known = paths.knownHash(located.stat);
    if (known && (await store.summary(known))) {
      const needsIndex = located.format === 'pdf' && indexedInSearch(located.stat.path);
      if (!needsIndex || context.index.sourceTextHash(located.stat.path) === known) return;
    }
    await onResolved(await store.resolve(located, false));
  }

  const queue = new BackgroundQueue(processPath, (error) => {
    if (!isQuietError(error))
      logger.warn(`Sources: background extraction failed (${errorCodeOf(error)}).`);
  });

  /** Every background source of the vault, then the cache cleanup once they are all known. */
  async function rescan(prune: boolean): Promise<void> {
    const { files } = await context.vault.list();
    const present = new Set(files.map((file) => file.path));
    paths.forget([...paths.entries.keys()].filter((known) => !present.has(known)));
    for (const file of files) if (isBackgroundSource(file.path)) queue.addPath(file.path);
    if (!prune) return;
    queue.addTask(async () => {
      const removed = await pruneCachedTexts(dir, paths.hashes());
      logger.info(
        `Sources: start-up check done; ${extractedCount} extracted, ${removed} stale cache entries removed.`,
      );
    });
  }

  const timers = new DebounceTimers(options.debounceMs ?? DEBOUNCE_MS);
  const later = (key: string, action: () => void) =>
    timers.later(key, () => (closed ? undefined : action()));
  const schedule = (path: VaultPath) => later(`path:${path}`, () => queue.addPath(path));
  function forget(path: VaultPath): void {
    timers.cancel(`path:${path}`);
    queue.drop(path);
  }

  function onEvent(event: ServerEvent): void {
    if (closed) return;
    switch (event.type) {
      case 'note:created':
      case 'note:changed':
        if (isBackgroundSource(event.path)) schedule(event.path);
        return;
      case 'note:renamed':
        forget(event.oldPath);
        paths.move(event.oldPath, event.path);
        if (isBackgroundSource(event.path)) schedule(event.path);
        return;
      case 'note:deleted':
        forget(event.path);
        paths.forget([event.path]);
        return;
      case 'folder:changed':
        // A folder moved or deleted outside the app may not report every file inside.
        later('rescan', () => void rescan(false).catch(queueError));
        return;
      case 'index:progress':
        // A rebuild or re-scan finished: refill whatever the new index lacks.
        if (event.phase === 'done') later('rescan', () => void rescan(false).catch(queueError));
        return;
      default:
        return;
    }
  }
  const queueError = (error: unknown) =>
    logger.warn(`Sources: listing the vault failed (${errorCodeOf(error)}).`);
  const unsubscribe = context.onEvent(onEvent);
  const firstScan = rescan(true).catch(queueError);

  const service = createSourceTextService({
    vault: context.vault,
    store,
    onResolved,
    async close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      timers.clear();
      const pending = queue.close();
      await store.close();
      await pending;
    },
  });
  const idle = async () => {
    await firstScan;
    await queue.idle();
    // An index rebuild reads `index.json` to refill PDF text: it must be on disk.
    await paths.flushed();
  };
  return Object.assign(service, { idle });
}

/** The plugin `createSourcesPlugin()`; the host attaches it as `SOURCES_PLUGIN`. */
export function createSourcesPlugin(
  options: SourcesPluginOptions = {},
): VaultPlugin<SourcesPluginService> {
  return { name: SOURCES_PLUGIN, start: (host) => startSources(host, options) };
}
