import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import { classifyPath, isNotePath, noteTitleFromPath } from '../markdown/content-classes.js';
import { restoreMissingTemplates } from '../vault/open-vault.js';
import { TEMPLATE_PATHS } from '../vault/vault-layout.js';
import type { VaultPath } from '../vault/vault-types.js';
import { buildVaultTree } from './build-vault-tree.js';

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
}
