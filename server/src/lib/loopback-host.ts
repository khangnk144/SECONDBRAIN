/**
 * Host names that always mean this machine: `localhost`, `127.x.x.x` and `::1` (with or without
 * brackets). Used where a weaker setting is acceptable only when nothing leaves the computer: SMTP
 * without encryption (a local relay) and the e2e stand-in for the Telegram Bot API.
 */
export function isLoopbackHostName(host: string): boolean {
  const name = host
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1');
  return name === 'localhost' || name === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name);
}
