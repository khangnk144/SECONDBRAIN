import { SOURCES_PLUGIN } from '../app-context/vault-plugins.js';
import type { IndexedNote } from '../index/index-types.js';
import { toLocalDate } from '../lib/local-date.js';
import { classifyPath } from '../markdown/content-classes.js';
import { guardVaultPath } from '../security/path-guard.js';
import type { SourceTextService } from '../sources/source-types.js';
import type { VaultPath } from '../vault/vault-types.js';
import { capLists } from './bounded-results.js';
import { latestSucceeded, readManifest } from './ingest-manifest.js';
import type { McpDeps } from './mcp-deps.js';

/** A concept linked this often from wiki pages without having a page is worth one. */
export const MISSING_CONCEPT_MENTIONS = 3;
export const REVIEW_AFTER_DAYS = 90;

/**
 * `wiki_lint` (SPEC F32): a structural report of `wiki/`. Every list holds candidates for the
 * owner or the model to look at, never verdicts that something is wrong.
 */
export interface WikiLintReport {
  /** Wiki pages no other note links to (wiki/index.md, wiki/log.md and CLAUDE.md do not count). */
  orphanPages: VaultPath[];
  /** Links in wiki/ that resolve to nothing. */
  brokenLinks: { page: VaultPath; target: string }[];
  /** Ghost link targets used at least three times from wiki pages. */
  missingConcepts: { name: string; mentions: number }[];
  /** Sources in 3 Resources/ without a successful ingest. */
  notIngested: VaultPath[];
  /** Paper pages whose `source_hash` is not the source's current hash (or the source is gone). */
  sourceChanged: { page: VaultPath; source: VaultPath }[];
  /** Wiki pages not changed for 90 days. */
  reviewCandidates: { page: VaultPath; lastModified: string }[];
  /** False when the source-text service is not running (then `notIngested` is empty). */
  sourcesAvailable: boolean;
  /** Full length of every list; the lists themselves hold at most 100 entries each. */
  counts: Record<LintList, number>;
}

const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inWiki = (note: IndexedNote) =>
  note.class === 'wiki' || (note.class === 'control' && /^wiki\//i.test(note.path));

async function currentHash(
  deps: McpDeps,
  service: SourceTextService | null,
  path: VaultPath,
): Promise<string | null> {
  const status = service ? await service.status(path).catch(() => null) : null;
  if (status) return status.contentHash;
  return deps.context.vault
    .readBytes(path)
    .then((read) => read.revision)
    .catch(() => null);
}

function missingConcepts(pages: IndexedNote[], deps: McpDeps) {
  const counts = new Map<string, { name: string; mentions: number }>();
  for (const page of pages) {
    for (const link of deps.context.index.outlinks(page.path)) {
      if (link.toPath !== null || link.ambiguous || link.target === '') continue;
      const key = link.target.normalize('NFC').toLowerCase().replace(/\.md$/, '');
      const entry = counts.get(key) ?? { name: link.target, mentions: 0 };
      entry.mentions += 1;
      counts.set(key, entry);
    }
  }
  return [...counts.values()]
    .filter((entry) => entry.mentions >= MISSING_CONCEPT_MENTIONS)
    .sort((a, b) => b.mentions - a.mentions || byPath(a.name, b.name));
}

async function sourceChanges(
  deps: McpDeps,
  pages: IndexedNote[],
  service: SourceTextService | null,
) {
  const changed: { page: VaultPath; source: VaultPath }[] = [];
  for (const page of pages) {
    const { source, source_hash: hash } = page.frontmatter ?? {};
    if (typeof source !== 'string' || hash === undefined || hash === null || hash === '') continue;
    let path: VaultPath;
    try {
      path = guardVaultPath(source.trim());
    } catch {
      continue;
    }
    if ((await currentHash(deps, service, path)) !== String(hash).trim()) {
      changed.push({ page: page.path, source: path });
    }
  }
  return changed;
}

async function notIngested(deps: McpDeps, service: SourceTextService): Promise<VaultPath[]> {
  const out: VaultPath[] = [];
  for (const source of await service.listSources()) {
    const manifest = await readManifest(deps.context.vault.paths.ingestDir, source.sourceId);
    if (!latestSucceeded(manifest?.runs ?? [])) out.push(source.path);
  }
  return out;
}

type LintList =
  | 'orphanPages'
  | 'brokenLinks'
  | 'missingConcepts'
  | 'notIngested'
  | 'sourceChanged'
  | 'reviewCandidates';

export async function wikiLint(deps: McpDeps): Promise<WikiLintReport> {
  const { index } = deps.context;
  await deps.context.settled();
  const notes = index.listNotes().sort((a, b) => byPath(a.path, b.path));
  const pages = notes.filter((note) => note.class === 'wiki');
  const service = deps.context.plugin<SourceTextService>(SOURCES_PLUGIN);
  const orphanPages = pages
    .filter(
      (page) => !index.backlinks(page.path).some((l) => classifyPath(l.fromPath) !== 'control'),
    )
    .map((page) => page.path);
  const brokenLinks = notes.filter(inWiki).flatMap((page) =>
    index
      .outlinks(page.path)
      .filter((link) => link.toPath === null && !link.ambiguous)
      .map((link) => ({ page: page.path, target: link.target })),
  );
  const cutoff = deps.context.now().getTime() - REVIEW_AFTER_DAYS * 24 * 60 * 60 * 1000;
  const reviewCandidates = pages
    .filter((page) => page.mtimeMs < cutoff)
    .sort((a, b) => a.mtimeMs - b.mtimeMs)
    .map((page) => ({ page: page.path, lastModified: toLocalDate(new Date(page.mtimeMs)) }));
  const lists = capLists({
    orphanPages,
    brokenLinks,
    missingConcepts: missingConcepts(pages, deps),
    notIngested: service ? await notIngested(deps, service) : [],
    sourceChanged: await sourceChanges(deps, pages, service),
    reviewCandidates,
  });
  return { ...lists, sourcesAvailable: service !== null };
}
