import type { MouseEvent } from 'react';
import { Outlet, useMatches } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LeftSidebar } from './left-sidebar';
import { RightPanel } from './right-panel';
import type { AppRouteHandle } from './routes';
import '../styles/app-layout.css';

/**
 * The app uses a hash router, so following `href="#main-content"` would navigate to a route
 * named "main-content". Move focus to the main region instead and keep the current route.
 */
function skipToMainContent(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
  document.getElementById('main-content')?.focus();
}

/** Three-pane frame: left sidebar, main content, optional right panel. */
export function AppLayout() {
  const { t } = useTranslation();
  const matches = useMatches();
  const showRightPanel = matches.some(
    (match) => (match.handle as AppRouteHandle | undefined)?.rightPanel === true,
  );

  return (
    <div className={showRightPanel ? 'app-shell app-shell--with-panel' : 'app-shell'}>
      <a className="skip-link" href="#main-content" onClick={skipToMainContent}>
        {t('app.skipToContent')}
      </a>
      <LeftSidebar />
      <main id="main-content" className="app-main" tabIndex={-1}>
        <div className="app-main__inner">
          <Outlet />
        </div>
      </main>
      {showRightPanel ? <RightPanel /> : null}
    </div>
  );
}
