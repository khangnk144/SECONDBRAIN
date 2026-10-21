import type { Editor } from '@tiptap/core';
import { CaretDown, DotsThree } from '@phosphor-icons/react';
import { Fragment, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { PopupMenuItem } from '../../features/dialogs/popup-menu';
import { useWritingFocus } from '../../lib/writing-focus-store';
import {
  FORMATTING_COMMANDS,
  formattingCommand,
  type FormattingCommand,
  type FormattingContext,
} from './formatting-commands';
import { BAR_ITEMS, MORE_ITEM, SIZES_REM, STYLE_ITEM, toolbarLayout } from './toolbar-layout';
import { ToolbarMenuButton } from './toolbar-menu-button';
import { withExtraItem, type ToolbarExtraItem } from './toolbar-extra-item';
import { useToolbarTooltip } from './toolbar-tooltip';
import {
  coarsePointer,
  rootFontSize,
  useElementWidth,
  useFormattingStates,
} from './use-formatting-states';
import { editWebLinkWithDialog } from './web-link';
import './formatting-toolbar.css';

const STYLE_COMMANDS = FORMATTING_COMMANDS.filter((command) => command.group === 'style');
const ROVING_KEYS = new Set(['ArrowRight', 'ArrowLeft', 'Home', 'End']);

export interface FormattingToolbarProps {
  /** The note's rich-text editor; null until it is mounted. */
  editor: Editor | null;
  sourceMode: boolean;
  canToggleSource: boolean;
  onToggleSource: () => void;
  /** The source field, for undo/redo while in source mode. */
  sourceField: RefObject<HTMLTextAreaElement | null>;
  extraItem?: ToolbarExtraItem;
}

/** `Ctrl+B` → `Control+B` (aria-keyshortcuts notation). */
function ariaKeys(command: FormattingCommand): string | undefined {
  const all = command.keys ? [command.keys, ...(command.altKeys ?? [])] : [];
  return all.length > 0
    ? all.map((keys) => keys.replace(/^Ctrl\+/, 'Control+')).join(' ')
    : undefined;
}

/** Native undo/redo of the source field (its history belongs to the browser). */
function sourceHistory(field: HTMLTextAreaElement | null, action: 'undo' | 'redo'): void {
  if (!field) return;
  field.focus();
  if (typeof document.execCommand === 'function') document.execCommand(action);
}

/**
 * The Word-like formatting toolbar (owner request): one row at the top of the note, built from
 * the formatting registry. WAI-ARIA toolbar: one Tab stop, ←/→/Home/End move between controls.
 * Pressing a control never moves the caret; the command puts focus back in the editor. Commands
 * that cannot apply where the selection is stay visible but disabled.
 */
export function FormattingToolbar(props: FormattingToolbarProps) {
  const { editor, sourceMode, canToggleSource, onToggleSource, sourceField, extraItem } = props;
  const { t } = useTranslation();
  const faded = useWritingFocus((state) => state.focused);
  const row = useRef<HTMLDivElement>(null);
  const width = useElementWidth(row);
  const context = useMemo<FormattingContext>(
    () => ({
      editor,
      sourceMode,
      canToggleSource,
      toggleSourceMode: onToggleSource,
      editWebLink: () => {
        if (editor) void editWebLinkWithDialog(editor);
      },
      sourceHistory: (action) => sourceHistory(sourceField.current, action),
    }),
    [editor, sourceMode, canToggleSource, onToggleSource, sourceField],
  );
  const states = useFormattingStates(context);
  const remPx = rootFontSize();
  const extraPx = extraItem ? (extraItem.widthRem + SIZES_REM.separator) * remPx : 0;
  const layout = toolbarLayout(
    (width ?? Number.POSITIVE_INFINITY) - extraPx,
    remPx,
    coarsePointer(),
  );
  const bar = withExtraItem(layout.bar, extraItem);
  const [focusId, setFocusId] = useState<string | null>(null);
  const tabStop = focusId !== null && bar.includes(focusId) ? focusId : bar[0];

  const tooltip = useToolbarTooltip();
  const enabled = (id: string) => states[id]?.enabled === true;
  const menuItem = (command: FormattingCommand): PopupMenuItem => ({
    id: command.id,
    label: t(command.labelKey),
    icon: command.icon,
    disabled: !enabled(command.id),
    shortcut: command.keys,
    onSelect: () => command.run(context),
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!ROVING_KEYS.has(event.key)) return;
    const items = Array.from(
      row.current?.querySelectorAll<HTMLElement>('[data-toolbar-item]') ?? [],
    );
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (index === -1) return; // keys inside an open menu belong to the menu
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + step + items.length) % items.length;
    items[next]?.focus();
  };

  const renderItem = (id: string) => {
    const tabIndex = id === tabStop ? 0 : -1;
    if (extraItem && id === extraItem.id) {
      return extraItem.render({ tabIndex, tooltipProps: tooltip.props });
    }
    if (id === STYLE_ITEM) {
      const current = STYLE_COMMANDS.find((command) => states[command.id]?.pressed);
      const shown = current ? t(current.labelKey) : t('editor.toolbar.textStyle');
      return (
        <ToolbarMenuButton
          itemId={id}
          tabIndex={tabIndex}
          className="formatting-toolbar__button formatting-toolbar__style"
          label={t('editor.toolbar.textStyleNow', { style: shown })}
          tooltipProps={tooltip.props({ label: t('editor.toolbar.textStyle') })}
          menuLabel={t('editor.toolbar.textStyle')}
          disabled={!STYLE_COMMANDS.some((command) => enabled(command.id))}
          items={STYLE_COMMANDS.map(menuItem)}
        >
          <span className="formatting-toolbar__style-label">{shown}</span>
          <CaretDown size={14} aria-hidden="true" />
        </ToolbarMenuButton>
      );
    }
    if (id === MORE_ITEM) {
      const commands = layout.more.map(formattingCommand);
      return (
        <ToolbarMenuButton
          itemId={id}
          tabIndex={tabIndex}
          className="formatting-toolbar__button"
          label={t('editor.toolbar.more')}
          tooltipProps={tooltip.props({ label: t('editor.toolbar.more') })}
          menuLabel={t('editor.toolbar.moreMenu')}
          disabled={false}
          items={commands.map(menuItem)}
        >
          <DotsThree size={18} weight="bold" aria-hidden="true" />
        </ToolbarMenuButton>
      );
    }
    const command = formattingCommand(id);
    const Icon = command.icon;
    return (
      <button
        type="button"
        className="formatting-toolbar__button"
        data-toolbar-item={id}
        tabIndex={tabIndex}
        aria-label={t(command.labelKey)}
        aria-keyshortcuts={ariaKeys(command)}
        aria-pressed={states[id]?.pressed}
        aria-disabled={enabled(id) ? undefined : true}
        {...tooltip.props({ label: t(command.labelKey), keys: command.keys })}
        // The editor keeps its selection (and focus) while a button is pressed.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (enabled(id)) command.run(context);
        }}
      >
        <Icon size={18} aria-hidden="true" />
      </button>
    );
  };

  const groupOf = (id: string | undefined) => BAR_ITEMS.find((item) => item.id === id)?.group;
  return (
    <div
      ref={row}
      className="formatting-toolbar"
      role="toolbar"
      aria-label={t('editor.toolbar.label')}
      data-faded={faded || undefined}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        const id = (event.target as HTMLElement).dataset['toolbarItem'];
        if (id) setFocusId(id);
      }}
    >
      {bar.map((id, index) => {
        const previous = groupOf(bar[index - 1]);
        const current = groupOf(id);
        const extra = extraItem?.id === id && index > 0;
        return (
          <Fragment key={id}>
            {id === 'sourceMode' ? <span className="formatting-toolbar__spacer" /> : null}
            {extra || (previous && current && previous !== current) ? (
              <span className="formatting-toolbar__separator" aria-hidden="true" />
            ) : null}
            {renderItem(id)}
          </Fragment>
        );
      })}
      {tooltip.tooltip}
    </div>
  );
}
