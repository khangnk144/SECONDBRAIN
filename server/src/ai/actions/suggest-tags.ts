/**
 * "Gợi ý thẻ" (SPEC F33, R1): the 200 tags used most in in-scope notes are offered; at most 5
 * come back, normalized to the tag syntax of SPEC §4.5 (Unicode letters, digits, `-`, `_`, `/`;
 * spaces → `-`; lower case). A tag the vault already uses is returned in her spelling and listed
 * first; tags the note or the selection already carry are left out.
 */
import { CLASS_RULES } from '../../markdown/content-classes.js';
import { foldForMatch } from '../../markdown/normalize-text.js';
import type { VaultPath } from '../../vault/vault-types.js';
import { extractJsonObject } from '../intent/intent-validate.js';
import { suggestTagsSystem } from '../prompts/action-prompts.js';
import { detectLanguage } from '../prompts/answer-language.js';
import { dataBlock } from '../prompts/data-blocks.js';
import {
  PROMPT_TEXT_CHARS,
  unusableReply,
  type ActionDeps,
  type TagSuggestion,
} from './action-types.js';

const OFFERED_TAGS = 200;
const MAX_TAGS = 5;
const MAX_TAG_LENGTH = 60;
const INLINE_TAG = /(?:^|[^\p{L}\p{N}_&/])#([\p{L}\p{N}\p{M}_\-/]+)/gu;

/** SPEC §4.5 form of a proposed tag, or null when nothing usable is left. */
export function normalizeTag(raw: string): string | null {
  const tag = raw
    .normalize('NFC')
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}\p{M}_\-/]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/\/{2,}/g, '/')
    .replace(/^[-/]+|[-/]+$/g, '');
  if (!/\p{L}/u.test(tag) || [...tag].length > MAX_TAG_LENGTH) return null;
  return tag;
}

/** Every tag of in-scope searchable notes, most used first (display form = first spelling seen). */
export function inScopeTags(deps: Pick<ActionDeps, 'index' | 'runtime'>): string[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const note of deps.index.listNotes()) {
    if (!CLASS_RULES[note.class].searchable || !deps.runtime.inScope(note.path)) continue;
    for (const tag of new Set(deps.index.noteTags(note.path))) {
      const key = foldForMatch(tag);
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { tag, count: 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || foldForMatch(a.tag).localeCompare(foldForMatch(b.tag)))
    .map((entry) => entry.tag);
}

export async function suggestTags(
  text: string,
  path: VaultPath | null,
  deps: ActionDeps,
): Promise<{ tags: TagSuggestion[] }> {
  const known = inScopeTags(deps);
  const offered = known.slice(0, OFFERED_TAGS);
  const knownByKey = new Map(known.map((tag) => [foldForMatch(tag), tag]));
  const carried = new Set<string>();
  if (path) for (const tag of deps.index.noteTags(path)) carried.add(foldForMatch(tag));
  for (const match of text.matchAll(INLINE_TAG)) carried.add(foldForMatch(match[1]!));

  const language = detectLanguage(text, deps.uiLanguage);
  const reply = await deps.runtime.complete({
    purpose: 'action',
    json: true,
    maxTokens: 300,
    temperature: 0,
    system: suggestTagsSystem(language),
    messages: [
      {
        role: 'user',
        content: `${dataBlock('text', text.slice(0, PROMPT_TEXT_CHARS))}\n\n${dataBlock('tags', offered.map((t) => `#${t}`).join(' ') || '(none)')}`,
      },
    ],
    signal: deps.signal,
  });
  const parsed = extractJsonObject(reply.text) as { tags?: unknown } | undefined;
  if (!parsed || !Array.isArray(parsed.tags)) throw unusableReply('malformed');
  const out: TagSuggestion[] = [];
  const seen = new Set<string>();
  for (const raw of parsed.tags as unknown[]) {
    if (typeof raw !== 'string') continue;
    const tag = normalizeTag(raw);
    if (tag === null) continue;
    const key = foldForMatch(tag);
    if (seen.has(key) || carried.has(key)) continue;
    seen.add(key);
    const existing = knownByKey.get(key);
    out.push(existing ? { tag: existing, existing: true } : { tag, existing: false });
  }
  // Existing tags first (stable), then new ones; at most five in all.
  const ordered = [...out.filter((t) => t.existing), ...out.filter((t) => !t.existing)];
  return { tags: ordered.slice(0, MAX_TAGS) };
}
