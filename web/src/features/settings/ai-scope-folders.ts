/**
 * The folders AI may read, mirrored from the server's scope rule (`server/src/ai/runtime/ai-scope.ts`):
 * `''` stands for the notes at the vault root; no stored list = root notes and every top folder
 * except the sources, the archive and hidden `.folders`. Templates and attachments are never sent whatever the list
 * says, so they are not offered as a choice (a checked box there would promise something false).
 */
import { pathKey } from '../../lib/vault-paths';

/** Left out of the AI's reading by default (SPEC F18: sources and the archive). */
export const AI_DEFAULT_EXCLUDED = ['3 Resources', '4 Archive'];
const NEVER_SENT = new Set(['templates', 'attachments']);
const EXCLUDED = new Set(AI_DEFAULT_EXCLUDED.map(pathKey));

export const ROOT_NOTES = '';

const isIn = (list: readonly string[], folder: string) =>
  list.some((item) => pathKey(item) === pathKey(folder));

/** The boxes to show: root notes first, then the vault's top folders (never-sent ones left out). */
export function aiScopeChoices(topFolders: readonly string[]): string[] {
  return [ROOT_NOTES, ...topFolders.filter((folder) => !NEVER_SENT.has(pathKey(folder)))];
}

/** The folders AI reads now: the stored list, or the default (never a hidden `.folder`). */
export function effectiveAiFolders(
  stored: readonly string[] | null,
  topFolders: readonly string[],
): string[] {
  if (stored !== null) return [...stored];
  return aiScopeChoices(topFolders).filter(
    (folder) => !EXCLUDED.has(pathKey(folder)) && !folder.startsWith('.'),
  );
}

/**
 * The list to store after one box changed: in the order of the boxes, and keeping any deeper
 * folder stored by other means (it has no box, so it must not get lost).
 */
export function toggledAiFolders(
  chosen: readonly string[],
  choices: readonly string[],
  folder: string,
  on: boolean,
): string[] {
  const next = on
    ? [...chosen, folder]
    : chosen.filter((item) => pathKey(item) !== pathKey(folder));
  const ordered = choices.filter((choice) => isIn(next, choice));
  const others = next.filter((item) => !isIn(choices, item));
  return [...ordered, ...others];
}

/** The default exclusions the chosen list still leaves out (named in the consent dialog). */
export function excludedLeftOut(chosen: readonly string[]): string[] {
  return AI_DEFAULT_EXCLUDED.filter((folder) => !isIn(chosen, folder));
}

export function isChosenFolder(chosen: readonly string[], folder: string): boolean {
  return isIn(chosen, folder);
}
