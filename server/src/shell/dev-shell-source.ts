import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import middie from '@fastify/middie';
import type { FastifyInstance } from 'fastify';
import {
  decodedRequestPath,
  isApiPath,
  isWebSocketPath,
} from '../security/host-and-origin-rules.js';
import type { ShellSource } from './shell-source.js';

export const DEFAULT_HMR_PORT = 24678;

type NextFn = (error?: unknown) => void;

/**
 * Development UI: Vite runs in middleware mode inside this server, so the app is still served
 * from the canonical origin with the same Host/Origin/token rules. The root security hook is
 * registered before middie, so it runs before any Vite middleware. HMR uses its own websocket port.
 */
export async function registerDevShellSource(
  app: FastifyInstance,
  options: { webDir: string; hmrPort: number },
): Promise<ShellSource> {
  const { createServer } = await import('vite');
  const configFile = path.join(options.webDir, 'vite.config.ts');
  const vite = await createServer({
    root: options.webDir,
    configFile: existsSync(configFile) ? configFile : false,
    // Evaluate vite.config.ts with Vite's module runner instead of bundling it to a temp .mjs
    // that Node imports: `tsx watch` would otherwise see that temp file vanish and restart forever.
    configLoader: 'runner',
    appType: 'custom',
    server: { middlewareMode: true, hmr: { port: options.hmrPort } },
  });
  app.addHook('onClose', async () => {
    await vite.close();
  });

  await app.register(middie);
  app.use((req: { url?: string }, res: unknown, next: NextFn) => {
    const pathName = decodedRequestPath(req.url ?? '/');
    // "/" is rendered by the shell route; API and WS never touch Vite.
    if (
      pathName === '/' ||
      pathName === '/index.html' ||
      isApiPath(pathName) ||
      isWebSocketPath(pathName)
    ) {
      next();
      return;
    }
    vite.middlewares(req as never, res as never, next);
  });

  const indexFile = path.join(options.webDir, 'index.html');
  return {
    async loadTemplate(url: string) {
      let template: string;
      try {
        template = await readFile(indexFile, 'utf8');
      } catch {
        return null;
      }
      return vite.transformIndexHtml(url, template);
    },
  };
}
