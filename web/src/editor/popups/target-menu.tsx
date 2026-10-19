import type { Editor } from '@tiptap/core';
import { useTranslation } from 'react-i18next';
import { PopupMenu, type PopupMenuItem } from '../../features/dialogs/popup-menu';
import type { TargetMenuRequest } from '../editor-context';
import { chooseLinkTarget } from '../extensions/wikilink-follow';
import { pathFormTarget } from '../link-actions';

interface TargetMenuProps {
  editor: Editor;
  request: TargetMenuRequest;
  onClose: () => void;
}

/** "Chọn đích…" of an ambiguous link: one item per candidate; choosing rewrites to the path form. */
export function TargetMenu({ editor, request, onClose }: TargetMenuProps) {
  const { t } = useTranslation();
  const items: PopupMenuItem[] = request.candidates.map((path) => ({
    id: path,
    label: pathFormTarget(path),
    onSelect: () => chooseLinkTarget(editor, request.pos, request.target, path),
  }));
  return (
    <PopupMenu
      label={t('editor.wikilink.chooseTargetMenu', { target: request.target })}
      items={items}
      position={{ x: request.x, y: request.y }}
      onClose={() => {
        onClose();
        request.returnFocus?.focus();
      }}
    />
  );
}
