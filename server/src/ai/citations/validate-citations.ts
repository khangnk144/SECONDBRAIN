/**
 * Server-side citation check (SPEC F33 "Citations", F33.2), run on the finished answer:
 * - `[S<n>]` markers of provided sources become links (`[[path|title]]`, PDFs `[[file]] (tr. n)`);
 *   unknown markers are removed and reported;
 * - `[[…]]` links the model wrote stay only when they resolve (§4.4) to a path of the retrieved
 *   set or the structured items; otherwise they become their plain text and are reported.
 */
import { noteTitleFromPath, isNotePath } from '../../markdown/content-classes.js';
import type { LinkCatalog } from '../../markdown/markdown-types.js';
import { resolveLink } from '../../markdown/resolve-link.js';
import { scanWikilinks, type WikilinkHit } from '../../markdown/wikilink-scan.js';
import type { VaultPath } from '../../vault/vault-types.js';
import type { AnswerLanguage } from '../prompts/answer-language.js';
import type { RetrievedSource } from '../retrieval/retrieval-types.js';
import { noteLink, sourceFileLink } from './link-format.js';

export interface Citation {
  path: VaultPath;
  title: string;
  page: number | null;
}

export interface CitationContext {
  sources: readonly RetrievedSource[];
  /** Paths a model-written link may point to: retrieved notes/sources and structured items. */
  allowedPaths: ReadonlySet<VaultPath>;
  catalog: LinkCatalog;
  /** Where links are resolved from (the current note, else the vault root). */
  fromPath: VaultPath;
  language: AnswerLanguage;
}

export interface CitationResult {
  answer: string;
  citations: Citation[];
  /** Markers (`S9`) and link targets (`1 Projects/Bí mật.md`) that were not accepted. */
  rejected: string[];
}

const MARKER = /(\s?)\[\s*(S\d{1,3}(?:\s*[,;]\s*S\d{1,3})*)\s*\]/gi;
/** `[[S1]]` is a marker written like a link. */
const LINKED_MARKER = /\[\[\s*(S\d{1,3})\s*\]\]/gi;

function plainText(hit: WikilinkHit): string {
  if (hit.alias) return hit.alias;
  if (hit.target === '') return hit.heading ?? '';
  return noteTitleFromPath(hit.target.slice(hit.target.lastIndexOf('/') + 1));
}

/**
 * One pass over the `[[…]]` links of `text`: a link the server wrote itself (`own`) or one that
 * resolves to an allowed path stays, any other becomes its plain text. Backslash escapes are not
 * honoured: the answer view shows `\[[x]]` as a link too, so it is checked like any other.
 */
function checkLinks(
  text: string,
  context: CitationContext,
  own: ReadonlySet<string>,
  keep: (path: VaultPath) => void,
  rejected: string[],
): { text: string; changed: boolean } {
  const hits: WikilinkHit[] = [];
  scanWikilinks(text, 0, text.length, (hit) => hits.push(hit), false);
  let out = '';
  let last = 0;
  let changed = false;
  for (const hit of hits) {
    out += text.slice(last, hit.start);
    last = hit.end;
    if (own.has(text.slice(hit.kind === 'embed' ? hit.start + 1 : hit.start, hit.end))) {
      out += text.slice(hit.start, hit.end);
      continue;
    }
    const resolution =
      hit.target === ''
        ? null
        : resolveLink(context.catalog, { kind: 'wikilink', target: hit.target }, context.fromPath);
    if (resolution?.status === 'resolved' && context.allowedPaths.has(resolution.path)) {
      out += text.slice(hit.start, hit.end);
      keep(resolution.path);
    } else {
      out += plainText(hit);
      rejected.push(hit.target || `#${hit.heading ?? ''}`);
      changed = true;
    }
  }
  return { text: out + text.slice(last), changed };
}

export function validateCitations(text: string, context: CitationContext): CitationResult {
  const citations: Citation[] = [];
  const rejected: string[] = [];
  const cite = (path: VaultPath, title: string, page: number | null) => {
    if (!citations.some((c) => c.path === path && c.page === page)) {
      citations.push({ path, title, page });
    }
  };
  const keep = (path: VaultPath) => cite(path, noteTitleFromPath(path), null);
  const own = new Set<string>();

  // 1. Links the model wrote itself.
  const out = checkLinks(text.replace(LINKED_MARKER, '[$1]'), context, own, keep, rejected).text;

  // 2. Citation markers.
  const byId = new Map(context.sources.map((source) => [source.id.toUpperCase(), source]));
  let answer = out.replace(MARKER, (_match, space: string, list: string) => {
    const links: string[] = [];
    for (const raw of list.split(/[,;]/)) {
      const id = raw.trim().toUpperCase();
      const source = byId.get(id);
      if (!source) {
        rejected.push(id);
        continue;
      }
      const link = isNotePath(source.path)
        ? noteLink(source.path, source.title)
        : sourceFileLink(
            source.path,
            source.page,
            uniqueName(context, source.path),
            context.language,
          );
      if (!links.includes(link)) links.push(link);
      own.add(link.replace(/ \((?:tr|p)\. \d+\)$/, ''));
      cite(source.path, source.title, source.page);
    }
    return links.length === 0 ? '' : `${space}${links.join(', ')}`;
  });

  // 3. A rejected link's text or a removed marker can join the brackets around it into a new
  // link (`[` + `[x]]`): check the result again until a pass changes nothing (each one shortens).
  for (;;) {
    const next = checkLinks(answer, context, own, keep, rejected);
    if (!next.changed) break;
    answer = next.text;
  }
  return { answer, citations, rejected };
}

/** Whether `[[file name]]` alone resolves to exactly this file. */
function uniqueName(context: CitationContext, path: VaultPath): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const resolution = resolveLink(
    context.catalog,
    { kind: 'wikilink', target: name },
    context.fromPath,
  );
  return resolution.status === 'resolved' && resolution.path === path;
}
