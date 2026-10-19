import { useTranslation } from 'react-i18next';

/** Key names are the same in every language; only what they do is translated. */
const HINTS = [
  { keys: 'Enter', labelKey: 'search.hintOpen' },
  { keys: 'Ctrl+Enter', labelKey: 'search.hintNewTab' },
  { keys: 'Esc', labelKey: 'search.hintClose' },
] as const;

/**
 * Quiet key hints under the results (design.md §8: shortcuts shown next to what they do); also
 * the input's description for screen readers.
 */
export function PaletteKeyHints({ id }: { id: string }) {
  const { t } = useTranslation();
  return (
    <p id={id} className="palette-hints">
      {HINTS.map((hint) => (
        <span key={hint.keys} className="palette-hints__item">
          <kbd>{hint.keys}</kbd> {t(hint.labelKey)}
        </span>
      ))}
    </p>
  );
}
