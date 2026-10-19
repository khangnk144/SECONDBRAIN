/**
 * Chooses how the structure of a note body is computed: the fast line scanner when it can
 * model the note exactly, otherwise the full remark parse (the reference semantics).
 */
import { FullParseRequired } from './fast-block-types.js';
import { fastNoteStructure } from './fast-note-structure.js';
import { mdastNoteStructure } from './mdast-note-structure.js';
import type { NoteStructure } from './note-structure-types.js';

export function noteStructure(content: string, bodyStart: number): NoteStructure {
  try {
    return fastNoteStructure(content, bodyStart);
  } catch (error) {
    if (error instanceof FullParseRequired) return mdastNoteStructure(content, bodyStart);
    throw error;
  }
}
