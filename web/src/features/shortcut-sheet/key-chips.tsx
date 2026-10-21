import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

/** `Ctrl+Shift+Z` → its keys; a `+` key itself stays one key (`+`, `Ctrl++`). */
export function comboParts(keys: string): string[] {
  if (keys === '+') return ['+'];
  if (keys.endsWith('++')) return [...keys.slice(0, -2).split('+'), '+'];
  return keys.split('+');
}

/** One `<kbd>` per key, joined by `+`. */
function KeyCombo({ keys }: { keys: string }) {
  const parts = comboParts(keys);
  return (
    <span className="key-combo">
      {parts.map((part, index) => (
        <Fragment key={`${part}-${index}`}>
          {index > 0 ? <span className="key-combo__plus">+</span> : null}
          <kbd>{part}</kbd>
        </Fragment>
      ))}
    </span>
  );
}

/** One or more alternative combinations ("Ctrl+Y hoặc Ctrl+Shift+Z"). */
export function KeyChips({ keys }: { keys: readonly string[] }) {
  const { t } = useTranslation();
  return (
    <span className="key-chips">
      {keys.map((combo, index) => (
        <Fragment key={combo}>
          {index > 0 ? <span className="key-chips__or"> {t('shortcut-sheet.or')} </span> : null}
          <KeyCombo keys={combo} />
        </Fragment>
      ))}
    </span>
  );
}
