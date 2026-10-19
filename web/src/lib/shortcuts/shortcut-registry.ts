/**
 * The app's single keyboard-shortcut registry (SPEC F22): one `keydown` listener on the window,
 * every shortcut registered here (the shortcut sheet is generated from `listShortcuts()`).
 * `Esc` is not registered: overlays handle it themselves.
 */
import { matchesKeys, parseKeys, type ParsedKeys } from './shortcut-keys';

export interface ShortcutDefinition {
  id: string;
  /** e.g. `Alt+W`, `Ctrl+K`, `Alt+[`. */
  keys: string;
  run: (event: KeyboardEvent) => void;
  /** Also fire while typing in an `<input>`/`<textarea>`/`<select>` (default: no). */
  allowInInputs?: boolean;
  /** i18n key naming the action (shortcut sheet, menus). */
  labelKey: string;
}

export interface ShortcutInfo {
  id: string;
  keys: string;
  labelKey: string;
}

interface Entry extends ShortcutDefinition {
  parsed: ParsedKeys;
}

const entries = new Map<string, Entry>();
let suspended = 0;

/** Registers (or replaces, by id) a shortcut. Returns the unregister function. */
export function registerShortcut(definition: ShortcutDefinition): () => void {
  const entry: Entry = { ...definition, parsed: parseKeys(definition.keys) };
  entries.delete(definition.id);
  entries.set(definition.id, entry);
  return () => {
    if (entries.get(definition.id) === entry) entries.delete(definition.id);
  };
}

export function listShortcuts(): ShortcutInfo[] {
  return [...entries.values()].map(({ id, keys, labelKey }) => ({ id, keys, labelKey }));
}

/**
 * Modal overlays (dialogs, palettes) suspend global shortcuts while open, so raw typing in them
 * never triggers app actions. Returns the resume function; nested calls are counted.
 */
export function suspendShortcuts(): () => void {
  suspended += 1;
  let resumed = false;
  return () => {
    if (resumed) return;
    resumed = true;
    suspended -= 1;
  };
}

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range']);

/** Plain form fields expect raw typing; the rich-text editor (contenteditable) does not count. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(target.type);
}

/** Runs the matching shortcut, if any. Returns true when one ran. */
export function handleShortcutKeydown(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.repeat) return false;
  const typing = isTypingTarget(event.target);
  // Later registrations win, so a screen can override an app-wide binding.
  for (const entry of [...entries.values()].reverse()) {
    if (!matchesKeys(event, entry.parsed)) continue;
    if (suspended > 0 || (typing && !entry.allowInInputs)) return false;
    event.preventDefault();
    entry.run(event);
    return true;
  }
  return false;
}

let installs = 0;

/** Installs the window listener (counted, so StrictMode double effects are harmless). */
export function installShortcutListener(target: Window = window): () => void {
  if (installs === 0) target.addEventListener('keydown', handleShortcutKeydown);
  installs += 1;
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    installs -= 1;
    if (installs === 0) target.removeEventListener('keydown', handleShortcutKeydown);
  };
}

/** Test helper. */
export function resetShortcuts(): void {
  entries.clear();
  suspended = 0;
}
