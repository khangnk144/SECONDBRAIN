/**
 * fflate writes classic (non-ZIP64) archives: 32-bit sizes and offsets, at most 65,535 entries.
 * A vault beyond this is refused with `too-large` instead of producing a broken zip.
 */
export const EXPORT_LIMITS = { maxBytes: 4_000_000_000, maxEntries: 65_000 };

const pad = (value: number) => String(value).padStart(2, '0');

/** `second-brain-sao-luu-YYYY-MM-DD-HHmm.zip` in local time (ASCII: safe in any header). */
export function backupFileName(now: Date): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `second-brain-sao-luu-${date}-${pad(now.getHours())}${pad(now.getMinutes())}.zip`;
}
