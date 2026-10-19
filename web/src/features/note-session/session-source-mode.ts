/**
 * Source mode (F3.8): the whole file as plain text. Edits there are the text of record and go
 * through the same autosave and revision contract; leaving source mode re-parses the text only
 * when it changed.
 */
import { documentEol } from '../../editor/markdown/markdown-document';
import type { SourceState } from './note-session-types';
import type { SessionCore } from './session-core';
import { displayText, fileTextFromDisplay, sourceBase } from './source-text';

export function makeSourceState(core: SessionCore, fileText: string): SourceState {
  const eol = core.snapshot ? documentEol(core.snapshot) : '\n';
  const base = sourceBase(fileText, eol);
  return { base, display: displayText(base), fileText, entryText: fileText };
}

export function enterSourceMode(core: SessionCore): void {
  if (core.source || core.phase !== 'ready' || core.conflict) return;
  core.source = makeSourceState(core, core.record().text);
  core.emit();
}

export function sourceChanged(core: SessionCore, display: string): void {
  const source = core.source;
  if (!source || core.readOnly || core.conflict || display === source.display) return;
  core.source = { ...source, display, fileText: fileTextFromDisplay(display, source.base) };
  core.markChanged();
}

/** Back to the editor: re-load the document from the source text if it changed. */
export function leaveSourceMode(core: SessionCore): void {
  const source = core.source;
  if (!source) return;
  core.source = null;
  if (source.fileText !== source.entryText) core.loadDoc(source.fileText);
  core.emit();
}
