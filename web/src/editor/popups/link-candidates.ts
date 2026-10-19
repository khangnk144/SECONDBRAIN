import type { LinkTargetFile, LinkTargetNote } from '../../lib/api/link-targets-types';
import type { VaultPath } from '../../lib/api/vault-types';
import { foldText } from '../../lib/fold-text';
import { parentFolder } from '../../lib/vault-paths';
import { pathFormTarget } from '../link-actions';

export interface LinkCandidate {
  path: VaultPath;
  title: string;
  /** Parent folder shown next to the title ('' at the vault root). */
  folder: string;
  /** What the link will hold: the title, or the path form when the title is not unique. */
  target: string;
}

/** `[[Target#Heading|alias` split into its parts; only `search` picks candidates. */
export interface LinkQuery {
  search: string;
  heading: string | null;
  alias: string | null;
}

export function parseLinkQuery(query: string): LinkQuery {
  const pipe = query.indexOf('|');
  const targetPart = pipe === -1 ? query : query.slice(0, pipe);
  const alias = pipe === -1 ? null : query.slice(pipe + 1).trim() || null;
  const hash = targetPart.indexOf('#');
  const heading = hash === -1 ? null : targetPart.slice(hash + 1).trim() || null;
  const search = (hash === -1 ? targetPart : targetPart.slice(0, hash)).trim();
  return { search, heading, alias };
}

interface Indexed {
  candidate: LinkCandidate;
  folded: string;
  words: string[];
  compact: string;
}

const indexCache = new WeakMap<object, Indexed[]>();
const collator = new Intl.Collator('vi', { numeric: true });

function indexed(key: object, build: () => LinkCandidate[]): Indexed[] {
  let index = indexCache.get(key);
  if (!index) {
    index = build().map((candidate) => {
      const folded = foldText(candidate.title);
      return {
        candidate,
        folded,
        words: folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean),
        compact: folded.replace(/\s+/g, ''),
      };
    });
    indexCache.set(key, index);
  }
  return index;
}

function noteCandidates(notes: readonly LinkTargetNote[]): LinkCandidate[] {
  // Templates are not reachable by title (SPEC §4.2), so they are not offered.
  return notes
    .filter((note) => note.class !== 'template')
    .map((note) => ({
      path: note.path,
      title: note.title,
      folder: parentFolder(note.path),
      target: note.unique ? note.title : pathFormTarget(note.path),
    }));
}

function fileCandidates(files: readonly LinkTargetFile[]): LinkCandidate[] {
  const counts = new Map<string, number>();
  for (const file of files)
    counts.set(foldText(file.name), (counts.get(foldText(file.name)) ?? 0) + 1);
  return files.map((file) => ({
    path: file.path,
    title: file.name,
    folder: parentFolder(file.path),
    target: counts.get(foldText(file.name)) === 1 ? file.name : file.path,
  }));
}

/** 0 exact, 1 prefix, 2 every word starts a title word, 3 every word inside, 4 letters in order. */
function score(entry: Indexed, folded: string, words: string[], compact: string): number | null {
  if (entry.folded === folded) return 0;
  if (entry.folded.startsWith(folded)) return 1;
  if (words.every((w) => entry.words.some((t) => t.startsWith(w)))) return 2;
  if (words.every((w) => entry.folded.includes(w))) return 3;
  let at = 0;
  for (const ch of compact) {
    at = entry.compact.indexOf(ch, at);
    if (at === -1) return null;
    at += 1;
  }
  return 4;
}

/**
 * Best link targets for what was typed after `[[` (F4.1): diacritic-insensitive (`giai tich` →
 * "Giải tích 1"), fuzzy, top `limit`. Embeds (`![[`) also offer non-note files.
 */
export function rankLinkCandidates(
  notes: readonly LinkTargetNote[],
  files: readonly LinkTargetFile[],
  search: string,
  embed: boolean,
  limit = 8,
): LinkCandidate[] {
  const pool = indexed(notes, () => noteCandidates(notes));
  const all = embed ? [...pool, ...indexed(files, () => fileCandidates(files))] : pool;
  const folded = foldText(search).trim();
  const words = folded.split(/\s+/).filter(Boolean);
  const compact = folded.replace(/\s+/g, '');
  const scored: { entry: Indexed; score: number }[] = [];
  for (const entry of all) {
    const value = folded === '' ? 3 : score(entry, folded, words, compact);
    if (value !== null) scored.push({ entry, score: value });
  }
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      a.entry.candidate.title.length - b.entry.candidate.title.length ||
      collator.compare(a.entry.candidate.title, b.entry.candidate.title),
  );
  return scored.slice(0, limit).map((s) => s.entry.candidate);
}

/** True when a note (or, for embeds, a file) already has exactly this title. */
export function hasExactTitle(candidates: readonly LinkCandidate[], search: string): boolean {
  const key = search.normalize('NFC').toLowerCase();
  return candidates.some((c) => c.title.normalize('NFC').toLowerCase() === key);
}
