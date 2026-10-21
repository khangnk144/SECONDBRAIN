/**
 * Finds the cached text of a file, extracting it when the cache has nothing for the file's
 * current bytes. Hashes are remembered per path with size and mtime (`index.json`), so an
 * unchanged file is never read again just to learn its hash.
 */
import { guardVaultPath } from '../security/path-guard.js';
import {
  VaultError,
  type FileStat,
  type VaultPath,
  type VaultService,
} from '../vault/vault-types.js';
import { ExtractionLane } from './extraction-lane.js';
import type { PdfExtractor } from './pdf-worker-extractor.js';
import {
  sha256OfFile,
  cacheFileExists,
  readCachedText,
  writeCachedText,
  type CachedSourceText,
} from './source-cache.js';
import { extractSourceText, unreadableText, type ExtractionLimits } from './source-extraction.js';
import { sourceFormatOf, type SourceFormat } from './source-formats.js';
import type { SourcePathIndex } from './source-path-index.js';

export interface LocatedFile {
  stat: FileStat;
  format: SourceFormat | null;
}

export interface ResolvedText {
  path: VaultPath;
  format: SourceFormat;
  contentHash: string;
  entry: CachedSourceText;
  /** True when this call ran the extraction (not a cache hit). */
  extracted: boolean;
}

export type TextSummary = Pick<CachedSourceText, 'quality' | 'reason' | 'pageCount'>;

const summarize = ({ quality, reason, pageCount }: CachedSourceText): TextSummary => ({
  quality,
  reason,
  pageCount,
});

export class SourcesClosedError extends Error {
  constructor() {
    super('The sources service is closed.');
    this.name = 'SourcesClosedError';
  }
}

export interface SourceStoreDeps {
  vault: VaultService;
  /** `<vault>/.secondbrain/cache/sources` */
  dir: string;
  paths: SourcePathIndex;
  extractor: PdfExtractor;
  limits: ExtractionLimits;
}

export class SourceStore {
  private readonly lane = new ExtractionLane<CachedSourceText>();
  private readonly summaries = new Map<string, TextSummary>();
  private closed = false;

  constructor(private readonly deps: SourceStoreDeps) {}

  get paths(): SourcePathIndex {
    return this.deps.paths;
  }

  /** Guarded, canonical location of an existing file (NOT_FOUND / INVALID_PATH otherwise). */
  async locate(input: VaultPath): Promise<LocatedFile> {
    const stat = await this.deps.vault.stat(guardVaultPath(input));
    if (!stat) throw new VaultError('NOT_FOUND', 'File not found', { path: input });
    return { stat, format: sourceFormatOf(stat.path) };
  }

  /** SHA-256 of a file too large to load, streamed from its guarded disk path. */
  async hashLargeFile(path: VaultPath): Promise<string> {
    return sha256OfFile(await this.deps.vault.resolveExisting(path));
  }

  /** Current hash without extracting (reads the file only when size or mtime changed). */
  async hashOf(stat: FileStat): Promise<string> {
    const known = this.paths.knownHash(stat);
    if (known) return known;
    const contentHash =
      stat.size > this.deps.limits.maxFileBytes
        ? await this.hashLargeFile(stat.path)
        : (await this.deps.vault.readBytes(stat.path)).revision;
    this.paths.learn(stat, contentHash);
    return contentHash;
  }

  async cached(contentHash: string): Promise<CachedSourceText | null> {
    const entry = await readCachedText(this.deps.dir, contentHash);
    if (entry) this.summaries.set(contentHash, summarize(entry));
    else this.summaries.delete(contentHash);
    return entry;
  }

  /** Quality and page count of a cached text without parsing it again (null = not cached). */
  async summary(contentHash: string): Promise<TextSummary | null> {
    const memo = this.summaries.get(contentHash);
    if (memo && (await cacheFileExists(this.deps.dir, contentHash))) return memo;
    const entry = await this.cached(contentHash);
    return entry ? summarize(entry) : null;
  }

  /**
   * Text of a supported file: from the cache when it has the current bytes, else extracted now.
   * `priority` puts the extraction before every background one (someone waits for it).
   */
  async resolve(located: LocatedFile, priority: boolean): Promise<ResolvedText> {
    const { stat, format } = located;
    if (format === null) throw new Error('Unsupported source format.');
    const path = stat.path;
    const knownHash = this.paths.knownHash(stat);
    if (knownHash) {
      const entry = await this.cached(knownHash);
      if (entry) return { path, format, contentHash: knownHash, entry, extracted: false };
    }
    const tooLarge = stat.size > this.deps.limits.maxFileBytes;
    const read = tooLarge ? null : await this.deps.vault.readBytes(path);
    const contentHash = read?.revision ?? knownHash ?? (await this.hashLargeFile(path));
    const current = read ? { path, size: read.size, mtimeMs: read.mtimeMs } : stat;
    let entry = contentHash === knownHash ? null : await this.cached(contentHash);
    let extracted = false;
    if (!entry) {
      entry = await this.lane.run(
        contentHash,
        async () => {
          const result = read
            ? await extractSourceText(format, read.bytes, this.deps.extractor, this.deps.limits)
            : unreadableText('too-large');
          // Closing mid-extraction aborts the worker: that outcome is not the file's fault.
          if (this.closed) throw new SourcesClosedError();
          await writeCachedText(this.deps.dir, contentHash, result);
          this.summaries.set(contentHash, summarize(result));
          return result;
        },
        priority,
      );
      extracted = true;
    }
    this.paths.record(current, contentHash, extracted);
    return { path, format, contentHash, entry, extracted };
  }

  async close(): Promise<void> {
    this.closed = true;
    const lane = this.lane.close();
    await this.deps.extractor.close();
    await lane;
    await this.paths.flushed();
  }
}
