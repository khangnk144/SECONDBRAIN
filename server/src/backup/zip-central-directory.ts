import type { FileHandle } from 'node:fs/promises';
import { refuse } from './backup-errors.js';

/** One entry of a zip's central directory (the authoritative list; local headers are not trusted). */
export interface ZipEntryRecord {
  name: string;
  isDirectory: boolean;
  /** 0 = stored, 8 = deflate; anything else is refused. */
  method: number;
  flags: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const EOCD = 0x06054b50;
const EOCD64 = 0x06064b50;
const EOCD64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const ZIP64_EXTRA = 0x0001;
const UNICODE_PATH_EXTRA = 0x7075;
const MAX_U16 = 0xffff;
const MAX_U32 = 0xffffffff;
/** A central directory this large would describe far more than the entry cap allows. */
const MAX_DIRECTORY_BYTES = 128 * 1024 * 1024;

export async function readAt(
  handle: FileHandle,
  position: number,
  length: number,
): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) throw refuse('bad-archive');
  return buffer;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * UTF-8 names: flagged (bit 11, what this app writes), in the Info-ZIP Unicode path field, or
 * unflagged but valid UTF-8 (many tools). A legacy code page (CP437…) cannot be told apart
 * reliably, so such an archive is refused rather than restored with garbled names.
 */
function decodeName(raw: Buffer, extra: Map<number, Buffer>): string {
  const unicode = extra.get(UNICODE_PATH_EXTRA);
  try {
    if (unicode && unicode.length > 5 && unicode[0] === 1) return utf8.decode(unicode.subarray(5));
    return utf8.decode(raw);
  } catch {
    throw refuse('bad-archive');
  }
}

function parseExtra(data: Buffer): Map<number, Buffer> {
  const fields = new Map<number, Buffer>();
  for (let p = 0; p + 4 <= data.length;) {
    const id = data.readUInt16LE(p);
    const size = data.readUInt16LE(p + 2);
    if (p + 4 + size > data.length) throw refuse('bad-archive');
    fields.set(id, data.subarray(p + 4, p + 4 + size));
    p += 4 + size;
  }
  return fields;
}

/** Locates the end-of-central-directory record (also the ZIP64 one) and returns the directory span. */
async function findDirectory(
  handle: FileHandle,
  fileSize: number,
): Promise<{ count: number; offset: number; size: number }> {
  if (fileSize < 22) throw refuse('bad-archive');
  const tailLength = Math.min(fileSize, 22 + MAX_U16);
  const tailStart = fileSize - tailLength;
  const tail = await readAt(handle, tailStart, tailLength);
  let at = -1;
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (tail.readUInt32LE(i) === EOCD) {
      at = i;
      break;
    }
  }
  if (at < 0) throw refuse('bad-archive');
  let count = tail.readUInt16LE(at + 10);
  let size = tail.readUInt32LE(at + 12);
  let offset = tail.readUInt32LE(at + 16);
  if (count === MAX_U16 || size === MAX_U32 || offset === MAX_U32) {
    const locator = at - 20;
    if (locator < 0 || tail.readUInt32LE(locator) !== EOCD64_LOCATOR) throw refuse('bad-archive');
    const recordOffset = Number(tail.readBigUInt64LE(locator + 8));
    if (recordOffset + 56 > fileSize) throw refuse('bad-archive');
    const record = await readAt(handle, recordOffset, 56);
    if (record.readUInt32LE(0) !== EOCD64) throw refuse('bad-archive');
    count = Number(record.readBigUInt64LE(32));
    size = Number(record.readBigUInt64LE(40));
    offset = Number(record.readBigUInt64LE(48));
  }
  if (offset + size > fileSize) throw refuse('bad-archive');
  return { count, offset, size };
}

/**
 * Reads the central directory of the zip in `handle`. Refuses (`too-large`) more than
 * `maxEntries` entries before reading them, and (`bad-archive`) anything malformed, encrypted or
 * compressed with a method other than stored/deflate.
 */
export async function readZipDirectory(
  handle: FileHandle,
  fileSize: number,
  maxEntries: number,
): Promise<ZipEntryRecord[]> {
  const { count, offset, size } = await findDirectory(handle, fileSize);
  if (count > maxEntries || size > MAX_DIRECTORY_BYTES) throw refuse('too-large');
  const data = await readAt(handle, offset, size);
  const entries: ZipEntryRecord[] = [];
  let p = 0;
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > data.length || data.readUInt32LE(p) !== CENTRAL) throw refuse('bad-archive');
    const flags = data.readUInt16LE(p + 8);
    const method = data.readUInt16LE(p + 10);
    const nameLength = data.readUInt16LE(p + 28);
    const extraLength = data.readUInt16LE(p + 30);
    const commentLength = data.readUInt16LE(p + 32);
    const end = p + 46 + nameLength + extraLength + commentLength;
    if (end > data.length) throw refuse('bad-archive');
    const rawName = data.subarray(p + 46, p + 46 + nameLength);
    const extra = parseExtra(data.subarray(p + 46 + nameLength, p + 46 + nameLength + extraLength));
    let uncompressedSize = data.readUInt32LE(p + 24);
    let compressedSize = data.readUInt32LE(p + 20);
    let localHeaderOffset = data.readUInt32LE(p + 42);
    const zip64 = extra.get(ZIP64_EXTRA);
    if (zip64) {
      // Only the fields whose 32-bit value is saturated are present, in this order.
      let q = 0;
      const next = () => {
        if (q + 8 > zip64.length) throw refuse('bad-archive');
        const value = Number(zip64.readBigUInt64LE(q));
        q += 8;
        return value;
      };
      if (uncompressedSize === MAX_U32) uncompressedSize = next();
      if (compressedSize === MAX_U32) compressedSize = next();
      if (localHeaderOffset === MAX_U32) localHeaderOffset = next();
    }
    if (flags & 0x0001 || (method !== 0 && method !== 8)) throw refuse('bad-archive');
    if (method === 0 && compressedSize !== uncompressedSize) throw refuse('bad-archive');
    const name = decodeName(rawName, extra);
    entries.push({
      name,
      isDirectory: name.endsWith('/'),
      method,
      flags,
      crc32: data.readUInt32LE(p + 16),
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    p = end;
  }
  return entries;
}
