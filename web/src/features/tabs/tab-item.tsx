import { FilePdf, X } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { focusIsLost, focusOrMain } from '../../lib/focus-recovery';
import { tabKind, useTabsStore, type AppTab } from '../../lib/tabs-store';
import { noteTitleFromPath } from '../../lib/vault-paths';

/**
 * One tab: the title activates it, the × (or a middle click) closes it. A file tab (PDF viewer)
 * shows the file name with its extension and a PDF icon.
 */
export function TabItem({ tab, active }: { tab: AppTab; active: boolean }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLLIElement>(null);
  const title = noteTitleFromPath(tab.path);
  const { activate, closeTab } = useTabsStore.getState();

  /** The × button leaves with its tab: keep the keyboard on the tab bar (or main when it is empty). */
  function closeFromButton() {
    closeTab(tab.id);
    setTimeout(() => {
      if (!focusIsLost()) return;
      focusOrMain(document.querySelector<HTMLElement>('.tab-bar [aria-current="page"]'));
    }, 0);
  }

  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  return (
    <li
      ref={ref}
      className={active ? 'tab is-active' : 'tab'}
      // Middle click closes (and must not start autoscroll on Windows).
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.button === 1) closeTab(tab.id);
      }}
    >
      <button
        type="button"
        className="tab__open"
        aria-current={active ? 'page' : undefined}
        title={tab.path}
        onClick={() => activate(tab.id)}
      >
        {tabKind(tab) === 'file' ? (
          <FilePdf className="tab__icon" size={16} aria-hidden="true" focusable="false" />
        ) : null}
        {title}
      </button>
      <button
        type="button"
        className="tab__close"
        aria-label={t('tabs.close', { title })}
        title={t('tabs.closeHint')}
        onClick={closeFromButton}
      >
        <X size={16} aria-hidden="true" focusable="false" />
      </button>
    </li>
  );
}
