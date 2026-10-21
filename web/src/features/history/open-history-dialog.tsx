/**
 * Opens a note's version history from anywhere (tree menu, right pane, a command). The dialog is
 * rendered by a `HistoryDialogHost`; when the app shell does not mount one, the first call mounts
 * one in its own root at the end of `<body>` (it needs no router context: everything it does goes
 * through the global stores and API).
 */
import { createRoot, type Root } from 'react-dom/client';
import type { VaultPath } from '../../lib/api/vault-types';
import { HistoryDialogHost } from './history-dialog-host';
import { historyHostMounted, useHistoryDialog } from './history-dialog-store';

let ownRoot: { root: Root; container: HTMLElement } | null = null;

export function openHistoryDialog(path: VaultPath, commit: string | null = null): void {
  useHistoryDialog.getState().open(path, commit);
  if (historyHostMounted() || ownRoot) return;
  const container = document.createElement('div');
  container.className = 'history-dialog-root';
  document.body.append(container);
  const root = createRoot(container);
  root.render(<HistoryDialogHost />);
  ownRoot = { root, container };
}

/** Test helper: closes the dialog and removes the root this module created. */
export function resetHistoryDialog(): void {
  useHistoryDialog.setState({ path: null, commit: null, restores: 0 });
  if (!ownRoot) return;
  ownRoot.root.unmount();
  ownRoot.container.remove();
  ownRoot = null;
}
