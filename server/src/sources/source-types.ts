/**
 * Contract of the source-text service (SPEC F30, F32 `read_source`): the text of raw sources and
 * attachments (PDF page by page, `.md`/`.html`/`.txt` as one page) with an extraction-quality
 * flag. Extracted text is derived data cached under `.secondbrain/cache/sources/` (deletable).
 * Written by the lead before M6; PX implements it, MC (MCP) and AQ (AI retrieval) use it.
 */
import type { VaultPath } from '../vault/vault-types.js';

/**
 * `ok`: every page (or nearly) has text; `low`: some pages have little or no text (partly
 * scanned, odd encoding); `none`: no usable text (scanned, blank, encrypted, unreadable).
 */
export type ExtractionQuality = 'ok' | 'low' | 'none';

/** Why the quality is `low`/`none` (codes, never file content). */
export type ExtractionReason =
  | 'no-text'
  | 'sparse-text'
  | 'encrypted'
  | 'damaged'
  | 'too-large'
  | 'unsupported-type'
  | 'timeout';

export interface SourcePage {
  /** 1-based page number (`1` for single-page text formats). */
  page: number;
  /** Extracted text of the page, whitespace normalized, original diacritics (NFC). */
  text: string;
}

export interface SourceText {
  path: VaultPath;
  /** Stable id of the source for the ingest manifest: `src_` + 16 hex of sha256(NFC lower path). */
  sourceId: string;
  /** SHA-256 hex of the file bytes (= the note revision for text files). */
  contentHash: string;
  /** Title from PDF metadata when present and sensible, else the file name without extension. */
  title: string;
  pageCount: number;
  /** The requested pages only (all pages when no range was asked). */
  pages: SourcePage[];
  extractionQuality: ExtractionQuality;
  reason: ExtractionReason | null;
}

export interface SourceStatus {
  path: VaultPath;
  sourceId: string;
  contentHash: string;
  /** `pending` until the background extraction of this exact content has run. */
  quality: ExtractionQuality | 'pending';
  pageCount: number | null;
  /**
   * Why the quality is `low`/`none` (null when `ok` or `pending`). Always set by the sources
   * plugin; optional only so hand-written test doubles of older shape still compile.
   */
  reason?: ExtractionReason | null;
}

export interface SourceReadOptions {
  /** Inclusive 1-based page range; out-of-range values are clamped. */
  fromPage?: number;
  toPage?: number;
}

/** Per-vault plugin `SOURCES_PLUGIN`. Every method guards the path and never writes the vault. */
export interface SourceTextService {
  /**
   * Text of one file (extracting now if the cache has no entry for its current hash). Throws
   * VaultError NOT_FOUND / INVALID_PATH; a file that cannot be read as text returns quality
   * `none` with a reason instead of throwing.
   */
  read(path: VaultPath, options?: SourceReadOptions): Promise<SourceText>;
  /** Cached status without extracting (null for a path that is not a file of a supported type). */
  status(path: VaultPath): Promise<SourceStatus | null>;
  /** Every supported file under `3 Resources/` with its status, sorted by path. */
  listSources(): Promise<SourceStatus[]>;
  /** Stable id for a path (same function as `SourceText.sourceId`). */
  sourceIdOf(path: VaultPath): string;
  close(): Promise<void>;
}
