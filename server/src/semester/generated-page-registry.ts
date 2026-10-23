/**
 * Which note of a vault the app generates itself (SPEC F25: the "Học kỳ này" page while its
 * switch is on). One small registry keyed by the vault service, so the write routes, the MCP
 * write tool and the relink planner can ask "is this the generated page?" without knowing the
 * plugin. The plugin sets the path only while the file there is the app's own page (written by
 * it, or edited outside the app but still marked `generated: true`) and clears it when the page
 * is off, gone, replaced by a note of hers, or the plugin closes: a note the app did not write is
 * never guarded (review M1). It also publishes the page's spans (`semester-page-spans.ts`), so
 * the activity views leave out the generator's own events, also after the page is off (L2).
 */
import { ApiError } from '../http/api-errors.js';
import { linkIdentityKey } from '../markdown/normalize-text.js';
import type { VaultPath, VaultService } from '../vault/vault-types.js';
import { spanMatcher, type GeneratedSpan } from './semester-page-spans.js';

const managed = new WeakMap<object, VaultPath>();
const generatedEvents = new WeakMap<object, (path: VaultPath, ts: string) => boolean>();

export function setManagedPage(vault: object, path: VaultPath | null): void {
  if (path === null) managed.delete(vault);
  else managed.set(vault, path);
}

/** Publishes when which path held the app's page (an empty list clears it). */
export function setGeneratedSpans(vault: object, spans: readonly GeneratedSpan[]): void {
  if (spans.length === 0) generatedEvents.delete(vault);
  else generatedEvents.set(vault, spanMatcher(spans));
}

/** `(path, ts) => true` for an event the generator wrote, or null when there is none. */
export function generatedEventsOf(
  vault: object,
): ((path: VaultPath, ts: string) => boolean) | null {
  return generatedEvents.get(vault) ?? null;
}

export function managedPageOf(vault: object): VaultPath | null {
  return managed.get(vault) ?? null;
}

/** Same file name rules as Windows: NFC and letter case do not matter. */
export function isManagedPage(vault: object, path: VaultPath): boolean {
  const page = managed.get(vault);
  return page !== undefined && linkIdentityKey(page) === linkIdentityKey(path);
}

const baseName = (path: VaultPath) => linkIdentityKey(path.slice(path.lastIndexOf('/') + 1));

/** The registry plus the real place of a path that may reach the page through a folder link. */
export async function isGeneratedPage(
  context: { vault: Pick<VaultService, 'realPath'> },
  path: VaultPath,
): Promise<boolean> {
  const { vault } = context;
  if (isManagedPage(vault, path)) return true;
  const page = managed.get(vault);
  // Only a path with the page's file name can be the page under another spelling (a junction).
  if (page === undefined || baseName(page) !== baseName(path)) return false;
  try {
    return isManagedPage(vault, await vault.realPath(path));
  } catch {
    return false;
  }
}

/** The refusal of every write to the generated page except its generator's (F25.2). */
export function generatedPageError(path: VaultPath): ApiError {
  return new ApiError(
    409,
    'GENERATED_PAGE',
    'This page is made by the app. Change the course and project notes instead.',
    { path, reason: 'generated-page' },
  );
}

/** Throws `GENERATED_PAGE` (409) when `path` is the generated page of the open vault. */
export async function assertNotGeneratedPage(
  context: { vault: Pick<VaultService, 'realPath'> },
  path: VaultPath,
): Promise<void> {
  if (await isGeneratedPage(context, path)) throw generatedPageError(path);
}
