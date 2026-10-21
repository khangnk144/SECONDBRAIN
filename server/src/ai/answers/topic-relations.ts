/**
 * Topics a question can be "about" (S5: "…due this week for Probability?"): in-scope notes of
 * `type: course | project | research`. An item belongs to a topic when its note is the topic
 * note, has `course:` resolving to it, or links to it (SPEC §4.4 resolution, as everywhere), or
 * when the item's title (task text or note title) or its note's title names the topic in plain
 * words ("Nộp bài tập Xác suất thống kê"): whole words, ignoring case and diacritics (đ = d).
 */
import type { IndexService } from '../../index/index-types.js';
import { foldForMatch, linkIdentityKey } from '../../markdown/normalize-text.js';
import { resolveLink } from '../../markdown/resolve-link.js';
import { parseWikilinkInner } from '../../markdown/wikilink-scan.js';
import type { LinkCatalog } from '../../markdown/markdown-types.js';
import type { VaultPath } from '../../vault/vault-types.js';

export const MAX_TOPICS = 200;
const TOPIC_TYPES = new Set(['course', 'project', 'research']);

export interface TopicNote {
  path: VaultPath;
  title: string;
}

/** In-scope topic notes, most recently modified first, at most MAX_TOPICS. */
export function topicNotes(
  index: Pick<IndexService, 'listNotes'>,
  inScope: (path: VaultPath) => boolean,
): TopicNote[] {
  return index
    .listNotes()
    .filter((note) => TOPIC_TYPES.has(note.type?.trim().toLowerCase() ?? '') && inScope(note.path))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || (a.path < b.path ? -1 : 1))
    .slice(0, MAX_TOPICS)
    .map((note) => ({ path: note.path, title: note.title }));
}

/** Distinct titles of the topics (what the intent prompt offers). */
export function topicTitles(topics: readonly TopicNote[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const topic of topics) {
    const key = linkIdentityKey(topic.title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(topic.title);
  }
  return out;
}

/** Paths of the topics whose titles were chosen (a shared title selects every such note). */
export function topicPathsFor(
  titles: readonly string[],
  topics: readonly TopicNote[],
): VaultPath[] {
  const wanted = new Set(titles.map(linkIdentityKey));
  return topics.filter((topic) => wanted.has(linkIdentityKey(topic.title))).map((t) => t.path);
}

/** `course: "[[Xác suất]]"`, `course: Xác suất`, or a list of those → link targets. */
function courseTargets(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const entry of values) {
    if (typeof entry !== 'string' || entry.trim() === '') continue;
    const text = entry.trim();
    const wrapped = /^!?\[\[(.*)\]\]$/s.exec(text);
    const target = wrapped ? parseWikilinkInner(wrapped[1]!)?.target : text;
    if (target) out.push(target);
  }
  return out;
}

/** An item of a structured answer, as far as the topic test needs it. */
export interface TopicItem {
  path: VaultPath;
  /** Task text, or the note's title for a note item. */
  title: string;
  noteTitle: string;
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Folded for matching (no case, no diacritics, đ → d), whitespace runs as one space. */
const foldWords = (text: string): string => foldForMatch(text).replace(/\s+/g, ' ').trim();

/** Whether `needle` occurs in `haystack` with no letter or digit right before or after it. */
export function containsWords(haystack: string, needle: string): boolean {
  if (needle === '') return false;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    const before = at === 0 ? '' : haystack[at - 1]!;
    const after = haystack[at + needle.length] ?? '';
    if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after)) return true;
  }
  return false;
}

/**
 * Memoized "does this item belong to one of these topics?" test: the note-level relation per
 * path (topic note, `course:`, link), then the topic titles as whole words in the item's titles.
 */
export function topicRelation(
  index: Pick<IndexService, 'outlinks' | 'getNote' | 'linkCatalog'>,
  topicPaths: readonly VaultPath[],
  titles: readonly string[],
): (item: TopicItem) => boolean {
  const byNote = noteRelation(index, topicPaths);
  const words = [...new Set(titles.map(foldWords))].filter((title) => title !== '');
  const named = (text: string) => {
    const folded = foldWords(text);
    return words.some((title) => containsWords(folded, title));
  };
  return (item) => byNote(item.path) || named(item.title) || named(item.noteTitle);
}

function noteRelation(
  index: Pick<IndexService, 'outlinks' | 'getNote' | 'linkCatalog'>,
  topicPaths: readonly VaultPath[],
): (path: VaultPath) => boolean {
  const topics = new Set(topicPaths);
  const memo = new Map<VaultPath, boolean>();
  let catalog: LinkCatalog | null = null;
  const viaCourse = (path: VaultPath) => {
    const course = index.getNote(path)?.frontmatter?.course;
    if (course === undefined) return false;
    catalog ??= index.linkCatalog();
    return courseTargets(course).some((target) => {
      const resolution = resolveLink(catalog!, { kind: 'wikilink', target }, path);
      return resolution.status === 'resolved' && topics.has(resolution.path);
    });
  };
  return (path) => {
    const known = memo.get(path);
    if (known !== undefined) return known;
    const related =
      topics.has(path) ||
      index.outlinks(path).some((link) => link.toPath !== null && topics.has(link.toPath)) ||
      viaCourse(path);
    memo.set(path, related);
    return related;
  };
}
