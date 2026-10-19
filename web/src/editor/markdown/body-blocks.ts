/**
 * Parses a body text (any line endings) into top-level source blocks. Shared by `loadMarkdown`
 * and by the save check, which re-parses the written text around every change.
 */
import type { Schema } from '@tiptap/pm/model';
import { normalizeLineEndings } from './line-endings';
import { parseMarkdown } from './markdown-parser';
import { buildTopLevelBlocks, type TopLevelBlocks } from './top-level-blocks';

export interface ParsedBody extends TopLevelBlocks {
  definitionsPrefix: string;
}

export function parseBody(body: string, schema: Schema, definitionsPrefix?: string): ParsedBody {
  const normalized = normalizeLineEndings(body);
  const parsed = parseMarkdown(normalized.text, { definitionsPrefix });
  const source = { text: normalized.text, original: body, toOriginal: normalized.toOriginal };
  return {
    ...buildTopLevelBlocks(parsed.root, source, schema),
    definitionsPrefix: parsed.definitionsPrefix,
  };
}
