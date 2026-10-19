import { Plus } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { startNewNote } from '../../lib/new-note-flow';
import { shortcutKeys } from '../../lib/shortcuts/use-app-shortcuts';

/** "Ghi chú mới" at the bottom of the sidebar: the button equivalent of `Alt+N`. */
export function SidebarNewNoteButton() {
  const { t } = useTranslation();
  return (
    <button type="button" className="sidebar-new-note" onClick={() => void startNewNote()}>
      <Plus size={18} aria-hidden="true" focusable="false" />
      <span className="sidebar-new-note__label">{t('sidebar-tree.newNote')}</span>
      <kbd>{shortcutKeys('new-note')}</kbd>
    </button>
  );
}
