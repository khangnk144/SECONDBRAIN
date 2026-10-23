import { FolderSimple } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { usePanesStore } from '../../lib/panes-store';
import { shortcutKeys } from '../../lib/shortcuts/use-app-shortcuts';
import { RAIL_ICON_SIZE } from './rail-link';

/**
 * "Thư mục" on the rail: the button equivalent of `Alt+1`. On note and file routes it shows or
 * hides the folder pane beside the rail; elsewhere it opens the folder drawer over the content
 * (the store picks which, see `leftPaneMode`).
 */
export function FolderToggleButton({
  expanded,
  controls,
  onActivate,
}: {
  expanded: boolean;
  controls?: string;
  /** Replaces the toggle (the "Thêm" sheet closes itself first, then opens the drawer). */
  onActivate?: () => void;
}) {
  const { t } = useTranslation();
  const name = t('rail.folders');
  return (
    <button
      type="button"
      className="rail-item rail-item--toggle"
      aria-expanded={expanded}
      aria-controls={expanded ? controls : undefined}
      aria-keyshortcuts={shortcutKeys('toggle-left-pane')}
      title={t('panes.withShortcut', { label: name, keys: shortcutKeys('toggle-left-pane') })}
      onClick={onActivate ?? (() => usePanesStore.getState().toggleLeft())}
    >
      <span className="rail-item__icon">
        <FolderSimple size={RAIL_ICON_SIZE} aria-hidden="true" focusable="false" />
      </span>
      <span className="rail-item__label">{t('rail.short.folders')}</span>
    </button>
  );
}
