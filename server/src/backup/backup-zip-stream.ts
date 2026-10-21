import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import type { BackupEntry } from './backup-file-list.js';

/** Formats that are compressed already: deflating them again costs time and saves nothing. */
const STORED_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'heic',
  'ico',
  'mp3',
  'm4a',
  'aac',
  'ogg',
  'opus',
  'flac',
  'mp4',
  'm4v',
  'mov',
  'webm',
  'mkv',
  'avi',
  'zip',
  'gz',
  'tgz',
  'bz2',
  'xz',
  '7z',
  'rar',
  'zst',
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'odt',
  'ods',
  'odp',
  'epub',
  'woff',
  'woff2',
]);

const CHUNK_BYTES = 256 * 1024;
// The DOS time in a zip header covers 1980–2107; fflate accepts 1980–2099.
const OLDEST_MTIME = new Date(1980, 0, 2).getTime();
const NEWEST_MTIME = new Date(2099, 11, 30).getTime();

function isStored(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot > name.lastIndexOf('/') && STORED_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

const clampMtime = (ms: number) => Math.min(Math.max(ms, OLDEST_MTIME), NEWEST_MTIME);

/** Opens without following a link that replaced the file since it was listed (where supported). */
async function openForReading(abs: string): Promise<FileHandle | null> {
  try {
    return await open(abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch {
    return null; // removed or locked since the listing: left out
  }
}

async function* zipChunks(
  entries: readonly BackupEntry[],
  onSkipped: () => void,
): AsyncGenerator<Uint8Array> {
  const pending: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else pending.push(chunk);
  });
  // fflate calls back synchronously; hand over what it produced before reading more input.
  function* flush(): Generator<Uint8Array> {
    if (failure) throw failure;
    while (pending.length > 0) yield pending.shift()!;
  }

  for (const entry of entries) {
    if (entry.kind === 'dir') {
      const folder = new ZipPassThrough(`${entry.name}/`);
      folder.mtime = clampMtime(entry.mtimeMs);
      zip.add(folder);
      folder.push(new Uint8Array(0), true);
      yield* flush();
      continue;
    }
    const handle = await openForReading(entry.abs);
    if (!handle) {
      onSkipped();
      continue;
    }
    try {
      const file = isStored(entry.name)
        ? new ZipPassThrough(entry.name)
        : new ZipDeflate(entry.name, { level: 6 });
      file.mtime = clampMtime(entry.mtimeMs);
      zip.add(file);
      for (;;) {
        // A fresh buffer each time: pass-through entries hand this very chunk to the response.
        const { bytesRead, buffer } = await handle.read(
          Buffer.allocUnsafe(CHUNK_BYTES),
          0,
          CHUNK_BYTES,
          null,
        );
        if (bytesRead === 0) break;
        file.push(buffer.subarray(0, bytesRead), false);
        yield* flush();
      }
      file.push(new Uint8Array(0), true);
      yield* flush();
    } finally {
      await handle.close();
    }
  }
  zip.end();
  yield* flush();
}

/**
 * The backup zip as a stream, one file at a time (never the whole vault in memory). Entry names
 * are UTF-8 with the language-encoding flag (fflate sets it for every non-ASCII name).
 */
export function createBackupZipStream(
  entries: readonly BackupEntry[],
  onSkipped: () => void = () => {},
): Readable {
  return Readable.from(zipChunks(entries, onSkipped), { objectMode: false });
}
