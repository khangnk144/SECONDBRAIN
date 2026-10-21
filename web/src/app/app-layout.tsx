import { useEffect, type MouseEvent } from 'react';
import { Outlet, useLocation, useMatches } from 'react-router';
import { useTranslation } from 'react-i18next';
import { CaptureOverlay } from '../features/capture/capture-overlay';
import { ConnectionBanner } from '../features/connection/connection-banner';
import { InboxTidyDialogHost } from '../features/ai-inbox/inbox-tidy-dialog-host';
import { DialogHost } from '../features/dialogs/dialog-host';
import { HistoryDialogHost } from '../features/history/history-dialog-host';
import { JournalBanner } from '../features/journal/journal-banner';
import { SearchPalette } from '../features/search/search-palette';
import { ShortcutSheet } from '../features/shortcut-sheet/shortcut-sheet';
import { ToastHost } from '../features/toasts/toast-host';
import { SETTINGS_ROUTE } from '../lib/app-navigation';
import { useEffectivePanes, usePanesStore } from '../lib/panes-store';
import { useAppShortcuts } from '../lib/shortcuts/use-app-shortcuts';
import { useWritingFocus } from '../lib/writing-focus-store';
import { LeftSidebar } from './left-sidebar';
import { MainToolbar } from './main-toolbar';
import { RightPanel } from './right-panel';
import { mergedRouteHandle } from './route-handle';
import { useFocusRecovery } from './use-focus-recovery';
import { useTabsRouteSync } from './use-tabs-route-sync';
import '../styles/app-layout.css';

/**
 * The app uses a hash router, so following `href="#main-content"` would navigate to a route
 * named "main-content". Move focus to the main region instead and keep the current route.
 */
function skipToMainContent(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
  document.getElementById('main-content')?.focus();
}

/**
 * Key of the routed screen: it changes with the language, so screens that keep translated text
 * outside React (editor decorations, canvas labels) are built again in the new language when it
 * changes from elsewhere (another window, SPEC F19.2). Settings, where she switches the language,
 * re-renders in place instead, so the control she used keeps focus.
 */
function useScreenKey(language: string): string {
  return useLocation().pathname === SETTINGS_ROUTE ? 'settings' : language;
}

/** Three-pane frame: left sidebar, main content, optional right panel; both sides collapsible. */
export function AppLayout() {
  const { t, i18n } = useTranslation();
  const screenKey = useScreenKey(i18n.language);
  const handle = mergedRouteHandle(useMatches());
  const immersive = handle.immersive === true;
  const { leftCollapsed, rightCollapsed } = useEffectivePanes(immersive);
  const writing = useWritingFocus((state) => state.focused);
  useAppShortcuts();
  useTabsRouteSync();
  useFocusRecovery(leftCollapsed, rightCollapsed);
  useEffect(() => usePanesStore.getState().setImmersive(immersive), [immersive]);

  const routeHasPanel = handle.rightPanel === true;
  const showRightPanel = routeHasPanel && !rightCollapsed;
  const Panel = handle.panel;
  const classes = ['app-shell'];
  if (showRightPanel) classes.push('app-shell--with-panel');
  if (leftCollapsed) classes.push('app-shell--left-collapsed');
  if (immersive) classes.push('app-shell--immersive');
  if (writing) classes.push('app-shell--writing');

  return (
    <div
      className={classes.join(' ')}
      // Writing focus ends as soon as the mouse moves (design.md §4).
      onMouseMove={writing ? () => useWritingFocus.getState().setFocused(false) : undefined}
    >
      <a className="skip-link" href="#main-content" onClick={skipToMainContent}>
        {t('app.skipToContent')}
      </a>
      {leftCollapsed ? null : <LeftSidebar />}
      <main id="main-content" className="app-main" tabIndex={-1}>
        {handle.inlineConnectionBanner === true ? null : <ConnectionBanner variant="global" />}
        <JournalBanner />
        <MainToolbar
          showTabs={handle.tabs === true}
          routeHasPanel={routeHasPanel}
          leftCollapsed={leftCollapsed}
          rightCollapsed={rightCollapsed}
        />
        <div key={screenKey} className="app-main__inner">
          <Outlet />
        </div>
      </main>
      {showRightPanel ? <RightPanel>{Panel ? <Panel /> : null}</RightPanel> : null}
      <ToastHost />
      {/* Before DialogHost: the relink confirmation of "Áp dụng" must show above it. */}
      <InboxTidyDialogHost />
      <DialogHost />
      <HistoryDialogHost />
      <SearchPalette />
      <CaptureOverlay />
      <ShortcutSheet />
    </div>
  );
}
