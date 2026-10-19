/**
 * Rename/move relink planning (SPEC §4.4, F4). A rename or move must never change what a link
 * means. Every wikilink of every candidate note is resolved twice: against the PRE-operation
 * catalog from the note's current path, and against the POST-operation catalog from the note's
 * path after the operation. When the answers differ the link is pinned:
 * - it resolved to `op.from` → it follows the note to `op.to` (title form when that resolves
 *   there afterwards, else the path form);
 * - it resolved to another note X → it is rewritten to X's path form, so renaming into an
 *   existing title or moving a note away from its same-folder targets cannot hijack it;
 * - it was a ghost or ambiguous → it is left alone.
 * Rewrites are minimal replacements of the target text (`!`, `#heading`, `|alias`, `\|` stay
 * byte-identical; YAML quoting is respected). A rewrite that would not round-trip (a title
 * containing `#`, `|`, `]`…) is not made and is reported as unresolvable instead. Links in
 * code/HTML are never seen, and Markdown links are not rewritten (limitation of SPEC §4.4).
 */
import { isVaultError, type RelinkEdit, type VaultPath } from '../vault/vault-types.js';
import { isNotePath, noteTitleFromPath } from './content-classes.js';
import { buildLinkCatalog } from './link-catalog.js';
import type { LinkCatalog, ParsedLink } from './markdown-types.js';
import { parseNote } from './parse-note.js';
import { type RewriteContext, rewriteLinkTarget } from './relink-rewrite.js';
import { resolveLink } from './resolve-link.js';

export interface RelinkInput {
  op: { kind: 'rename' | 'move'; from: VaultPath; to: VaultPath };
  /** Catalog of the vault BEFORE the operation. */
  catalog: LinkCatalog;
  /**
   * Notes whose links may change meaning: notes linking to `op.from`, notes linking by the old
   * or the new title, and the moved note itself. Any other note may be included harmlessly.
   */
  candidates: VaultPath[];
  readNote: (path: VaultPath) => Promise<{ content: string; revision: string }>;
}

/** A link that had to change but cannot be written so that it still resolves (left as is). */
export interface UnresolvableLink {
  /** The linking note (pre-operation path). */
  path: VaultPath;
  raw: string;
  line: number;
  /** Where the link should have kept pointing (post-operation path). */
  intended: VaultPath;
}

export interface RelinkPlan {
  edits: RelinkEdit[];
  unresolvable: UnresolvableLink[];
}

export async function planRelinkEdits(input: RelinkInput): Promise<RelinkEdit[]> {
  return (await planRelink(input)).edits;
}

export async function planRelink(input: RelinkInput): Promise<RelinkPlan> {
  const { from, to } = input.op;
  const after = postOperationCatalog(input.catalog, from, to);
  const plan: RelinkPlan = { edits: [], unresolvable: [] };
  for (const path of new Set(input.candidates)) {
    const note = await readIfPresent(input.readNote, path);
    if (!note) continue;
    const parsed = parseNote(note.content);
    const pathAfter = path === from ? to : path;
    const context: RewriteContext = {
      after,
      pathAfter,
      frontmatterValid: !parsed.frontmatter.present || parsed.frontmatter.error === null,
    };
    let content = note.content;
    let links: ParsedLink[] = parsed.links;
    // Descending order: an edit never moves the links still to be processed.
    for (const link of [...parsed.links].reverse()) {
      const intended = intendedTarget(link, input.catalog, after, path, pathAfter, from, to);
      if (intended === null) continue;
      const rewrite = targetOptions(link, intended, from, to)
        .map((target) => rewriteLinkTarget(content, links, link, target, intended, context))
        .find((result) => result !== null);
      if (!rewrite) {
        plan.unresolvable.push({ path, raw: link.raw, line: link.line, intended });
        continue;
      }
      links = rewrite.links ?? shiftLinks(links, link, rewrite.text);
      content = rewrite.content;
    }
    if (content !== note.content) {
      plan.edits.push({ path, expectedRevision: note.revision, newContent: content });
    }
  }
  return plan;
}

/** Where the link must point after the operation, or null when it needs no rewrite. */
function intendedTarget(
  link: ParsedLink,
  before: LinkCatalog,
  after: LinkCatalog,
  path: VaultPath,
  pathAfter: VaultPath,
  from: VaultPath,
  to: VaultPath,
): VaultPath | null {
  if (link.kind === 'markdown' || link.target === '') return null;
  const previous = resolveLink(before, link, path);
  if (previous.status !== 'resolved') return null;
  const intended = previous.path === from ? to : previous.path;
  const next = resolveLink(after, link, pathAfter);
  return next.status === 'resolved' && next.path === intended ? null : intended;
}

/** Candidate targets, best first: the moved note by title then path; any other note by path. */
function targetOptions(
  link: ParsedLink,
  intended: VaultPath,
  from: VaultPath,
  to: VaultPath,
): string[] {
  const path = pathTarget(link.target, intended);
  if (intended !== to || from === to || link.target.includes('/')) return [path];
  return [titleTarget(link.target, to), path];
}

/** New title form, keeping a written `.md` suffix; non-note files keep their extension. */
function titleTarget(oldTarget: string, to: VaultPath): string {
  const title = noteTitleFromPath(to);
  return isNotePath(to) && /\.md$/i.test(oldTarget) ? `${title}.md` : title;
}

/** Path form (`.md` omitted for notes unless the old link wrote it; leading `/` kept). */
function pathTarget(oldTarget: string, target: VaultPath): string {
  const keepExtension = !isNotePath(target) || /\.md$/i.test(oldTarget);
  const path = keepExtension ? target : target.slice(0, -3);
  return oldTarget.startsWith('/') ? `/${path}` : path;
}

/** Links of the note after replacing `link.raw` by `text` without re-parsing it. */
function shiftLinks(links: readonly ParsedLink[], link: ParsedLink, text: string): ParsedLink[] {
  const delta = text.length - link.raw.length;
  return links.map((l) => {
    if (l.start === link.start) return { ...l, raw: text, end: l.start + text.length };
    return l.start > link.start ? { ...l, start: l.start + delta, end: l.end + delta } : l;
  });
}

function postOperationCatalog(catalog: LinkCatalog, from: VaultPath, to: VaultPath): LinkCatalog {
  const paths = [...catalog.notePaths, ...catalog.filePaths].filter((p) => p !== from);
  paths.push(to);
  return buildLinkCatalog(paths);
}

/** A candidate deleted since the index saw it simply has nothing to rewrite. */
async function readIfPresent(
  readNote: RelinkInput['readNote'],
  path: VaultPath,
): Promise<{ content: string; revision: string } | null> {
  try {
    return await readNote(path);
  } catch (error) {
    if (isVaultError(error) && error.code === 'NOT_FOUND') return null;
    throw error;
  }
}
