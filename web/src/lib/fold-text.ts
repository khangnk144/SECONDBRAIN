/**
 * Diacritic-insensitive matching for small client-side filters (folder picker, menus), same rule
 * as the server's `foldForMatch`: NFC, lowercase, `đ`→`d`, then every combining mark removed.
 */
export function foldText(value: string): string {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replaceAll('đ', 'd')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .normalize('NFC');
}
