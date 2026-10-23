import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { usePanesStore } from '../lib/panes-store';
import { PANEL_SHEET_ID } from './pane-toggles';
import { RightPanel } from './right-panel';
import { ShellOverlay } from './shell-overlay';

/** The route's right-panel component in the right pane. */
export function RoutePanel({ panel: Panel }: { panel?: ComponentType }) {
  return <RightPanel>{Panel ? <Panel /> : null}</RightPanel>;
}

/**
 * Phones (F28.1): the right panel as a bottom sheet, opened by the right-pane toggle (`Alt+2`);
 * Esc, the close button or a click outside close it and focus goes back to the toggle.
 */
export function PanelSheet({ panel }: { panel?: ComponentType }) {
  const { t } = useTranslation();
  return (
    <ShellOverlay
      id={PANEL_SHEET_ID}
      side="bottom"
      label={t('panel.label')}
      className="panel-sheet"
      onClose={() => usePanesStore.getState().closeSheet()}
    >
      <RoutePanel panel={panel} />
    </ShellOverlay>
  );
}
