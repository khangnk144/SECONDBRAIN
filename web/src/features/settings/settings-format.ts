/** Numbers, lists and months in the words of the current language (Settings AI copy). */

const locale = (language: string) => (language.startsWith('en') ? 'en-US' : 'vi-VN');

/** 2000000 → "2.000.000" (vi) / "2,000,000" (en). */
export function formatTokens(value: number, language: string): string {
  return new Intl.NumberFormat(locale(language), { maximumFractionDigits: 0 }).format(value);
}

/** ["3 Resources", "4 Archive"] → "3 Resources và 4 Archive" / "3 Resources and 4 Archive". */
export function formatList(items: readonly string[], language: string): string {
  return new Intl.ListFormat(locale(language), { type: 'conjunction' }).format(items);
}

/** The month after `YYYY-MM`, e.g. "tháng 11 năm 2026" / "November 2026". */
export function nextMonthLabel(month: string, language: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const date = match ? new Date(Number(match[1]), Number(match[2]), 1) : new Date();
  if (!match) date.setMonth(date.getMonth() + 1, 1);
  return new Intl.DateTimeFormat(locale(language), { month: 'long', year: 'numeric' }).format(date);
}

/**
 * A whole number typed with or without group separators ("2.000.000", "2,000,000",
 * "2 000 000"; `\s` also covers the no-break spaces Intl uses); null for anything else.
 */
export function parseTokenCount(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}([.,\s]?\d{3})*$|^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed.replace(/\D/g, ''));
  return Number.isSafeInteger(value) ? value : null;
}
