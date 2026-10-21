import { useTranslation } from 'react-i18next';
import { matchCommands } from '../../lib/commands/command-matching';
import { availableCommands, type AppCommand } from '../../lib/commands/command-registry';
import { foldText } from '../../lib/fold-text';
import { filterSuggestions } from './filter-suggestions';
import { buildPaletteView, type PaletteView } from './palette-entries';
import { activeFilterToken, commandText, hasFilter, type FilterToken } from './palette-query';
import { usePaletteResults, type PaletteResults } from './use-palette-results';
import { useFilterValues } from './use-filter-values';

/** Below note results, a plain query also lists up to this many commands it names. */
export const INLINE_COMMAND_LIMIT = 5;
/** …once it has this many letters (one letter would name half the commands). */
const INLINE_COMMAND_MIN_LENGTH = 2;

export interface PaletteModel {
  view: PaletteView;
  results: PaletteResults;
  token: FilterToken | null;
  /** The command-mode text after `>` (null for a note search). */
  commandQuery: string | null;
}

/** Everything the palette shows for `query`: notes or commands, filter values, recents. */
export function usePaletteView(query: string): PaletteModel {
  const { t } = useTranslation();
  const commandQuery = commandText(query);
  const notes = commandQuery === null;
  const results = usePaletteResults(query, notes);
  const token = notes ? activeFilterToken(query) : null;
  const sources = useFilterValues(token?.key ?? null);
  const label = (command: AppCommand) => t(command.labelKey);

  let commands: AppCommand[] = [];
  if (!notes) {
    commands = matchCommands(availableCommands(), commandQuery, label);
  } else if (
    !hasFilter(query) &&
    foldText(query).replace(/\s/gu, '').length >= INLINE_COMMAND_MIN_LENGTH
  ) {
    commands = matchCommands(availableCommands(), query, label).slice(0, INLINE_COMMAND_LIMIT);
  }
  const suggestions = token ? filterSuggestions(token, sources, t) : [];
  const view = buildPaletteView(query, results, {
    mode: notes ? 'notes' : 'commands',
    commands,
    suggestions,
  });
  return { view, results, token, commandQuery };
}
