import type { Editor } from '@tiptap/core';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EditorContext } from '../editor-context';
import type { TriggerMatch } from '../extensions/editor-triggers';
import { useActiveIndex, usePopupKeys } from './popup-hooks';
import { filterSlashCommands, SLASH_COMMANDS, type SlashCommand } from './slash-commands';
import { listKeyHandler, SuggestionListbox } from './suggestion-listbox';
import { TemplateList } from './template-list';

interface SlashMenuProps {
  editor: Editor;
  context: EditorContext;
  trigger: TriggerMatch;
}

/** `/` at the start of an empty line (F3.3): block commands, filtered by what follows the `/`. */
export function SlashMenu(props: SlashMenuProps) {
  const [mode, setMode] = useState<'commands' | 'templates'>('commands');
  if (mode === 'templates') return <TemplateList {...props} />;
  return <CommandList {...props} onTemplates={() => setMode('templates')} />;
}

function CommandList({
  editor,
  context,
  trigger,
  onTemplates,
}: SlashMenuProps & { onTemplates: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const range = { from: trigger.from, to: trigger.to };
  const label = (command: SlashCommand) => t(`editor.slash.${command.labelKey}`);
  const commands = filterSlashCommands(SLASH_COMMANDS, trigger.query, label).filter((command) =>
    command.can(editor, range),
  );
  const [activeIndex, setActiveIndex] = useActiveIndex(trigger.query, commands.length);

  const choose = (index: number) => {
    const command = commands[index];
    if (!command) return;
    if (command.run(editor, range) === 'templates') {
      // Keep the `/` (the menu stays open) and let what is typed next filter the templates.
      if (trigger.to > trigger.from + 1) {
        editor.view.dispatch(editor.state.tr.delete(trigger.from + 1, trigger.to));
      }
      onTemplates();
    }
  };
  usePopupKeys(context, listKeyHandler(commands.length, activeIndex, setActiveIndex, choose));

  return (
    <SuggestionListbox
      editor={editor}
      anchorPos={trigger.from}
      id={id}
      label={t('editor.slash.label')}
      items={commands}
      activeIndex={activeIndex}
      itemKey={(command) => command.id}
      emptyText={t('editor.slash.empty')}
      onChoose={choose}
      onHover={setActiveIndex}
      renderItem={(command) => {
        const Icon = command.icon;
        return (
          <>
            <Icon size={18} aria-hidden="true" focusable="false" className="editor-popup__icon" />
            <span className="editor-popup__label">{label(command)}</span>
          </>
        );
      }}
    />
  );
}
