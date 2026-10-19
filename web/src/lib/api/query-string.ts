/**
 * Builds `path?key=value&…` with `encodeURIComponent` (spaces become `%20`, never `+`, so a
 * Vietnamese path with spaces reaches the server exactly). Undefined values are skipped.
 */
export function withQuery(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length === 0 ? path : `${path}?${parts.join('&')}`;
}
