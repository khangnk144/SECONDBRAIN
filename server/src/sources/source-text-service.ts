/**
 * `SourceTextService` over the store (SPEC F30, F32 `read_source` / `list_sources`). Every method
 * guards its path; nothing here writes the vault (only the derived cache).
 */
import { classifyPath } from '../markdown/content-classes.js';
import { guardVaultPath } from '../security/path-guard.js';
import type { FileStat, VaultPath, VaultService } from '../vault/vault-types.js';
import { fileStem, sourceFormatOf } from './source-formats.js';
import { sourceIdForPath } from './source-quality.js';
import type { ResolvedText, SourceStore } from './source-store.js';
import type {
  SourcePage,
  SourceReadOptions,
  SourceStatus,
  SourceText,
  SourceTextService,
} from './source-types.js';

export interface SourceTextServiceDeps {
  vault: VaultService;
  store: SourceStore;
  /** Called after every resolve of a supported file (index push, broadcast); never rejects. */
  onResolved: (resolved: ResolvedText) => Promise<void>;
  close: () => Promise<void>;
}

/** Clamps a 1-based inclusive range into `[1, pageCount]`. */
function pageRange(pages: readonly string[], options: SourceReadOptions): SourcePage[] {
  const count = pages.length;
  if (count === 0) return [];
  const clamp = (n: number | undefined, fallback: number) =>
    Math.min(Math.max(Math.trunc(Number.isFinite(n) ? n! : fallback), 1), count);
  const from = clamp(options.fromPage, 1);
  const to = clamp(options.toPage, count);
  const out: SourcePage[] = [];
  for (let page = from; page <= to; page += 1) out.push({ page, text: pages[page - 1]! });
  return out;
}

export function createSourceTextService(deps: SourceTextServiceDeps): SourceTextService {
  const { store } = deps;

  async function statusOf(stat: FileStat): Promise<SourceStatus | null> {
    if (sourceFormatOf(stat.path) === null) return null;
    const contentHash = await store.hashOf(stat);
    const summary = await store.summary(contentHash);
    return {
      path: stat.path,
      sourceId: sourceIdForPath(stat.path),
      contentHash,
      quality: summary?.quality ?? 'pending',
      pageCount: summary?.pageCount ?? null,
      reason: summary?.reason ?? null,
    };
  }

  return {
    async read(path: VaultPath, options: SourceReadOptions = {}): Promise<SourceText> {
      const located = await store.locate(path);
      const { stat, format } = located;
      const base = { path: stat.path, sourceId: sourceIdForPath(stat.path) };
      if (format === null) {
        const contentHash = await store.hashLargeFile(stat.path);
        return {
          ...base,
          contentHash,
          title: fileStem(stat.path),
          pageCount: 0,
          pages: [],
          extractionQuality: 'none',
          reason: 'unsupported-type',
        };
      }
      const resolved = await store.resolve(located, true);
      void deps.onResolved(resolved);
      const { entry } = resolved;
      return {
        ...base,
        contentHash: resolved.contentHash,
        title: entry.title ?? fileStem(stat.path),
        pageCount: entry.pageCount,
        pages: pageRange(entry.pages, options),
        extractionQuality: entry.quality,
        reason: entry.reason,
      };
    },

    async status(path: VaultPath): Promise<SourceStatus | null> {
      const guarded = guardVaultPath(path);
      if (sourceFormatOf(guarded) === null) return null;
      const stat = await deps.vault.stat(guarded);
      return stat ? statusOf(stat) : null;
    },

    async listSources(): Promise<SourceStatus[]> {
      const { files } = await deps.vault.list();
      const out: SourceStatus[] = [];
      for (const file of files) {
        if (classifyPath(file.path) !== 'source') continue;
        const status = await statusOf(file);
        if (status) out.push(status);
      }
      return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    },

    sourceIdOf: (path: VaultPath) => sourceIdForPath(guardVaultPath(path)),

    close: deps.close,
  };
}
