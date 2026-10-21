import { createWriteStream } from 'node:fs';
import { mkdir, open, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crc32, createInflateRaw } from 'node:zlib';
import { BackupRefusedError, refuse } from './backup-errors.js';
import { readAt, readZipDirectory, type ZipEntryRecord } from './zip-central-directory.js';
import { safeEntrySegments } from './zip-entry-names.js';

export interface ExtractLimits {
  /** Total uncompressed bytes (declared and actually written). */
  maxBytes: number;
  maxEntries: number;
}

/** Zip-bomb guard of a restore (SPEC F18.5): 4 GB uncompressed or 200,000 entries. */
export const RESTORE_LIMITS: ExtractLimits = { maxBytes: 4 * 1024 ** 3, maxEntries: 200_000 };

const LOCAL_HEADER = 0x04034b50;
const READ_CHUNK = 256 * 1024;

/** The compressed bytes of one entry, read from the shared handle (no stream per entry). */
async function* readRange(
  handle: FileHandle,
  start: number,
  length: number,
): AsyncGenerator<Buffer> {
  let position = start;
  let remaining = length;
  while (remaining > 0) {
    const size = Math.min(READ_CHUNK, remaining);
    const { bytesRead, buffer } = await handle.read(Buffer.allocUnsafe(size), 0, size, position);
    if (bytesRead === 0) throw refuse('bad-archive');
    position += bytesRead;
    remaining -= bytesRead;
    yield buffer.subarray(0, bytesRead);
  }
}

function mapExtractError(error: unknown): unknown {
  if (error instanceof BackupRefusedError) return error;
  const code = String((error as NodeJS.ErrnoException | null)?.code ?? '');
  // Two entries that land on one file (case or a file/folder clash on this file system).
  if (code === 'EEXIST') return refuse('unsafe-entry');
  if (code === 'ENOTDIR' || code === 'EISDIR') return refuse('bad-archive');
  // zlib (corrupt deflate data) and streams cut short.
  if (code.startsWith('Z_') || code === 'ERR_STREAM_PREMATURE_CLOSE') return refuse('bad-archive');
  return error;
}

async function extractFile(
  handle: FileHandle,
  fileSize: number,
  entry: ZipEntryRecord,
  target: string,
  budget: { remaining: number },
): Promise<void> {
  const header = await readAt(handle, entry.localHeaderOffset, 30);
  if (header.readUInt32LE(0) !== LOCAL_HEADER) throw refuse('bad-archive');
  const start = entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  if (start + entry.compressedSize > fileSize) throw refuse('bad-archive');

  let written = 0;
  let crc = 0;
  const limit = Math.min(entry.uncompressedSize, budget.remaining);
  // Declared sizes are not trusted: the output is counted while it is produced.
  const check = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      written += chunk.length;
      if (written > limit) {
        callback(refuse(written > budget.remaining ? 'too-large' : 'bad-archive'));
        return;
      }
      crc = crc32(chunk, crc);
      callback(null, chunk);
    },
  });
  const source = Readable.from(readRange(handle, start, entry.compressedSize));
  const sink = createWriteStream(target, { flags: 'wx' });
  if (entry.method === 8) await pipeline(source, createInflateRaw(), check, sink);
  else await pipeline(source, check, sink);
  if (written !== entry.uncompressedSize || crc !== entry.crc32) throw refuse('bad-archive');
  budget.remaining -= written;
}

/**
 * Extracts `zipFile` into the (new, empty) folder `destDir`. Every name is checked and the
 * totals are capped before anything is written; then each entry is streamed, its size and CRC
 * verified. Throws `BackupRefusedError` for anything unsafe or broken; the caller removes
 * `destDir` (it is the app's own temp folder).
 */
export async function extractZipArchive(
  zipFile: string,
  destDir: string,
  limits: ExtractLimits = RESTORE_LIMITS,
): Promise<{ files: number; bytes: number }> {
  const handle = await open(zipFile, 'r');
  try {
    const { size } = await handle.stat();
    const entries = await readZipDirectory(handle, size, limits.maxEntries);
    const seen = new Set<string>();
    let declared = 0;
    const plan = entries.map((entry) => {
      const segments = safeEntrySegments(entry.name);
      if (!segments) throw refuse('unsafe-entry');
      const key = segments.join('/');
      if (seen.has(key)) throw refuse('unsafe-entry');
      seen.add(key);
      declared += entry.uncompressedSize;
      if (declared > limits.maxBytes) throw refuse('too-large');
      return { entry, target: path.join(destDir, ...segments) };
    });
    const budget = { remaining: limits.maxBytes };
    let files = 0;
    for (const { entry, target } of plan) {
      try {
        if (entry.isDirectory) {
          await mkdir(target, { recursive: true });
          continue;
        }
        await mkdir(path.dirname(target), { recursive: true });
        await extractFile(handle, size, entry, target, budget);
        files += 1;
      } catch (error) {
        throw mapExtractError(error);
      }
    }
    return { files, bytes: limits.maxBytes - budget.remaining };
  } finally {
    await handle.close();
  }
}
