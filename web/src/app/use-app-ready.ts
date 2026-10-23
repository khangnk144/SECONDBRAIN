import { usePanesStore } from '../lib/panes-store';
import { useTabsStore } from '../lib/tabs-store';
import { useTreeStore } from '../lib/tree-store';

/**
 * The window has read its per-vault state (panes, tabs) and the folder tree: a shortcut pressed
 * before that can be undone by the hydration that follows `GET /health`. Shown as `data-ready`
 * on the shell in both styles (the calm sidebar shows the tree, Bento hides it on Today), so
 * the e2e `appReady()` helper and assistive tooling can wait for one signal.
 */
export function useAppReady(): boolean {
  const panes = usePanesStore((state) => state.hydrated);
  const tabs = useTabsStore((state) => state.hydrated);
  const tree = useTreeStore((state) => state.status === 'ready');
  return panes && tabs && tree;
}
