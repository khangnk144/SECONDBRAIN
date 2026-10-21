/**
 * Builds `src/pwa/service-worker.ts` into `dist/sw.js` at the end of `vite build`. The worker
 * gets a BUILD_ID (content hash of everything the build emits, public files included) and the
 * list of files to precache, so every new build is a new worker and triggers the update toast.
 * Not active in development (`apply: 'build'`): `npm run dev` never serves a worker.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { build, type Plugin, type ResolvedConfig, type Rollup } from 'vite';
import { precachePaths } from './src/pwa/precache-paths';

export const SERVICE_WORKER_FILE = 'sw.js';

function listPublicFiles(dir: string, prefix = ''): string[] {
  if (!dir || !existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...listPublicFiles(full, rel));
    else out.push(rel);
  }
  return out;
}

/** Hash of every output file's name and bytes, in a stable order. */
export function computeBuildId(files: ReadonlyMap<string, string | Uint8Array>): string {
  const hash = createHash('sha256');
  for (const name of [...files.keys()].sort()) {
    hash.update(name);
    hash.update('\0');
    hash.update(files.get(name) ?? '');
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

async function bundleWorker(
  root: string,
  entry: string,
  buildId: string,
  precache: string[],
): Promise<string> {
  const result = await build({
    configFile: false,
    root,
    logLevel: 'warn',
    publicDir: false,
    define: {
      __SB_BUILD_ID__: JSON.stringify(buildId),
      __SB_PRECACHE__: JSON.stringify(precache),
    },
    build: {
      write: false,
      emptyOutDir: false,
      copyPublicDir: false,
      minify: true,
      sourcemap: false,
      // A classic script (no import/export): a module worker would need `type: 'module'`.
      rollupOptions: {
        input: entry,
        output: { format: 'iife', entryFileNames: SERVICE_WORKER_FILE },
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RollupOutput[];
  const chunk = outputs
    .flatMap((output) => output.output)
    .find((item): item is Rollup.OutputChunk => item.type === 'chunk' && item.isEntry);
  if (!chunk) throw new Error('The service worker build produced no entry chunk.');
  return chunk.code;
}

export function serviceWorkerPlugin(options: { entry: string }): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'second-brain-service-worker',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    generateBundle: {
      order: 'post',
      async handler(_outputOptions, bundle) {
        const files = new Map<string, string | Uint8Array>();
        for (const item of Object.values(bundle)) {
          files.set(item.fileName, item.type === 'chunk' ? item.code : item.source);
        }
        for (const rel of listPublicFiles(config.publicDir)) {
          if (!files.has(rel)) files.set(rel, readFileSync(path.join(config.publicDir, rel)));
        }
        files.delete(SERVICE_WORKER_FILE);
        const entry = path.resolve(config.root, options.entry);
        const precache = precachePaths(files.keys(), config.base);
        // The worker's own source is part of the id, so a change in its logic alone updates too.
        files.set(`\0${options.entry}`, readFileSync(entry));
        const buildId = computeBuildId(files);
        const code = await bundleWorker(config.root, entry, buildId, precache);
        this.emitFile({ type: 'asset', fileName: SERVICE_WORKER_FILE, source: code });
      },
    },
  };
}
