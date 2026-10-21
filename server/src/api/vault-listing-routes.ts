import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import { classifyPath, isNotePath, noteTitleFromPath } from '../markdown/content-classes.js';
import { templateUpgradeStates, upgradeTemplates } from '../templates/template-upgrades.js';
import { restoreMissingTemplates } from '../vault/open-vault.js';
import { TEMPLATE_PATHS } from '../vault/vault-layout.js';
import type { VaultPath } from '../vault/vault-types.js';
import { buildVaultTree } from './build-vault-tree.js';
import { vaultPathSchema } from './vault-route-schemas.js';

const key = (path: VaultPath) => path.normalize('NFC').toLowerCase();
const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });

/** Sidebar tree and template list: both read from disk so they are never behind the files. */
export function registerVaultListingRoutes(app: FastifyInstance, context: AppContext): void {
  const bundled = new Set(TEMPLATE_PATHS.map(key));

  app.get('/api/tree', async (_request, reply) => {
    const listing = await context.vault.list();
    const urgent = context.deadlines
      .items()
      .filter((item) => item.urgency === 'urgent' && !item.done)
      .map((item) => item.path);
    reply.header('cache-control', 'no-store');
    return buildVaultTree(listing, urgent);
  });

  app.get('/api/templates', async (_request, reply) => {
    const { files } = await context.vault.list();
    const templates = files
      .filter((file) => isNotePath(file.path) && classifyPath(file.path) === 'template')
      .map((file) => ({
        path: file.path,
        title: noteTitleFromPath(file.path),
        bundled: bundled.has(key(file.path)),
      }))
      .sort((a, b) => collator.compare(a.title, b.title));
    const present = new Set(templates.map((template) => key(template.path)));
    reply.header('cache-control', 'no-store');
    return { templates, missingBundled: TEMPLATE_PATHS.filter((path) => !present.has(key(path))) };
  });

  // "Khôi phục mẫu gốc": re-creates missing bundled templates only, never overwrites (F14.1).
  app.post('/api/templates/restore', async () => {
    const restored = await restoreMissingTemplates(context.vault);
    await context.settled();
    return { restored };
  });

  // "Cập nhật mẫu" (R2): which bundled files can be upgraded; never writes.
  app.get('/api/templates/upgrades', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return { items: await templateUpgradeStates(context.vault) };
  });

  // Replaces only files byte-identical to an earlier bundled version (old copy to the trash).
  app.post<{ Body: { paths: string[] } }>(
    '/api/templates/upgrade',
    {
      schema: {
        body: {
          type: 'object',
          required: ['paths'],
          properties: { paths: { type: 'array', maxItems: 20, items: vaultPathSchema } },
        },
      },
    },
    async (request) => {
      const result = await upgradeTemplates(context.vault, request.body.paths);
      await context.settled();
      return result;
    },
  );
}
