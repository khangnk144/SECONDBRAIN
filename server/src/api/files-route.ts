import { createReadStream } from 'node:fs';
import { realpath } from 'node:fs/promises';
import nodePath from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import { guardVaultPath } from '../security/path-guard.js';
import { pathQuerySchema, type PathQuery } from './vault-route-schemas.js';

/** Raster images render inline in the app (SPEC §4.8). */
const INLINE_IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** An SVG opened directly is a document: no scripts, no requests, sandboxed. */
export const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
/** Everything else must never run in the app origin, even if a browser decided to render it. */
export const DOWNLOAD_CSP = "default-src 'none'; sandbox";

/** RFC 6266 / 5987: an ASCII fallback plus the exact UTF-8 name. */
function attachmentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * Response headers for a vault file name (SPEC §5 Security): images inline with their type, SVG only
 * as a sandboxed image, everything else (HTML, Markdown, PDF, …) as a download that is never
 * sniffed or rendered in the app origin. Never cached: the file may change on disk at any time.
 */
export function fileServingHeaders(name: string): Record<string, string> {
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  const common = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  const image = INLINE_IMAGE_TYPES[extension];
  if (image) return { ...common, 'content-type': image, 'content-security-policy': DOWNLOAD_CSP };
  if (extension === 'svg') {
    return { ...common, 'content-type': 'image/svg+xml', 'content-security-policy': SVG_CSP };
  }
  return {
    ...common,
    'content-type': extension === 'pdf' ? 'application/pdf' : 'application/octet-stream',
    'content-disposition': attachmentDisposition(name),
    'content-security-policy': DOWNLOAD_CSP,
  };
}

/** GET /api/files?path= – streams a vault file through the path guard (never `.secondbrain/`). */
export function registerFilesRoute(app: FastifyInstance, context: AppContext): void {
  app.get<{ Querystring: PathQuery }>(
    '/api/files',
    { schema: { querystring: pathQuerySchema } },
    async (request, reply) => {
      const path = guardVaultPath(request.query.path);
      // Type and download name come from the file actually served, never from the requested
      // spelling (other case, NFC form or Windows short name of the same file, or a link).
      const real = await realpath(await context.vault.resolveExisting(path));
      reply.headers(fileServingHeaders(nodePath.basename(real)));
      return reply.send(createReadStream(real));
    },
  );
}
