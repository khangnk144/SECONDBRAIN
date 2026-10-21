/**
 * Which files have extractable text (SPEC F30, F32 `read_source`) and which of them the
 * background extraction looks at. Raw sources live in `3 Resources/`; PDFs anywhere may be cited
 * (attachments), so every PDF is extracted too, even where search does not show it (§4.2).
 */
import { classifyPath } from '../markdown/content-classes.js';
import type { VaultPath } from '../vault/vault-types.js';

export type SourceFormat = 'pdf' | 'text' | 'html';

const FORMATS: Record<string, SourceFormat> = {
  pdf: 'pdf',
  md: 'text',
  txt: 'text',
  html: 'html',
  htm: 'html',
};

/** Format by extension (any case), or null for files without text we can read. */
export function sourceFormatOf(path: VaultPath): SourceFormat | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return FORMATS[name.slice(dot + 1).toLowerCase()] ?? null;
}

/** Extracted ahead of time: every supported file under `3 Resources/`, every PDF anywhere. */
export function isBackgroundSource(path: VaultPath): boolean {
  const format = sourceFormatOf(path);
  if (format === null) return false;
  return format === 'pdf' || classifyPath(path) === 'source';
}

/** File name without its extension (the fallback title). */
export function fileStem(path: VaultPath): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}
