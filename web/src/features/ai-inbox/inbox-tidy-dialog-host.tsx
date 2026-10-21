import { InboxTidyDialog } from './inbox-tidy-dialog';
import { useInboxTidy } from './inbox-tidy-store';

/**
 * Renders the Inbox tidying dialog while it is open. Mounted once with the other overlays, before
 * the dialog host, so the relink confirmation of "Áp dụng" shows above it.
 */
export function InboxTidyDialogHost() {
  const mode = useInboxTidy((state) => state.mode);
  const openCount = useInboxTidy((state) => state.openCount);
  if (!mode) return null;
  return (
    <InboxTidyDialog key={openCount} mode={mode} onClose={() => useInboxTidy.getState().close()} />
  );
}
