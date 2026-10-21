/**
 * `parseNote`: everything the index needs from one note (SPEC §4.3–§4.7). Pure: no file system.
 * A structure pass (code/HTML ranges, Markdown links, tasks, headings, block text) is followed
 * by raw-text scans for wikilinks and tags outside the excluded ranges, so `[[x]]` and `#tag`
 * inside code or HTML never count and every reported offset points into the original text.
 */
import { frontmatterTags, scanInlineTags } from './inline-tags.js';
import { scanFrontmatterLinks } from './frontmatter-links.js';
import { splitFrontmatter } from './frontmatter.js';
import { markdownLinkTarget } from './markdown-link-target.js';
import type { ParsedLink, ParsedNote, ParsedTag } from './markdown-types.js';
import { noteStructure } from './note-structure.js';
import { mergeSpans, type NoteStructure, type TextSpan } from './note-structure-types.js';
import { buildLineStarts, dominantLineEnding, lineOfOffset } from './source-lines.js';
import { forEachBodyWikilink, taskTokenMask } from './task-token-mask.js';
import { taskAtCheckbox } from './task-tokens.js';
import { countWords } from './unicode-classes.js';

export type StructureProducer = (content: string, bodyStart: number) => NoteStructure;

export function parseNote(content: string): ParsedNote {
  return parseNoteUsing(content, noteStructure);
}

/** `parseNote` with an explicit structure pass (lets tests compare the fast and full parsers). */
export function parseNoteUsing(content: string, produceStructure: StructureProducer): ParsedNote {
  const { frontmatter, yamlStart, bodyStart } = splitFrontmatter(content);
  const lineStarts = buildLineStarts(content);
  const structure = produceStructure(content, bodyStart);

  const links: ParsedLink[] = frontmatter.raw
    ? scanFrontmatterLinks(content, yamlStart, frontmatter.raw, lineStarts)
    : [];
  collectBodyWikilinks(content, bodyStart, structure.excluded, lineStarts, links);
  collectMarkdownLinks(content, structure, lineStarts, links);
  links.sort((a, b) => a.start - b.start);

  const tags: ParsedTag[] = [
    ...frontmatterTags(frontmatter.data, tagsKeyLine(frontmatter.raw, frontmatter.startLine)),
    ...scanInlineTags(content, bodyStart, withWikilinks(structure.excluded, links), lineStarts),
  ];

  // Date tokens inside code, HTML, wikilinks and Markdown links are not task dates.
  const taskMask =
    structure.tasks.length > 0 ? taskTokenMask(content, structure, bodyWikilinks(links)) : [];
  const plainText = structure.blocks
    .map((block) => block.trim())
    .filter((block) => block !== '')
    .join('\n');

  return {
    frontmatter,
    links,
    tags,
    tasks: structure.tasks.map((task) =>
      taskAtCheckbox(content, lineStarts, taskMask, task.checkbox, task.checked),
    ),
    headings: structure.headings.map((heading) => ({
      depth: heading.depth,
      text: heading.text.trim(),
      line: lineOfOffset(lineStarts, heading.start),
    })),
    plainText,
    wordCount: countWords(plainText),
    lineEnding: dominantLineEnding(content),
  };
}

function collectBodyWikilinks(
  content: string,
  bodyStart: number,
  excluded: readonly TextSpan[],
  lineStarts: readonly number[],
  out: ParsedLink[],
): void {
  forEachBodyWikilink(content, bodyStart, excluded, (hit) => {
    out.push({
      kind: hit.kind,
      raw: content.slice(hit.start, hit.end),
      target: hit.target,
      heading: hit.heading,
      alias: hit.alias,
      start: hit.start,
      end: hit.end,
      line: lineOfOffset(lineStarts, hit.start),
      frontmatterKey: null,
    });
  });
}

const isBodyWikilink = (link: ParsedLink) =>
  link.kind !== 'markdown' && link.frontmatterKey === null;

function bodyWikilinks(links: readonly ParsedLink[]): ParsedLink[] {
  return links.filter(isBodyWikilink);
}

/** Excluded spans plus every body wikilink: `[[B| #x]]` holds no tag. */
function withWikilinks(excluded: readonly TextSpan[], links: readonly ParsedLink[]): TextSpan[] {
  const spans = excluded.map((span) => ({ start: span.start, end: span.end }));
  for (const link of links) {
    if (isBodyWikilink(link)) spans.push({ start: link.start, end: link.end });
  }
  return mergeSpans(spans);
}

function collectMarkdownLinks(
  content: string,
  structure: NoteStructure,
  lineStarts: readonly number[],
  out: ParsedLink[],
): void {
  for (const link of structure.links) {
    const resolved = markdownLinkTarget(link.url);
    if (!resolved) continue;
    out.push({
      kind: 'markdown',
      raw: content.slice(link.start, link.end),
      target: resolved.target,
      heading: resolved.heading,
      alias: null,
      start: link.start,
      end: link.end,
      line: lineOfOffset(lineStarts, link.start),
      frontmatterKey: null,
    });
  }
}

/** Line of the `tags:` key in the YAML block (the opening fence line when not found). */
function tagsKeyLine(raw: string | null, startLine: number): number {
  if (raw === null) return startLine;
  const index = raw.split(/\r\n|\n|\r/).findIndex((line) => /^tags[ \t]*:/.test(line));
  return index === -1 ? startLine : startLine + 1 + index;
}
