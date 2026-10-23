import { SidebarFolders } from '../features/sidebar/sidebar-folders';
import { usePanesStore } from '../lib/panes-store';
import { LEFT_DRAWER_ID } from './pane-toggles';
import { ShellOverlay } from './shell-overlay';

/** The heading inside `SidebarFolders` ("Thư mục"); it names the pane and the drawer. */
const FOLDERS_HEADING_ID = 'sidebar-folders-heading';
export const FOLDER_PANE_ID = 'folder-pane';

/**
 * Bento "Thư mục" pane (F35.2): the calm sidebar's tree (Inbox badge, context menu, keyboard,
 * drag and drop) as a 260 px tile beside the rail on note and file routes.
 */
export function FolderPane() {
  return (
    <aside id={FOLDER_PANE_ID} className="folder-pane" aria-labelledby={FOLDERS_HEADING_ID}>
      <SidebarFolders />
    </aside>
  );
}

/** The same tree as a drawer over the content, on the other routes and below 960 px. */
export function FolderDrawer() {
  return (
    <ShellOverlay
      id={LEFT_DRAWER_ID}
      side="left"
      labelledBy={FOLDERS_HEADING_ID}
      className="folder-drawer"
      onClose={() => usePanesStore.getState().closeDrawer()}
    >
      <SidebarFolders />
    </ShellOverlay>
  );
}
