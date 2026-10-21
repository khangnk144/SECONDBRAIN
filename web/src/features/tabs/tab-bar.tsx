import { useTranslation } from 'react-i18next';
import { useTabsStore } from '../../lib/tabs-store';
import { TabItem } from './tab-item';
import './tab-bar.css';

/** Tabs (notes and PDFs in the viewer) above the screen (SPEC F23); overflow scrolls horizontally. */
export function TabBar() {
  const { t } = useTranslation();
  const tabs = useTabsStore((state) => state.tabs);
  const activeId = useTabsStore((state) => state.activeId);
  if (tabs.length === 0) return null;
  return (
    <nav className="tab-bar" aria-label={t('tabs.label')}>
      <ul className="tab-bar__list">
        {tabs.map((tab) => (
          <TabItem key={tab.id} tab={tab} active={tab.id === activeId} />
        ))}
      </ul>
    </nav>
  );
}
