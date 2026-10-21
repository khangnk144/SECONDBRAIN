import { useTranslation } from 'react-i18next';
import type { PaletteMode } from './palette-entries';

/**
 * Keys the palette handles itself (not in the app registry). Key names are the same in every
 * language; only what they do is translated. The shortcut sheet lists them too.
 */
export const PALETTE_KEYS = [
  { keys: 'Enter', labelKey: 'search.hintOpen' },
  { keys: 'Ctrl+Enter', labelKey: 'search.hintNewTab' },
  { keys: 'Esc', labelKey: 'search.hintClose' },
] as const;

const COMMAND_KEYS = [
  { keys: 'Enter', labelKey: 'search.hintRun' },
  { keys: 'Esc', labelKey: 'search.hintClose' },
] as const;

/**
 * Quiet key hints under the results (design.md §8: shortcuts shown next to what they do); also
 * the input's description for screen readers.
 */
export function PaletteKeyHints({ id, mode }: { id: string; mode: PaletteMode }) {
  const { t } = useTranslation();
  const hints = mode === 'commands' ? COMMAND_KEYS : PALETTE_KEYS;
  return (
    <p id={id} className="palette-hints">
      {hints.map((hint) => (
        <span key={hint.keys} className="palette-hints__item">
          <kbd>{hint.keys}</kbd> {t(hint.labelKey)}
        </span>
      ))}
    </p>
  );
}
