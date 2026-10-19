/** `Alt+N` / "Ghi chú mới": pick a template (or blank), then create the note. */
import { getTemplates } from './api/tree-api';
import type { TemplateInfo } from './api/tree-types';
import type { VaultPath } from './api/vault-types';
import { templatePickerDialog } from './dialogs/dialog-requests';
import { createNote } from './note-create-operation';
import { CANCELLED, type OperationResult } from './operation-result';
import { useTabsStore } from './tabs-store';
import { INBOX_FOLDER, parentFolder } from './vault-paths';

/** Folder of the note on screen, else `0 Inbox`. */
export function folderForNewNote(): VaultPath {
  const { routeActive, tabs, activeId } = useTabsStore.getState();
  const active = routeActive ? tabs.find((tab) => tab.id === activeId) : undefined;
  return active ? parentFolder(active.path) : INBOX_FOLDER;
}

export async function startNewNote(options: { folder?: VaultPath } = {}): Promise<OperationResult> {
  const folder = options.folder ?? folderForNewNote();
  let templates: TemplateInfo[] = [];
  try {
    templates = (await getTemplates()).templates;
  } catch {
    // Without the template list a blank note is still useful.
  }
  if (templates.length === 0) return createNote({ folder });
  const choice = await templatePickerDialog({ templates });
  if (choice === null) return CANCELLED;
  return createNote({ folder, ...(choice.template ? { template: choice.template } : {}) });
}
