/**
 * Packs the runtime tree into the executable's payload (F29.1): one gzip stream of
 * `SBRT1\n` + u32le header length + JSON header `{ files: [[path, size, executable]] }` + the
 * file bytes in header order. The SHA-256 of the gzip bytes names the runtime folder and is
 * checked before extraction (`unpackPayload` in sea-runtime-store.ts reads this format).
 * Deterministic: same files in, same bytes and hash out (no times or modes beyond +x).
 */
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import type { PayloadEntry } from './runtime-entries.js';
import { PAYLOAD_MAGIC, sha256, type PayloadIndex } from './sea-runtime-store.js';

export interface PackedPayload {
  payload: Buffer;
  hash: string;
  files: number;
  /** Uncompressed size of all files. */
  bytes: number;
}

export function packPayload(entries: readonly PayloadEntry[], level = 9): PackedPayload {
  const seen = new Set<string>();
  const index: PayloadIndex = [];
  const bodies: Buffer[] = [];
  let bytes = 0;
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const entry of sorted) {
    if (seen.has(entry.path)) throw new Error(`Duplicate payload path ${entry.path}`);
    seen.add(entry.path);
    const body = entry.data ?? readFileSync(entry.source as string);
    index.push([entry.path, body.length, entry.executable ? 1 : 0]);
    bodies.push(body);
    bytes += body.length;
  }
  const header = Buffer.from(JSON.stringify({ files: index }), 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32LE(header.length);
  const raw = Buffer.concat([Buffer.from(PAYLOAD_MAGIC, 'latin1'), length, header, ...bodies]);
  const payload = zlib.gzipSync(raw, { level });
  return { payload, hash: sha256(payload), files: index.length, bytes };
}
