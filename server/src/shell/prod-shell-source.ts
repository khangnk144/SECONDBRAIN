import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import type { ShellSource } from './shell-source.js';

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
    // bundles under /assets/ and the exact top-level public files (favicon…) are served;
    // the raw template is only ever rendered through "/" with placeholders filled in.
    const publicFiles = new Set(
      readdirSync(distDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name !== 'index.html')
        .map((entry) => `/${entry.name}`),
    );
    await app.register(fastifyStatic, {
      root: distDir,
      prefix: '/',
      index: false,
      wildcard: true,
      dotfiles: 'deny',
      allowedPath: (pathName) => pathName.startsWith('/assets/') || publicFiles.has(pathName),
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
