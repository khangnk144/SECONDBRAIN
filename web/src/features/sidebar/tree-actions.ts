/** What the tree does for each row action; shared by mouse, keyboard and the context menu. */
import {
  archiveFolder,
  archiveNote,
  revealInExplorer,
  trashFolder,
  trashNotes,
} from '../../lib/note-operations';
import { startNewNote } from '../../lib/new-note-flow';
import { promptMoveFolder, promptMoveNote, promptNewFolder } from '../../lib/operation-prompts';
import { useTabsStore } from '../../lib/tabs-store';
import type { TreeRow } from './tree-model';

export function openNoteRow(path: string, newTab: boolean): void {
  useTabsStore.getState().openNote(path, { newTab });
}

export function trashRow(row: TreeRow): void {
  if (row.kind === 'note') void trashNotes([row.path]);
  else void trashFolder(row.path, { noteCount: row.noteCount });
}

export function moveRow(row: TreeRow): void {
  if (row.kind === 'note') void promptMoveNote(row.path);
  else void promptMoveFolder(row.path);
}

export function archiveRow(row: TreeRow): void {
  if (row.kind === 'note') void archiveNote(row.path);
  else void archiveFolder(row.path);
}

export function revealRow(row: TreeRow): void {
  void revealInExplorer(row.path, row.kind);
}

export function newNoteInFolder(folder: string): void {
  void startNewNote({ folder });
}

export function newFolderIn(parent: string): void {
  void promptNewFolder(parent);
}
