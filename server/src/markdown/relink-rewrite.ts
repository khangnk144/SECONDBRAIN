/**
 * The replacement text for one wikilink during relink, and the check that the rewritten note
 * really links where intended. A new target can contain characters that are syntax (`#`, `|`,
 * `]`, a backtick…) or that YAML would read differently, so unless the text is plainly safe the
 * whole note is re-parsed and the link must come back unchanged except for its target.
 */
import type { VaultPath } from '../vault/vault-types.js';
import { frontmatterLinkQuote } from './frontmatter-links.js';
import type { LinkCatalog, ParsedLink, ParsedNote } from './markdown-types.js';
import { parseNote } from './parse-note.js';
import { resolveLink } from './resolve-link.js';
import { parseWikilinkInner } from './wikilink-scan.js';
import { encodeYamlQuoted, needsYamlQuoting } from './yaml-scalar-context.js';

/** Characters that can neither start nor end Markdown, wikilink or YAML syntax. */
const SAFE_TARGET = /^[^[\]|#`<>\\&!*_~$%:'",{}@\r\n]*$/u;

export interface RewriteContext {
  after: LinkCatalog;
  pathAfter: VaultPath;
  /** Whether the note's front matter parsed before any edit (then it must keep parsing). */
  frontmatterValid: boolean;
}

export interface Rewrite {
  /** Text that replaces `link.raw` (may add YAML quotes around it). */
  text: string;
  content: string;
  /** Links of `content` (only when it was re-parsed). */
  links: ParsedLink[] | null;
}

/**
 * Rewrites `link` (found in `content`, whose links are `links`) to `target` and returns the new
 * note text, or null when the result would not be the same link pointing at `expected`.
 */
export function rewriteLinkTarget(
  content: string,
  links: readonly ParsedLink[],
  link: ParsedLink,
  target: string,
  expected: VaultPath,
  context: RewriteContext,
): Rewrite | null {
  const innerStart = link.kind === 'embed' ? 3 : 2;
  const parts = parseWikilinkInner(link.raw.slice(innerStart, -2));
  if (!parts) return null;
  const quote = link.frontmatterKey === null ? 'plain' : frontmatterLinkQuote(content, link);
  const encoded = encodeYamlQuoted(target, quote);
  let raw =
    link.raw.slice(0, innerStart + parts.targetStart) +
    encoded +
    link.raw.slice(innerStart + parts.targetEnd);
  const wrap = link.frontmatterKey !== null && quote === 'plain' && needsYamlQuoting(target);
  const text = wrap ? `"${encodeYamlQuoted(raw, 'double')}"` : raw;
  if (wrap) raw = encodeYamlQuoted(raw, 'double');
  const next = content.slice(0, link.start) + text + content.slice(link.end);
  if (SAFE_TARGET.test(target) && !wrap) {
    const resolution = resolveLink(context.after, { kind: link.kind, target }, context.pathAfter);
    const ok = resolution.status === 'resolved' && resolution.path === expected;
    return ok ? { text, content: next, links: null } : null;
  }
  const note = parseNote(next);
  if (
    !sameNoteExceptLink(
      note,
      links,
      link,
      raw,
      wrap ? 1 : 0,
      text.length - link.raw.length,
      context,
    )
  ) {
    return null;
  }
  const rewritten = note.links.find((l) => l.start === link.start + (wrap ? 1 : 0)) as ParsedLink;
  const resolution = resolveLink(context.after, rewritten, context.pathAfter);
  if (resolution.status !== 'resolved' || resolution.path !== expected) return null;
  return { text, content: next, links: note.links };
}

/**
 * The re-parsed note must have the same links as before, with the rewritten one keeping its
 * kind, heading, alias and property key, and the YAML must still parse.
 */
function sameNoteExceptLink(
  note: ParsedNote,
  before: readonly ParsedLink[],
  link: ParsedLink,
  raw: string,
  shift: number,
  delta: number,
  context: RewriteContext,
): boolean {
  if (context.frontmatterValid && note.frontmatter.present && note.frontmatter.error !== null) {
    return false;
  }
  if (note.links.length !== before.length) return false;
  return note.links.every((current, i) => {
    const old = before[i] as ParsedLink;
    if (old.start === link.start) {
      return (
        current.start === link.start + shift &&
        current.raw === raw &&
        current.kind === old.kind &&
        current.heading === old.heading &&
        current.alias === old.alias &&
        current.frontmatterKey === old.frontmatterKey
      );
    }
    const start = old.start > link.start ? old.start + delta : old.start;
    return current.start === start && current.raw === old.raw;
  });
}
