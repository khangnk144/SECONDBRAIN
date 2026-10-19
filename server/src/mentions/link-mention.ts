/**
 * "Liên kết" on an unlinked mention (SPEC F5.2): the one occurrence becomes a wikilink, as a text
 * patch at the revision the mention was found in. The title form is used when the title names
 * exactly one note vault-wide (`[[Title]]`, or `[[Title|text]]` when the case differs), otherwise
 * the path form with the original text as alias, and the link must resolve to the target. Inside a
 * GFM table the alias separator is written `\|`, so the row keeps its cells.
 */
import { catalogIndex } from '../markdown/link-catalog.js';
import { noteTitleFromPath } from '../markdown/content-classes.js';
import type { LinkCatalog } from '../markdown/markdown-types.js';
import { linkIdentityKey } from '../markdown/normalize-text.js';
import { parseNote } from '../markdown/parse-note.js';
import { resolveLink } from '../markdown/resolve-link.js';
import { isInsideTable } from '../markdown/table-ranges.js';
import { findTitleMentions } from '../markdown/title-mentions.js';
import { VaultError, type TextRangePatch, type VaultPath } from '../vault/vault-types.js';

/** Characters that are wikilink syntax: a title holding one cannot be linked by text. */
const LINK_SYNTAX = /[[\]|#^]/;

function refuse(reason: string, message: string, details: Record<string, unknown> = {}) {
  return new VaultError('VALIDATION', message, { ...details, reason });
}

export interface LinkMentionRequest {
  /** The mentioning note (canonical vault path). */
  notePath: VaultPath;
  start: number;
  end: number;
  /** The note the mention names (canonical vault path). */
  target: VaultPath;
  catalog: LinkCatalog;
}

/** The single patch that wraps the mention, computed on the content at the expected revision. */
export function planLinkMention(content: string, request: LinkMentionRequest): TextRangePatch[] {
  const { notePath, start, end, target, catalog } = request;
  const title = noteTitleFromPath(target);
  if (LINK_SYNTAX.test(title)) {
    throw refuse('unlinkable-title', 'This title cannot be written as a link.', { target });
  }
  const isMention = findTitleMentions(content, title).some(
    (mention) => mention.start === start && mention.end === end,
  );
  if (!isMention) {
    const message = 'The text at this place is not an unlinked mention of the note.';
    throw refuse('not-a-mention', message, { start, end });
  }
  const original = content.slice(start, end);
  const unique = catalogIndex(catalog).byTitle.get(linkIdentityKey(title))?.length === 1;
  const linkTarget = unique ? title : target.replace(/\.md$/i, '');
  const separator = isInsideTable(content, start) ? '\\|' : '|';
  const text =
    unique && original === title ? `[[${title}]]` : `[[${linkTarget}${separator}${original}]]`;
  const next = content.slice(0, start) + text + content.slice(end);
  const link = parseNote(next).links.find((l) => l.start === start);
  const resolution = link && link.raw === text ? resolveLink(catalog, link, notePath) : null;
  if (resolution?.status !== 'resolved' || resolution.path !== target) {
    throw refuse('unlinkable', 'A link written here would not point to the note.', { target });
  }
  return [{ start, end, text }];
}
