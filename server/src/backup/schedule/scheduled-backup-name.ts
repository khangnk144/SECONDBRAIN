/**
 * File names of scheduled backups (SPEC F27.1): `Second Brain <vault name> <YYYY-MM-DD HHmm>.zip`
 * in local time, ` (2)`… when the name is taken. Retention only ever deletes files whose name
 * still has this exact shape (a zip the user renamed is hers).
 */

const MAX_VAULT_NAME = 60;
const MAX_SUFFIX = 99;

/** Characters Windows refuses in file names, and control characters. */
// eslint-disable-next-line no-control-regex
const INVALID = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;

/** The vault folder's name, safe as part of a file name on Windows (never empty). */
export function backupVaultLabel(vaultFolderName: string): string {
  const clean = vaultFolderName
    .normalize('NFC')
    .replace(INVALID, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  const cut = Array.from(clean).slice(0, MAX_VAULT_NAME).join('').trim();
  return cut === '' ? 'vault' : cut;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** `YYYY-MM-DD HHmm` of the local clock. */
export function backupStamp(at: Date): string {
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return `${date} ${pad(at.getHours())}${pad(at.getMinutes())}`;
}

/** The `n`-th candidate name (1 = without suffix). */
export function scheduledBackupName(vaultFolderName: string, at: Date, n = 1): string {
  const suffix = n > 1 ? ` (${n})` : '';
  return `Second Brain ${backupVaultLabel(vaultFolderName)} ${backupStamp(at)}${suffix}.zip`;
}

export const MAX_NAME_ATTEMPTS = MAX_SUFFIX;

const NAME_PATTERN = /^Second Brain .+ \d{4}-\d{2}-\d{2} \d{4}(?: \(\d{1,2}\))?\.zip$/u;

/** True when `fileName` has the shape the app gives its scheduled backups. */
export function isScheduledBackupName(fileName: string): boolean {
  return NAME_PATTERN.test(fileName.normalize('NFC'));
}
