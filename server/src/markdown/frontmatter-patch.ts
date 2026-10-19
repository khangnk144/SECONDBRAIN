/**
 * Property edits as text patches on the raw file (SPEC §4.3, §4.9, F7). Only the lines of the
 * keys being set or removed change; a new key goes just before the closing fence; a file without
 * front matter gets a new block at the top. Comments, key order, quoting and blank lines elsewhere
 * stay byte-identical, and so does the line-ending style. The result is parsed again and must
 * read back exactly as intended, or nothing is written.
 */
import { isDeepStrictEqual } from 'node:util';
import type { TextRangePatch } from '../vault/vault-types.js';
import { readFrontmatterBlock, refuseFrontmatter } from './frontmatter-key-ranges.js';
import { formatPropertyValue, isPropertyKey } from './frontmatter-values.js';
import { splitFrontmatter } from './frontmatter.js';
import { dominantLineEnding } from './source-lines.js';

export interface FrontmatterEdit {
  /** Keys to write; a `null` value removes the key. */
  set?: Record<string, unknown>;
  unset?: string[];
}

interface NormalizedEdit {
  writes: [string, unknown, string][];
  removals: string[];
}

function normalizeEdit(edit: FrontmatterEdit): NormalizedEdit {
  const set = edit.set ?? {};
  const unset = edit.unset ?? [];
  for (const key of [...Object.keys(set), ...unset]) {
    if (!isPropertyKey(key)) {
      throw refuseFrontmatter('invalid-key', `"${key}" is not a property name the app can write.`);
    }
  }
  if (unset.some((key) => Object.hasOwn(set, key))) {
    throw refuseFrontmatter('invalid-key', 'A property cannot be set and removed at once.');
  }
  const writes: NormalizedEdit['writes'] = [];
  const removals = [...new Set(unset)];
  for (const [key, value] of Object.entries(set)) {
    if (value === null) removals.push(key);
    else writes.push([key, value, formatPropertyValue(key, value)]);
  }
  return { writes, removals };
}

const lineEndingOf = (text: string) => /(\r\n|\n|\r)$/.exec(text)?.[0] ?? '';

/** The patches for `edit` on `content` (empty when nothing changes). Pure; throws VALIDATION. */
export function planFrontmatterPatch(content: string, edit: FrontmatterEdit): TextRangePatch[] {
  const { writes, removals } = normalizeEdit(edit);
  const block = readFrontmatterBlock(content);
  const patches: TextRangePatch[] = [];
  if (block === null) {
    if (writes.length === 0) return [];
    const eol = dominantLineEnding(content);
    const lines = writes.map(([key, , text]) => `${key}: ${text}${eol}`).join('');
    const at = content.charCodeAt(0) === 0xfeff ? 1 : 0;
    patches.push({ start: at, end: at, text: `---${eol}${lines}---${eol}` });
  } else {
    const current = splitFrontmatter(content).frontmatter.data ?? {};
    const added: string[] = [];
    for (const [key, value, text] of writes) {
      // Same value already (maybe spelled differently): leave its bytes alone.
      if (Object.hasOwn(current, key) && isDeepStrictEqual(current[key], value)) continue;
      const lines = block.keys.get(key);
      if (!lines) {
        added.push(`${block.indent}${key}: ${text}${block.eol}`);
        continue;
      }
      const old = content.slice(lines.start, lines.end);
      const indent = /^[ \t]*/.exec(old)![0];
      const replacement = `${indent}${lines.keyText}: ${text}${lines.comment}${lineEndingOf(old)}`;
      if (replacement !== old)
        patches.push({ start: lines.start, end: lines.end, text: replacement });
    }
    for (const key of removals) {
      const lines = block.keys.get(key);
      if (lines) patches.push({ start: lines.start, end: lines.end, text: '' });
    }
    if (added.length > 0) {
      patches.push({ start: block.closeStart, end: block.closeStart, text: added.join('') });
    }
  }
  if (patches.length > 0) verifyPatched(content, applyPatches(content, patches), writes, removals);
  return patches;
}

function applyPatches(content: string, patches: readonly TextRangePatch[]): string {
  let result = '';
  let cursor = 0;
  for (const patch of [...patches].sort((a, b) => a.start - b.start)) {
    result += content.slice(cursor, patch.start) + patch.text;
    cursor = patch.end;
  }
  return result + content.slice(cursor);
}

/** Re-parses the patched text: valid YAML, intended values, every other key and the body intact. */
function verifyPatched(
  before: string,
  after: string,
  writes: NormalizedEdit['writes'],
  removals: string[],
): void {
  const old = splitFrontmatter(before);
  const next = splitFrontmatter(after);
  const data = next.frontmatter.data;
  const oldData = old.frontmatter.data ?? {};
  const ok =
    next.frontmatter.present &&
    next.frontmatter.error === null &&
    data !== null &&
    before.slice(old.bodyStart) === after.slice(next.bodyStart) &&
    writes.every(([key, value]) => isDeepStrictEqual(data[key], value)) &&
    removals.every((key) => !Object.hasOwn(data, key)) &&
    Object.keys(data).every(
      (key) =>
        writes.some(([written]) => written === key) || isDeepStrictEqual(data[key], oldData[key]),
    ) &&
    Object.keys(oldData).every((key) => removals.includes(key) || Object.hasOwn(data, key));
  if (!ok) {
    throw refuseFrontmatter(
      'patch-verify',
      'The property could not be written without changing something else.',
    );
  }
}
