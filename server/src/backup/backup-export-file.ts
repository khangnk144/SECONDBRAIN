/**
 * "Xuất bản sao lưu…" (SPEC F18.5) without silent gaps. The zip is built into a temp file in
 * `.secondbrain/cache/backup-export/` (left out of backups and of the history) while the vault's
 * write queue is held, so no save, rename, move or trash of this app can change the files
 * between the listing and the read; reads go on. Only the finished file is sent, and it is
 * removed once it has been sent (or the client went away). Every file left out is counted.
 */
import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { asWriteFailed } from '../vault/vault-errors.js';
import type { VaultService } from '../vault/vault-types.js';
import { refuse } from './backup-errors.js';
import { EXPORT_LIMITS } from './backup-file-name.js';
import { listBackupEntries } from './backup-file-list.js';
import { createBackupZipStream } from './backup-zip-stream.js';

const EXPORT_FOLDER = 'backup-export';
/** Offsets in a classic zip are 32-bit: a larger file would be a broken archive. */
const MAX_ZIP_BYTES = 0xffff_ffff;
/** Temp zips this process is still building or sending (never removed as leftovers). */
const inUse = new Set<string>();

export interface BuiltBackup {
  /** Absolute path of the finished zip (ours, in the vault's cache). */
  file: string;
  size: number;
  entries: number;
  /** Files and folders that are not in the zip: unreadable when listed, or when opened. */
  unreadable: number;
}

/** Zips a crash or a killed server left behind; ours alone, so they may go. */
async function removeLeftovers(folder: string): Promise<void> {
  for (const name of await readdir(folder).catch(() => [] as string[])) {
    const abs = path.join(folder, name);
    if (!inUse.has(abs)) await rm(abs, { force: true, recursive: true }).catch(() => undefined);
  }
}

export async function buildBackupFile(vault: VaultService): Promise<BuiltBackup> {
  return vault.exclusive(async () => {
    const listing = await listBackupEntries(vault.root);
    if (
      listing.entries.length > EXPORT_LIMITS.maxEntries ||
      listing.totalBytes > EXPORT_LIMITS.maxBytes
    ) {
      throw refuse('too-large');
    }
    const folder = path.join(vault.paths.cacheDir, EXPORT_FOLDER);
    const file = path.join(folder, `${randomBytes(8).toString('hex')}.zip`);
    inUse.add(file);
    let skipped = 0;
    try {
      await mkdir(folder, { recursive: true });
      await removeLeftovers(folder);
      const zip = createBackupZipStream(listing.entries, () => (skipped += 1));
      await pipeline(zip, createWriteStream(file, { flags: 'wx' }));
      const { size } = await stat(file);
      if (size > MAX_ZIP_BYTES) throw refuse('too-large'); // files grew since they were listed
      return {
        file,
        size,
        entries: listing.entries.length - skipped,
        unreadable: listing.unreadable + skipped,
      };
    } catch (error) {
      inUse.delete(file);
      await rm(file, { force: true }).catch(() => undefined);
      throw asWriteFailed(error, '.secondbrain/cache');
    }
  });
}

/** The finished zip as a stream; the file is removed when the stream closes, sent or not. */
export function sendableBackup(built: BuiltBackup): Readable {
  const stream = createReadStream(built.file);
  stream.once('close', () => {
    void rm(built.file, { force: true })
      .catch(() => undefined)
      .finally(() => inUse.delete(built.file));
  });
  return stream;
}
