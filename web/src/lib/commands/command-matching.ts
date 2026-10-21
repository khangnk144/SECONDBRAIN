/**
 * Which commands a typed text names, best first. Every word typed must start a word of the
 * command's label (in the current language) or of its keywords, ignoring case and diacritics
 * (`mo lich` finds "Mở Lịch", `an/hien` finds "Ẩn/hiện ngăn trái").
 *
 * Ranking, so typing a command's own name runs that command and not a longer one that shares its
 * words ("mở hôm nay" is "Mở Hôm nay", not "Mở ghi chú hôm nay"):
 * 1. the label is exactly the text;
 * 2. the label starts with the text;
 * 3. every typed word starts a word of the label;
 * 4. some typed word only starts a keyword.
 * Within a tier, a label with fewer words the text did not name comes first (`today` is "Open
 * Today" before "Open today's note"); registry order breaks the remaining ties.
 */
import { foldText } from '../fold-text';
import type { AppCommand } from './command-registry';

const WORD_SEPARATORS = /[\s/,.()'"–-]+/u;

const words = (text: string) => foldText(text).split(WORD_SEPARATORS).filter(Boolean);

/** Match tiers, best first. */
export const CommandMatchTier = { Exact: 0, LabelPrefix: 1, LabelWords: 2, Keywords: 3 } as const;
export type CommandMatchTier = (typeof CommandMatchTier)[keyof typeof CommandMatchTier];

export interface CommandMatch {
  tier: CommandMatchTier;
  /** Label words no typed word starts (a closer name has fewer). */
  extraWords: number;
}

/** How well `text` names `command`, or null when it does not name it at all. */
export function rankCommand(
  command: AppCommand,
  text: string,
  label: (command: AppCommand) => string,
): CommandMatch | null {
  const terms = words(text);
  const labelWords = words(label(command));
  const extraWords = labelWords.filter((word) => !terms.some((t) => word.startsWith(t))).length;
  if (terms.length === 0) return { tier: CommandMatchTier.Exact, extraWords: 0 };
  const startsLabelWord = (term: string) => labelWords.some((word) => word.startsWith(term));
  if (terms.every(startsLabelWord)) {
    const typed = terms.join(' ');
    const name = labelWords.join(' ');
    if (name === typed) return { tier: CommandMatchTier.Exact, extraWords };
    if (name.startsWith(typed)) return { tier: CommandMatchTier.LabelPrefix, extraWords };
    return { tier: CommandMatchTier.LabelWords, extraWords };
  }
  const keywordWords = words(command.keywords.join(' '));
  const named = terms.every(
    (term) => startsLabelWord(term) || keywordWords.some((word) => word.startsWith(term)),
  );
  return named ? { tier: CommandMatchTier.Keywords, extraWords } : null;
}

export function commandMatches(
  command: AppCommand,
  text: string,
  label: (command: AppCommand) => string,
): boolean {
  return rankCommand(command, text, label) !== null;
}

/** The commands matching `text`, best first (all of them, in registry order, for a blank text). */
export function matchCommands(
  commands: readonly AppCommand[],
  text: string,
  label: (command: AppCommand) => string,
): AppCommand[] {
  if (words(text).length === 0) return [...commands];
  return commands
    .map((command, index) => ({ command, index, match: rankCommand(command, text, label) }))
    .filter((entry): entry is typeof entry & { match: CommandMatch } => entry.match !== null)
    .sort(
      (a, b) =>
        a.match.tier - b.match.tier || a.match.extraWords - b.match.extraWords || a.index - b.index,
    )
    .map((entry) => entry.command);
}
