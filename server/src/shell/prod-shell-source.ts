import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import type { ShellSource } from './shell-source.js';
import { distUrlPath, listDistPublicPaths, staticFileHeaders } from './static-file-headers.js';

/**
 * Production UI: hashed assets from web/dist through @fastify/static, and index.html read on
 * each shell request (it is tiny and must carry fresh placeholders, so it is never served raw).
 */
export async function registerProdShellSource(
  app: FastifyInstance,
  distDir: string,
): Promise<ShellSource> {
  const indexFile = path.join(distDir, 'index.html');
  if (existsSync(distDir)) {
    // Allowlist instead of "everything but index.html": on NTFS, spellings such as
    // /INDEX.HTML, /index.html. or /index.html::$DATA reach the same file. Only hashed
    // bundles under /assets/ and the exact public files (favicon, manifest, sw.js, icons…)
    // are served; the raw template is only ever rendered through "/" with placeholders filled in.
    const publicFiles = listDistPublicPaths(distDir);
    await app.register(fastifyStatic, {
      root: distDir,
      prefix: '/',
      index: false,
      wildcard: true,
      dotfiles: 'deny',
      allowedPath: (pathName) => pathName.startsWith('/assets/') || publicFiles.has(pathName),
      setHeaders: (reply, filePath) => {
        for (const [name, value] of Object.entries(
          staticFileHeaders(distUrlPath(distDir, filePath)),
        )) {
          reply.header(name, value);
        }
      },
    });
  }
  return {
    async loadTemplate() {
      try {
        return await readFile(indexFile, 'utf8');
      } catch {
        return null;
      }
    },
  };
}
