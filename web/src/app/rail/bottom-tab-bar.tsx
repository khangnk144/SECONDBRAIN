import { DotsThreeOutline, Lightning } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useReminderCount } from '../../features/reminders/reminders-store';
import { useCaptureUi } from '../../lib/capture-ui-store';
import { shortcutKeys } from '../../lib/shortcuts/use-app-shortcuts';
import { BOTTOM_BAR_IDS, railItem } from './rail-items';
import { RAIL_ICON_SIZE, RailBadge, RailLink } from './rail-link';
import { MoreSheet, MORE_SHEET_ID } from './more-sheet';

/**
 * Phone widths (F28.1, bento): the rail becomes a bottom tab bar with Hôm nay, Việc, Lịch,
 * "Ghi nhanh" (opens quick capture, like `Alt+Q`) and "Thêm", a sheet with every other place,
 * "Thư mục" and "Cài đặt". The badge of "Nhắc nhở" moves to "Thêm" while it is inside.
 */
export function BottomTabBar({ folderExpanded }: { folderExpanded: boolean }) {
  const { t } = useTranslation();
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const reminders = useReminderCount();
  // A place chosen in the sheet navigates: the sheet closes with it.
  useEffect(() => setMoreOpen(false), [location.key]);

  const capture = t('shortcuts.quickCapture');
  const more = t('rail.more');
  const moreName =
    reminders > 0
      ? t('sidebar-nav.withCount', {
          label: more,
          count: t('reminders.badge', { count: reminders }),
        })
      : more;
  return (
    <>
      <nav className="bottom-bar" aria-label={t('nav.label')}>
        <ul className="bottom-bar__list">
          {BOTTOM_BAR_IDS.map((id) => (
            <li key={id}>
              <RailLink item={railItem(id)} />
            </li>
          ))}
          <li>
            <button
              type="button"
              className="rail-item"
              aria-label={capture}
              aria-keyshortcuts={shortcutKeys('quick-capture')}
              title={capture}
              onClick={() => useCaptureUi.getState().open()}
            >
              <span className="rail-item__icon">
                <Lightning size={RAIL_ICON_SIZE} aria-hidden="true" focusable="false" />
              </span>
              <span className="rail-item__label">{t('rail.short.capture')}</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              className="rail-item"
              aria-label={moreName}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              aria-controls={moreOpen ? MORE_SHEET_ID : undefined}
              data-overlay-toggle={MORE_SHEET_ID}
              title={more}
              onClick={() => setMoreOpen((open) => !open)}
            >
              <span className="rail-item__icon">
                <DotsThreeOutline size={RAIL_ICON_SIZE} aria-hidden="true" focusable="false" />
                <RailBadge count={reminders} />
              </span>
              <span className="rail-item__label">{t('rail.short.more')}</span>
            </button>
          </li>
        </ul>
      </nav>
      {moreOpen ? (
        <MoreSheet folderExpanded={folderExpanded} onClose={() => setMoreOpen(false)} />
      ) : null}
    </>
  );
}
