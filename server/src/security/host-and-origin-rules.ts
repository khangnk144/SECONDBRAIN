/**
 * Pure rules for the local API's network boundary (SPEC §5 "Security (local API)").
 * The server only ever listens on 127.0.0.1, but a malicious web page can still reach it
 * through DNS rebinding (wrong Host) or cross-site requests (foreign Origin); these rules close both.
 */

export function canonicalOrigin(port: number): string {
  return `http://localhost:${port}`;
}

export function allowedHosts(port: number): string[] {
  return [`localhost:${port}`, `127.0.0.1:${port}`];
}

export function isAllowedHost(hostHeader: string | undefined, port: number): boolean {
  if (!hostHeader) return false;
  return allowedHosts(port).includes(hostHeader.trim().toLowerCase());
}

/** True when the request arrived via the IP form of the host, which the UI shell redirects away from. */
export function isLoopbackIpHost(hostHeader: string | undefined, port: number): boolean {
  return (hostHeader ?? '').trim().toLowerCase() === `127.0.0.1:${port}`;
}

/** Origin must be the canonical origin, or absent (same-origin non-CORS requests, local tools). */
export function isAllowedOrigin(originHeader: string | undefined, port: number): boolean {
  if (originHeader === undefined) return true;
  return originHeader === canonicalOrigin(port);
}

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isStateChangingMethod(method: string): boolean {
  return STATE_CHANGING_METHODS.has(method.toUpperCase());
}

export function isWebSocketUpgrade(
  headers: Record<string, string | string[] | undefined>,
): boolean {
  const upgrade = headers.upgrade;
  return typeof upgrade === 'string' && upgrade.toLowerCase() === 'websocket';
}

/** Path without the query string, percent-decoded once (falls back to the raw path if malformed). */
export function decodedRequestPath(url: string): string {
  const rawPath = url.split('?')[0] ?? '/';
  try {
    return decodeURIComponent(rawPath);
  } catch {
    return rawPath;
  }
}

export function isApiPath(decodedPath: string): boolean {
  const lower = decodedPath.toLowerCase();
  return lower === '/api' || lower.startsWith('/api/');
}

export function isWebSocketPath(decodedPath: string): boolean {
  const lower = decodedPath.toLowerCase();
  return lower === '/ws' || lower.startsWith('/ws/');
}

/** The Streamable HTTP MCP endpoint (SPEC F32) and anything below it. */
export function isMcpPath(decodedPath: string): boolean {
  const lower = decodedPath.toLowerCase();
  return lower === '/mcp' || lower.startsWith('/mcp/');
}

/** The token of an `Authorization: Bearer <token>` header (scheme case-insensitive), else null. */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header ?? '');
  return match ? (match[1] as string) : null;
}

/** Routes reachable without the session token (the launcher polls health before it knows the token). */
export function isPublicApiRoute(method: string, decodedPath: string): boolean {
  const m = method.toUpperCase();
  return (m === 'GET' || m === 'HEAD') && decodedPath === '/api/health';
}
