/** The newest scheduled-backup zip in a folder (what "Mở thư mục" selects), or null. */
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { isScheduledBackupName } from './scheduled-backup-name.js';

export async function newestBackupIn(folder: string): Promise<string | null> {
  let names: string[];
  try {
    names = await readdir(folder);
  } catch {
    return null;
  }
  let newest: { file: string; mtimeMs: number } | null = null;
  for (const name of names.filter(isScheduledBackupName)) {
    const file = path.join(folder, name);
    const info = await lstat(file).catch(() => null);
    if (info?.isFile() && (!newest || info.mtimeMs > newest.mtimeMs))
      newest = { file, mtimeMs: info.mtimeMs };
  }
  return newest?.file ?? null;
}
