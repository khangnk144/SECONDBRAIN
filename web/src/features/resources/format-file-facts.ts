/** Size and date of a file as secondary text ("2,4 MB", "21/10/2026"). */
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import 'dayjs/locale/en';

const UNITS = ['B', 'KB', 'MB', 'GB'] as const;

export function formatFileSize(bytes: number, language: string): string {
  let value = Math.max(bytes, 0);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const number = new Intl.NumberFormat(language === 'vi' ? 'vi-VN' : 'en-US', {
    maximumFractionDigits: unit === 0 || value >= 100 ? 0 : 1,
  }).format(value);
  return `${number} ${UNITS[unit]}`;
}

export function formatFileDate(epochMs: number, language: string, pattern: string): string {
  return dayjs(epochMs).locale(language).format(pattern);
}
