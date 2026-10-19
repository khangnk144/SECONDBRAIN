/**
 * Everything the index stores about one note, derived from its path and content. Markdown goes
 * through the shared parser; clipped HTML pages under `3 Resources` contribute only their text.
 */
import {
  CLASS_RULES,
  classifyPath,
  isNotePath,
  noteTitleFromPath,
} from '../markdown/content-classes.js';
import type { ContentClass, ParsedTask } from '../markdown/markdown-types.js';
import { normalizeForIndex } from '../markdown/normalize-text.js';
import { parseNote } from '../markdown/parse-note.js';
import { isCalendarDate } from '../lib/local-date.js';
import type { NoteRead, VaultPath } from '../vault/vault-types.js';
import { countWords, htmlToText } from './html-text.js';
import { linkTargetKey } from './link-targets.js';

/** Backlink context budget: the line around the link, at most this many characters. */
export const CONTEXT_LENGTH = 160;

export interface LinkRecord {
  kind: 'wikilink' | 'embed' | 'markdown';
  raw: string;
  target: string;
  heading: string | null;
  alias: string | null;
  line: number;
  frontmatterKey: string | null;
  targetKey: string;
  context: string;
}

export interface NoteRecord {
  path: VaultPath;
  title: string;
  titleNorm: string;
  pathNorm: string;
  folder: string;
  cls: ContentClass;
  searchable: boolean;
  type: string | null;
  status: string | null;
  deadline: string | null;
  created: string | null;
  mtimeMs: number;
  size: number;
  revision: string;
  frontmatterJson: string | null;
  frontmatterError: string | null;
  wordCount: number;
  plain: string;
  links: LinkRecord[];
  tags: { tag: string; norm: string }[];
  tasks: ParsedTask[];
}

const HTML_FILE = /\.html?$/i;

/** True for files indexed as rows of `notes`: every `.md`, plus HTML pages among raw sources. */
export function isIndexedAsNote(path: VaultPath): boolean {
  return isNotePath(path) || (HTML_FILE.test(path) && classifyPath(path) === 'source');
}

export function titleForPath(path: VaultPath): string {
  if (isNotePath(path)) return noteTitleFromPath(path);
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.replace(HTML_FILE, '');
}

export function folderOf(path: VaultPath): string {
  const slash = path.indexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/** The line holding a link, cut to the budget around the link (with ellipses where cut). */
export function linkContext(content: string, start: number, end: number): string {
  const lineStart = content.lastIndexOf('\n', start - 1) + 1;
  const newline = content.indexOf('\n', end);
  const line = content
    .slice(lineStart, newline === -1 ? content.length : newline)
    .replace(/\r$/, '');
  if (line.length <= CONTEXT_LENGTH) return line.trim();
  const budget = CONTEXT_LENGTH - 2;
  const linkStart = start - lineStart;
  const linkLength = Math.min(end - start, budget);
  let from = Math.max(0, linkStart - Math.floor((budget - linkLength) / 2));
  const to = Math.min(line.length, from + budget);
  from = Math.max(0, to - budget);
  return `${from > 0 ? '…' : ''}${line.slice(from, to)}${to < line.length ? '…' : ''}`;
}

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : null;

function safeJson(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  try {
    return JSON.stringify(data);
  } catch {
    return null;
  }
}

function baseRecord(
  path: VaultPath,
  read: NoteRead,
): Omit<NoteRecord, 'plain' | 'links' | 'tags' | 'tasks' | 'wordCount'> {
  const title = titleForPath(path);
  const cls = classifyPath(path);
  return {
    path,
    title,
    titleNorm: normalizeForIndex(title),
    pathNorm: normalizeForIndex(path),
    folder: folderOf(path),
    cls,
    searchable: CLASS_RULES[cls].searchable,
    type: null,
    status: null,
    deadline: null,
    created: null,
    mtimeMs: Math.trunc(read.mtimeMs),
    size: read.size,
    revision: read.revision,
    frontmatterJson: null,
    frontmatterError: null,
  };
}

export function buildNoteRecord(path: VaultPath, read: NoteRead): NoteRecord {
  const base = baseRecord(path, read);
  if (!isNotePath(path)) {
    const plain = htmlToText(read.content);
    return { ...base, plain, wordCount: countWords(plain), links: [], tags: [], tasks: [] };
  }
  const parsed = parseNote(read.content);
  const data = parsed.frontmatter.data;
  const seenTags = new Set<string>();
  const tags: NoteRecord['tags'] = [];
  for (const t of parsed.tags) {
    if (seenTags.has(t.norm)) continue;
    seenTags.add(t.norm);
    tags.push({ tag: t.tag, norm: t.norm });
  }
  return {
    ...base,
    type: stringOrNull(data?.type),
    status: stringOrNull(data?.status),
    deadline: isCalendarDate(data?.deadline) ? data.deadline : null,
    created: stringOrNull(data?.created),
    frontmatterJson: safeJson(data),
    frontmatterError: parsed.frontmatter.error,
    wordCount: parsed.wordCount,
    plain: parsed.plainText,
    links: parsed.links.map((l) => ({
      kind: l.kind,
      raw: l.raw,
      target: l.target,
      heading: l.heading,
      alias: l.alias,
      line: l.line,
      frontmatterKey: l.frontmatterKey,
      targetKey: linkTargetKey(l.target),
      context: linkContext(read.content, l.start, l.end),
    })),
    tags,
    tasks: parsed.tasks,
  };
}
