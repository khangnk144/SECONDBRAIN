/**
 * Derived cache of extracted text (SPEC §4.13, F30.3): `.secondbrain/cache/sources/`.
 * - `<contentHash>.json` = `{ version, pageCount, pages, quality, reason, title }`, keyed by the
 *   SHA-256 of the file bytes, so a renamed or copied file reuses it and a changed file misses it.
 * - `index.json` = path → `{ size, mtimeMs, contentHash }`: status checks skip re-hashing files
 *   whose size and mtime did not change.
 * Everything here may be deleted at any time; a missing or corrupt file just means "extract again".
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../fs/atomic-write-file.js';
import type { FileStat, VaultPath } from '../vault/vault-types.js';
import type { ExtractionQuality, ExtractionReason } from './source-types.js';

export const SOURCE_CACHE_VERSION = 1;
const INDEX_FILE = 'index.json';
const HASH = /^[0-9a-f]{64}$/;
const QUALITIES = new Set<unknown>(['ok', 'low', 'none']);

export interface CachedSourceText {
  version: typeof SOURCE_CACHE_VERSION;
  pageCount: number;
  /** Text of page i + 1 at index i. */
  pages: string[];
  quality: ExtractionQuality;
  reason: ExtractionReason | null;
  /** The document's own title (PDF metadata) when sensible; null = use the file name. */
  title: string | null;
}

export interface PathIndexEntry {
  size: number;
  mtimeMs: number;
  contentHash: string;
}

/** Pages the search index keeps for a cached text: none for an unreadable document. */
export function indexablePages(entry: CachedSourceText): string[] {
  return entry.quality === 'none' ? [] : entry.pages;
}

export const sourceCacheDir = (cacheDir: string) => path.join(cacheDir, 'sources');
const entryFile = (dir: string, hash: string) => path.join(dir, `${hash}.json`);

function isCachedText(value: unknown): value is CachedSourceText {
  const v = value as Partial<CachedSourceText> | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    v.version === SOURCE_CACHE_VERSION &&
    Array.isArray(v.pages) &&
    v.pages.every((page) => typeof page === 'string') &&
    v.pageCount === v.pages.length &&
    QUALITIES.has(v.quality) &&
    (v.reason === null || typeof v.reason === 'string') &&
    (v.title === null || typeof v.title === 'string')
  );
}

/** The cached text for `hash`, or null when missing, unreadable or not in the current format. */
export async function readCachedText(dir: string, hash: string): Promise<CachedSourceText | null> {
  if (!HASH.test(hash)) return null;
  try {
    const parsed: unknown = JSON.parse(await readFile(entryFile(dir, hash), 'utf8'));
    return isCachedText(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** SHA-256 hex of a file, streamed (files too large to load at once). */
export async function sha256OfFile(abs: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(abs)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** Cheap existence check (the cache folder may be deleted at any time). */
export async function cacheFileExists(dir: string, hash: string): Promise<boolean> {
  if (!HASH.test(hash)) return false;
  try {
    await access(entryFile(dir, hash));
    return true;
  } catch {
    return false;
  }
}

export async function writeCachedText(
  dir: string,
  hash: string,
  entry: CachedSourceText,
): Promise<void> {
  if (!HASH.test(hash)) throw new Error('Invalid content hash.');
  await mkdir(dir, { recursive: true });
  await atomicWriteFile(entryFile(dir, hash), JSON.stringify(entry));
}

function isIndexEntry(value: unknown): value is PathIndexEntry {
  const v = value as Partial<PathIndexEntry> | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.size === 'number' &&
    typeof v.mtimeMs === 'number' &&
    typeof v.contentHash === 'string' &&
    HASH.test(v.contentHash)
  );
}

/** Path → known hash; an unreadable index is treated as empty (files are hashed again). */
export async function readPathIndex(dir: string): Promise<Map<VaultPath, PathIndexEntry>> {
  const out = new Map<VaultPath, PathIndexEntry>();
  try {
    const parsed = JSON.parse(await readFile(path.join(dir, INDEX_FILE), 'utf8')) as {
      version?: unknown;
      files?: Record<string, unknown>;
    };
    if (parsed.version !== SOURCE_CACHE_VERSION || typeof parsed.files !== 'object') return out;
    for (const [file, entry] of Object.entries(parsed.files ?? {})) {
      if (isIndexEntry(entry)) out.set(file, entry);
    }
  } catch {
    // missing or corrupt: start empty
  }
  return out;
}

export async function writePathIndex(
  dir: string,
  index: ReadonlyMap<VaultPath, PathIndexEntry>,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const files = Object.fromEntries([...index].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  await atomicWriteFile(
    path.join(dir, INDEX_FILE),
    JSON.stringify({ version: SOURCE_CACHE_VERSION, files }),
  );
}

/** Deletes cached texts whose hash is not in `keep`; returns how many were removed. */
export async function pruneCachedTexts(dir: string, keep: ReadonlySet<string>): Promise<number> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    const hash = name.endsWith('.json') ? name.slice(0, -5) : '';
    if (!HASH.test(hash) || keep.has(hash)) continue;
    await rm(entryFile(dir, hash), { force: true }).then(
      () => (removed += 1),
      () => undefined,
    );
  }
  return removed;
}

/**
 * For an index rebuild: cached page text of `files` whose size and mtime still match the path
 * index (so their hash is known without reading them). Files without a usable entry are left
 * out; the sources plugin fills them in after extracting.
 */
export async function cachedTextForFiles(
  cacheDir: string,
  files: readonly FileStat[],
): Promise<Map<VaultPath, { contentHash: string; entry: CachedSourceText }>> {
  const dir = sourceCacheDir(cacheDir);
  const index = await readPathIndex(dir);
  const out = new Map<VaultPath, { contentHash: string; entry: CachedSourceText }>();
  for (const file of files) {
    const known = index.get(file.path);
    if (!known || known.size !== file.size || known.mtimeMs !== file.mtimeMs) continue;
    const entry = await readCachedText(dir, known.contentHash);
    if (entry) out.set(file.path, { contentHash: known.contentHash, entry });
  }
  return out;
}
