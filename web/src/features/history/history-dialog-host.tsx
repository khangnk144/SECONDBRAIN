import { useEffect } from 'react';
import { HistoryDialog } from './history-dialog';
import { registerHistoryHost, useHistoryDialog } from './history-dialog-store';

/** Renders the history dialog while one is open (mounted once next to the other overlays). */
export function HistoryDialogHost() {
  const path = useHistoryDialog((state) => state.path);
  const commit = useHistoryDialog((state) => state.commit);
  useEffect(() => registerHistoryHost(), []);
  if (!path) return null;
  return (
    <HistoryDialog
      key={path}
      path={path}
      initialCommit={commit}
      onClose={() => useHistoryDialog.getState().close()}
    />
  );
}
