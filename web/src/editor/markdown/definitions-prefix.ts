/**
 * The definitions prefix of a snapshot after a save. Link-reference and footnote definitions are
 * top-level verbatim blocks; when the set of such blocks changed (one was deleted or pasted), the
 * prefix used to check later partial parses is rebuilt from them.
 */
import { buildDefinitionsPrefix } from './markdown-parser';
import type { MarkdownSnapshot, SourceBlock } from './markdown-snapshot';

const DEFINITION_START = /^ {0,3}\[[^\]\n]+\]:/;

function definitionSources(blocks: readonly SourceBlock[]): string[] {
  const sources: string[] = [];
  for (const block of blocks) {
    if (block.node.type.name !== 'verbatimBlock') continue;
    const source = String(block.node.attrs['source'] ?? '');
    if (DEFINITION_START.test(source)) sources.push(source);
  }
  return sources;
}

export function refreshedDefinitions(
  snapshot: MarkdownSnapshot,
  blocks: readonly SourceBlock[],
): string {
  const before = definitionSources(snapshot.blocks);
  const after = definitionSources(blocks);
  const same = before.length === after.length && before.every((source, i) => source === after[i]);
  return same ? snapshot.definitionsPrefix : buildDefinitionsPrefix(after);
}
