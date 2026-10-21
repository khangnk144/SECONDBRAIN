import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** A multipart/form-data body as a browser sends it: fields in order, then the file. */
export function multipartBody(
  fields: [string, string][],
  file?: { field?: string; filename?: string; data: Buffer },
  after: [string, string][] = [],
): { payload: Buffer; contentType: string } {
  const boundary = '----sbTestBoundary7MA4YWxkTrZu0gW';
  const parts: Buffer[] = [];
  const field = ([name, value]: [string, string]) =>
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  fields.forEach(field);
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field ?? 'file'}"; filename="${file.filename ?? 'backup.zip'}"\r\nContent-Type: application/zip\r\n\r\n`,
      ),
      file.data,
      Buffer.from('\r\n'),
    );
  }
  after.forEach(field);
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/** Every regular file under `dir` (relative `/` names → bytes), skipping what `skip` says. */
export function readTree(dir: string, skip: (relative: string) => boolean = () => false) {
  const out = new Map<string, Buffer>();
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      const relative = path.relative(dir, abs).split(path.sep).join('/');
      if (skip(relative) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) out.set(relative, readFileSync(abs));
    }
  };
  walk(dir);
  return out;
}

export interface CentralEntry {
  name: Buffer;
  flags: number;
  method: number;
  /** Offset of this entry's record inside the archive (to patch fields in tests). */
  offset: number;
}

/** Central-directory records of a classic zip, parsed independently of the app's reader. */
export function centralEntries(zip: Buffer): CentralEntry[] {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const entries: CentralEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    const nameLength = zip.readUInt16LE(p + 28);
    entries.push({
      name: zip.subarray(p + 46, p + 46 + nameLength),
      flags: zip.readUInt16LE(p + 8),
      method: zip.readUInt16LE(p + 10),
      offset: p,
    });
    p += 46 + nameLength + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
  }
  return entries;
}
