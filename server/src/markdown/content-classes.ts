/**
 * Content classes (SPEC §4.2): every vault file belongs to exactly one class, and the class
 * decides whether it is searched, counted for tasks/deadlines, drawn in the graph and reminded.
 * All views use this table; none invents its own rule.
 */
import type { VaultPath } from '../vault/vault-types.js';
import type { ContentClass } from './markdown-types.js';

export interface ClassRule {
  searchable: boolean;
  tasksCounted: boolean;
  /** `dimmed` = shown faded; `linked-only` = a node only when some note links to it. */
  graphNode: 'yes' | 'dimmed' | 'linked-only' | 'no';
  reminders: boolean;
}

export const CLASS_RULES: Readonly<Record<ContentClass, Readonly<ClassRule>>> = {
  user: { searchable: true, tasksCounted: true, graphNode: 'yes', reminders: true },
  archived: { searchable: true, tasksCounted: false, graphNode: 'dimmed', reminders: false },
  template: { searchable: false, tasksCounted: false, graphNode: 'no', reminders: false },
  source: { searchable: true, tasksCounted: false, graphNode: 'linked-only', reminders: false },
  wiki: { searchable: true, tasksCounted: false, graphNode: 'yes', reminders: false },
  control: { searchable: true, tasksCounted: false, graphNode: 'no', reminders: false },
  attachment: {
    searchable: false,
    tasksCounted: false,
    graphNode: 'linked-only',
    reminders: false,
  },
};

// Folder names compared after NFC + lowercase: Windows treats `templates` and `Templates`
// as the same folder, so the class must not depend on the case the user typed.
const RESOURCES = '3 resources';
const ARCHIVE = '4 archive';
const TEMPLATES = 'templates';
const ATTACHMENTS = 'attachments';
const WIKI = 'wiki';
const WIKI_CONTROL_DOCS = new Set(['index.md', 'log.md']);
const ROOT_CONTROL_DOC = 'claude.md';

function folded(segment: string): string {
  return segment.normalize('NFC').toLowerCase();
}

/** `.md` file (case-insensitive extension): the only files that are notes. */
export function isNotePath(path: VaultPath): boolean {
  return /\.md$/i.test(path);
}

/** File name without `.md` (other files keep their extension): the note title of SPEC §4.1. */
export function noteTitleFromPath(path: VaultPath): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return isNotePath(name) ? name.slice(0, -3) : name;
}

/** First path segment (the "folder" of SPEC §4.1); '' for files at the vault root. */
export function topFolderOfPath(path: VaultPath): string {
  const slash = path.indexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

export function classifyPath(path: VaultPath): ContentClass {
  const segments = path.split('/');
  const top = folded(segments[0] ?? '');
  const isNote = isNotePath(path);
  if (segments.length === 1) {
    if (!isNote) return 'attachment';
    return top === ROOT_CONTROL_DOC ? 'control' : 'user';
  }
  if (top === RESOURCES) return 'source';
  if (top === ATTACHMENTS || !isNote) return 'attachment';
  if (top === ARCHIVE) return 'archived';
  if (top === TEMPLATES) return 'template';
  if (top === WIKI) {
    const isControl = segments.length === 2 && WIKI_CONTROL_DOCS.has(folded(segments[1] ?? ''));
    return isControl ? 'control' : 'wiki';
  }
  return 'user';
}
