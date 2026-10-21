import { Sparkle } from '@phosphor-icons/react';
import { useId, useRef, useState, type HTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import type { TooltipContent } from '../../editor/formatting/toolbar-tooltip';
import { useShortcut } from '../../lib/shortcuts/use-shortcut';
import { PopupMenu, type PopupMenuItem } from '../dialogs/popup-menu';
import {
  AI_ACTION_ICONS,
  AI_EDITOR_ACTIONS,
  aiActionLabelKey,
  type AiEditorAction,
} from './ai-action-kinds';
import { blockerReasonKey, type AiBlocker } from './ai-readiness';

export const AI_MENU_ITEM_ID = 'ai';
/** Sparkle + "AI" on the toolbar row (formatting-toolbar.css sizes buttons in rem). */
export const AI_MENU_WIDTH_REM = 3.5;
export const AI_MENU_KEYS = 'Alt+A';

interface AiToolbarButtonProps {
  tabIndex: 0 | -1;
  tooltipProps: (content: TooltipContent) => HTMLAttributes<HTMLElement>;
  /** Why the menu cannot be used now; null = enabled. */
  blocker: AiBlocker | null;
  onChoose: (action: AiEditorAction) => void;
  /** Puts the caret back in the editor (the menu was opened from there with Alt+A). */
  focusEditor: () => void;
}

/**
 * "AI" on the formatting toolbar: a menu of the actions on the selection, also opened with
 * `Alt+A`. Disabled (still focusable, with the reason in its tooltip and description) when AI is
 * not ready, the note is out of scope or nothing is selected; `Alt+A` then shows that reason.
 */
export function AiToolbarButton(props: AiToolbarButtonProps) {
  const { tabIndex, tooltipProps, blocker, onChoose, focusEditor } = props;
  const { t } = useTranslation();
  const reasonId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; fromEditor: boolean } | null>(null);

  const open = (fromEditor: boolean) => {
    const rect = button.current?.getBoundingClientRect();
    if (blocker || !rect) return;
    setMenu({ x: rect.left, y: rect.bottom + 4, fromEditor });
  };

  useShortcut({
    id: 'ai-actions-menu',
    keys: AI_MENU_KEYS,
    labelKey: 'ai-actions.menu.shortcut',
    run: () => {
      if (blocker) button.current?.focus();
      else open(true);
    },
  });

  const items: PopupMenuItem[] = AI_EDITOR_ACTIONS.map((action) => ({
    id: action,
    label: t(aiActionLabelKey(action)),
    icon: AI_ACTION_ICONS[action],
    onSelect: () => onChoose(action),
  }));
  const label = t('ai-actions.menu.label');
  const reason = blocker ? t(blockerReasonKey(blocker)) : null;
  const tooltip = tooltipProps(reason ? { label: reason } : { label, keys: AI_MENU_KEYS });

  return (
    <>
      <button
        ref={button}
        type="button"
        className="formatting-toolbar__button ai-toolbar-button"
        data-toolbar-item={AI_MENU_ITEM_ID}
        tabIndex={tabIndex}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        aria-disabled={blocker ? true : undefined}
        aria-keyshortcuts={AI_MENU_KEYS}
        {...tooltip}
        aria-describedby={reason ? reasonId : tooltip['aria-describedby']}
        // The editor keeps its selection while the button is pressed.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => open(false)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return;
          event.preventDefault();
          open(false);
        }}
      >
        <Sparkle size={18} aria-hidden="true" />
        <span className="ai-toolbar-button__label" aria-hidden="true">
          {t('ai-actions.menu.button')}
        </span>
      </button>
      {reason ? (
        <span id={reasonId} hidden>
          {reason}
        </span>
      ) : null}
      {menu ? (
        <PopupMenu
          label={label}
          items={items}
          position={menu}
          onClose={() => {
            const fromEditor = menu.fromEditor;
            setMenu(null);
            if (fromEditor) focusEditor();
            else button.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}
