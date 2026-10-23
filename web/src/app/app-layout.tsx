import { useEffect, useLayoutEffect, useMemo, useRef, type MouseEvent } from 'react';
import { useLocation, useMatches } from 'react-router';
import { useTranslation } from 'react-i18next';
import { CaptureOverlay } from '../features/capture/capture-overlay';
import { InboxTidyDialogHost } from '../features/ai-inbox/inbox-tidy-dialog-host';
import { DialogHost } from '../features/dialogs/dialog-host';
import { HistoryDialogHost } from '../features/history/history-dialog-host';
import { SearchPalette } from '../features/search/search-palette';
import { ShortcutSheet } from '../features/shortcut-sheet/shortcut-sheet';
import { ToastHost } from '../features/toasts/toast-host';
import { SETTINGS_ROUTE } from '../lib/app-navigation';
import { useEffectivePanes, usePanesStore, type ShellContext } from '../lib/panes-store';
import { useAppShortcuts } from '../lib/shortcuts/use-app-shortcuts';
import { useUiStyle } from '../lib/ui-prefs-store';
import { useWritingFocus } from '../lib/writing-focus-store';
import { BentoFrame } from './bento-frame';
import { CalmFrame } from './calm-frame';
import type { FrameProps } from './frame-props';
import { mergedRouteHandle } from './route-handle';
import { useShellWidth } from './use-shell-media';
import { useShellView } from './shell-view';
import { useAppReady } from './use-app-ready';
import { useFocusAcrossFrames } from './use-focus-across-frames';
import { useFocusRecovery } from './use-focus-recovery';
import { useTabsRouteSync } from './use-tabs-route-sync';
import '../styles/app-layout.css';
import '../styles/bento/bento.css';

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

/**
 * Drawers and sheets are for the moment: a navigation or a new window width closes them. Only
 * what was already on screen before the change closes, so a sheet opened by that navigation
 * itself (a calendar day chosen on a phone shows its panel) stays open.
 */
function useCloseOverlays(locationKey: string, shell: ShellContext): void {
  const drawerOpen = usePanesStore((s) => s.drawerOpen);
  const sheetOpen = usePanesStore((s) => s.sheetOpen);
  const shownBefore = useRef({ drawerOpen, sheetOpen });
  useEffect(() => {
    const panes = usePanesStore.getState();
    if (shownBefore.current.drawerOpen) panes.closeDrawer();
    if (shownBefore.current.sheetOpen) panes.closeSheet();
  }, [locationKey, shell.width, shell.style]);
  // After the effect above: what this commit showed is "before" for the next change.
  useEffect(() => {
    shownBefore.current = { drawerOpen, sheetOpen };
  });
}

/**
 * The frame around every screen, in the style she chose (F35.1): calm (left sidebar, main, right
 * panel) or bento (rail, folder pane, top bar, main, right panel). Shared here: the skip link,
 * pane state and shortcuts, focus recovery, writing focus, the immersive route, the screen key
 * and the hosts of toasts, dialogs, palette, capture and the shortcut sheet.
 */
export function AppLayout() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const screenKey = useScreenKey(i18n.language);
  const handle = mergedRouteHandle(useMatches());
  const immersive = handle.immersive === true;
  const style = useUiStyle();
  const width = useShellWidth();
  const compact = width === 'compact';
  const folderRoute = handle.tabs === true;
  const shell = useMemo<ShellContext>(
    () => ({ style, folderRoute, width }),
    [style, folderRoute, width],
  );
  const routeHasPanel = handle.rightPanel === true;
  const view = useShellView(shell, { hasPanel: routeHasPanel, immersive });
  const effective = useEffectivePanes(immersive);
  const writing = useWritingFocus((state) => state.focused);
  useFocusAcrossFrames(style);
  const ready = useAppReady();
  useAppShortcuts();
  useTabsRouteSync();
  // Before paint, so Alt+1 / Alt+2 already act on what is on screen.
  useLayoutEffect(() => usePanesStore.getState().setShell(shell), [shell]);
  useEffect(() => usePanesStore.getState().setImmersive(immersive), [immersive]);
  useCloseOverlays(location.key, shell);

  const leftCollapsed = compact ? !view.drawer : !view.leftInline;
  const rightCollapsed = compact ? view.right !== 'sheet' : effective.rightCollapsed;
  useFocusRecovery(!view.leftInline, rightCollapsed);

  const bento = style === 'bento';
  const classes = ['app-shell'];
  if (bento) classes.push('app-shell--bento');
  if (view.right === 'side') classes.push('app-shell--with-panel');
  if (bento && view.leftInline) classes.push('app-shell--with-folders');
  if (!bento && !view.leftInline) classes.push('app-shell--left-collapsed');
  if (immersive) classes.push('app-shell--immersive');
  if (writing) classes.push('app-shell--writing');

  const frame: FrameProps = { handle, view, compact, screenKey, leftCollapsed, rightCollapsed };
  return (
    <div
      className={classes.join(' ')}
      data-ready={ready ? 'true' : undefined}
      // Writing focus ends as soon as the mouse moves (design.md §4).
      onMouseMove={writing ? () => useWritingFocus.getState().setFocused(false) : undefined}
    >
      <a className="skip-link" href="#main-content" onClick={skipToMainContent}>
        {t('app.skipToContent')}
      </a>
      {bento ? <BentoFrame {...frame} /> : <CalmFrame {...frame} />}
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
