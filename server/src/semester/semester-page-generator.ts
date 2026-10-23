/**
 * Writes the "Học kỳ này" page (SPEC F25.1, F25.3) through the vault service, revision-checked:
 * - the page is the app's own only while its revision on disk is one the app wrote (`lastRevision`
 *   or the write in progress, `nextRevision`); the app's page with any other revision (still
 *   marked `generated: true`) = edited outside the app, and it is never overwritten – only
 *   "Tạo lại" (`replace`) moves that copy to the trash (`reason: generated-replaced`) and writes a
 *   fresh page;
 * - a note of hers at the page's path is never touched: the page is created under the next free
 *   name instead (`semester-page-ownership.ts`, review M1);
 * - bytes that would not change are never written (SPEC §4.9 P1);
 * - a page she deleted is not brought back by itself (`auto`); turning the page on (`create`)
 *   or "Tạo lại" creates it again.
 */
import { createHash } from 'node:crypto';
import type { AppContext } from '../app-context/create-app-context.js';
import { toLocalDate } from '../lib/local-date.js';
import { catalogIndex } from '../markdown/link-catalog.js';
import { linkIdentityKey } from '../markdown/normalize-text.js';
import { isVaultError, type NoteRead, type VaultPath } from '../vault/vault-types.js';
import { renderSemesterPage } from './semester-page-content.js';
import { pageStatus, type SemesterPageStatus } from './semester-page-status.js';
import { pageText, type PageLanguage } from './semester-page-messages.js';
import { freePageName, hasGeneratedMark } from './semester-page-ownership.js';
import { collectSemesterRows } from './semester-page-rows.js';
import { openSpan } from './semester-page-spans.js';
import type { SemesterStateStore } from './semester-page-state.js';

export type RegenerateMode = 'auto' | 'create' | 'replace';
export type RegenerateOutcome =
  'off' | 'missing' | 'edited' | 'unchanged' | 'written' | 'created' | 'replaced';

export type { PageStateName, SemesterPageStatus } from './semester-page-status.js';

export interface GeneratorDeps {
  context: Pick<AppContext, 'vault' | 'index' | 'now'>;
  store: SemesterStateStore;
  language: () => PageLanguage;
}

export interface PageGenerator {
  regenerate(mode: RegenerateMode): Promise<RegenerateOutcome>;
  status(): Promise<SemesterPageStatus>;
  /** The page's file in the current UI language (`Học kỳ này.md` / `This semester.md`). */
  defaultPath(): VaultPath;
  /** Paths whose edits may change the page, from the last build (identity keys). */
  watched(): ReadonlySet<string>;
  isOurs(revision: string): boolean;
  /** The file is the app's page: written by it, or edited outside but still its page. */
  isAppFile(page: NoteRead): boolean;
  readPage(path: VaultPath): Promise<NoteRead | null>;
}

const sha256 = (text: string) =>
  createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

export function createPageGenerator(deps: GeneratorDeps): PageGenerator {
  const { context, store } = deps;
  let watched = new Set<string>();
  const isOurs = (revision: string) => {
    const s = store.get();
    return revision === s.lastRevision || revision === s.nextRevision;
  };
  const isAppFile = (page: NoteRead) =>
    isOurs(page.revision) || (store.get().lastRevision !== null && hasGeneratedMark(page.content));
  const today = () => toLocalDate(context.now());

  async function readPage(path: VaultPath): Promise<NoteRead | null> {
    try {
      return await context.vault.read(path);
    } catch (error) {
      if (isVaultError(error) && error.code === 'NOT_FOUND') return null;
      throw error;
    }
  }

  function build(pagePath: VaultPath, created: string): string {
    const pageKey = linkIdentityKey(pagePath);
    const rows = collectSemesterRows(
      context.index,
      today(),
      (path) => linkIdentityKey(path) === pageKey,
    );
    watched = new Set(rows.watched.map(linkIdentityKey));
    const catalog = context.index.linkCatalog();
    return renderSemesterPage({ rows, catalog, language: deps.language(), created });
  }

  async function writeNew(path: VaultPath): Promise<'created' | 'taken'> {
    const created = store.get().created ?? today();
    const content = build(path, created);
    await store.update({ nextRevision: sha256(content), created });
    try {
      const result = await context.vault.create(path, content);
      await store.update({
        lastRevision: result.revision,
        nextRevision: null,
        lastGeneratedAt: context.now().toISOString(),
      });
      return 'created';
    } catch (error) {
      // A file of hers has that name: never replaced (the page takes another name).
      if (!(isVaultError(error) && error.code === 'EXISTS')) throw error;
      await store.update({ nextRevision: null });
      return 'taken';
    }
  }

  /** A name nothing holds: not in the index (any spelling) and not on disk. */
  async function taken(path: VaultPath): Promise<boolean> {
    if (catalogIndex(context.index.linkCatalog()).byFilePath.has(linkIdentityKey(path)))
      return true;
    return (await readPage(path)) !== null;
  }

  /** Creates the page at its path, or under the next free name while a note of hers holds it. */
  async function placeNew(): Promise<'created' | 'taken'> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const path = store.get().path as VaultPath;
      if ((await writeNew(path)) === 'created') return 'created';
      const free = await freePageName(path, taken);
      // A new place: nothing of the old one carries over; its span ends, a new one starts.
      await store.update({
        path: free,
        lastRevision: null,
        nextRevision: null,
        lastGeneratedAt: null,
        created: null,
        spans: openSpan(store.get().spans, free, context.now()),
      });
    }
    return 'taken';
  }

  async function rewrite(current: NoteRead): Promise<RegenerateOutcome> {
    const s = store.get();
    if (current.revision !== s.lastRevision) {
      // The previous write landed but the state did not record it (crash): adopt it.
      await store.update({ lastRevision: current.revision, nextRevision: null });
    }
    const content = build(current.path, s.created ?? today());
    if (current.content === content) return 'unchanged';
    await store.update({ nextRevision: sha256(content) });
    try {
      const result = await context.vault.write(current.path, content, current.revision);
      await store.update({
        lastRevision: result.revision,
        nextRevision: null,
        lastGeneratedAt: context.now().toISOString(),
      });
      return 'written';
    } catch (error) {
      // Edited between the read and the write: hers now.
      if (!(isVaultError(error) && error.code === 'CONFLICT')) throw error;
      await store.update({ nextRevision: null });
      return 'edited';
    }
  }

  return {
    defaultPath: () => pageText(deps.language()).fileName,
    watched: () => watched,
    isOurs,
    isAppFile,
    readPage,

    async regenerate(mode) {
      const s = store.get();
      if (!s.enabled || s.path === null) return 'off';
      const current = await readPage(s.path);
      const created = async () => ((await placeNew()) === 'created' ? 'created' : 'missing');
      if (current === null) {
        if (mode === 'auto' && s.lastRevision !== null) return 'missing';
        return created();
      }
      if (isOurs(current.revision)) return rewrite(current);
      if (isAppFile(current)) {
        if (mode !== 'replace') return 'edited';
        await context.vault.trash([current.path], [current.revision], 'generated-replaced');
        return (await placeNew()) === 'created' ? 'replaced' : 'missing';
      }
      // A note of hers holds the name (made after the page was deleted, or before it existed).
      if (mode === 'auto' && s.lastRevision !== null) return 'missing';
      return created();
    },

    async status() {
      const s = store.get();
      const path = s.path ?? pageText(deps.language()).fileName;
      return pageStatus(s, path, await readPage(path), { isAppFile, isOurs });
    },
  };
}
