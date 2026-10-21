/**
 * "Xuất bản sao lưu…" and "Khôi phục thử…" (SPEC F18.5), mirrored from
 * `server/src/api/backup-routes.ts`. Both go through the API client's raw requests, so they carry
 * the token and vault id like every other call.
 */
import { api } from '../api';

export interface BackupDownload {
  blob: Blob;
  /** From `Content-Disposition` (UTF-8 form first). */
  fileName: string;
  /** Files or folders the server could not read; they are not in the zip. */
  unreadable: number;
}

const FALLBACK_NAME = 'second-brain-sao-luu.zip';

/** The download name the server chose: `filename*=UTF-8''…` wins over `filename="…"`. */
export function fileNameFromDisposition(header: string | null): string {
  if (!header) return FALLBACK_NAME;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim());
    } catch {
      // A malformed escape: fall back to the plain form.
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header)?.[1];
  return plain ?? FALLBACK_NAME;
}

export async function exportBackup(): Promise<BackupDownload> {
  const response = await api().raw('/backup/export', { method: 'POST' });
  const unreadable = Number(response.headers.get('x-sb-backup-unreadable') ?? '0');
  return {
    blob: await response.blob(),
    fileName: fileNameFromDisposition(response.headers.get('content-disposition')),
    unreadable: Number.isFinite(unreadable) && unreadable > 0 ? unreadable : 0,
  };
}

export interface RestoreResult {
  /** Absolute folder the backup was restored into. */
  path: string;
  /** The restored copy's own new vault id (a restore is a separate vault with its own tabs and drafts). */
  vaultId: string | null;
}

/**
 * Restores `file` into the empty folder `target` (absolute) and, with `open`, opens it as the
 * vault. The server reads the fields before the file, so they go first.
 */
export async function restoreBackup(
  file: File,
  target: string,
  options: { open?: boolean } = {},
): Promise<RestoreResult> {
  const form = new FormData();
  form.append('target', target);
  form.append('open', options.open === false ? 'false' : 'true');
  form.append('file', file, file.name);
  const response = await api().raw('/backup/restore', { method: 'POST', body: form });
  return (await response.json()) as RestoreResult;
}
