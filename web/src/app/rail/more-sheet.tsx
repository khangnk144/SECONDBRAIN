import { useTranslation } from 'react-i18next';
import { usePanesStore } from '../../lib/panes-store';
import { ShellOverlay } from '../shell-overlay';
import { FolderToggleButton } from './folder-toggle-button';
import { BOTTOM_BAR_IDS, RAIL_ITEMS } from './rail-items';
import { RailLink } from './rail-link';
import { RailSettingsLink } from './rail';

export const MORE_SHEET_ID = 'more-sheet';

/**
 * "Thêm" (phones, bento): every place that is not in the bottom tab bar, then "Thư mục" (opens
 * the folder drawer) and "Cài đặt". Choosing a place navigates and closes the sheet.
 */
export function MoreSheet({
  folderExpanded,
  onClose,
}: {
  folderExpanded: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const rest = RAIL_ITEMS.filter((item) => !BOTTOM_BAR_IDS.includes(item.id));
  return (
    <ShellOverlay
      id={MORE_SHEET_ID}
      side="bottom"
      title={t('rail.moreTitle')}
      className="more-sheet"
      onClose={onClose}
    >
      <ul className="more-sheet__list">
        {rest.map((item) => (
          <li key={item.id}>
            <RailLink item={item} onNavigate={onClose} />
          </li>
        ))}
        <li>
          <FolderToggleButton
            expanded={folderExpanded}
            onActivate={() => {
              onClose();
              usePanesStore.getState().openDrawer();
            }}
          />
        </li>
        <li>
          <RailSettingsLink onNavigate={onClose} />
        </li>
      </ul>
    </ShellOverlay>
  );
}
