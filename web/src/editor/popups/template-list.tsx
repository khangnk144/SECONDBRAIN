import type { Editor } from '@tiptap/core';
import { FileText } from '@phosphor-icons/react';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getTemplates } from '../../lib/api/tree-api';
import type { TemplateInfo } from '../../lib/api/tree-types';
import { foldText } from '../../lib/fold-text';
import { showOperationError } from '../../lib/operation-errors';
import type { EditorContext } from '../editor-context';
import type { TriggerMatch } from '../extensions/editor-triggers';
import { useActiveIndex, usePopupKeys } from './popup-hooks';
import { listKeyHandler, SuggestionListbox } from './suggestion-listbox';
import { insertTemplateBody, loadTemplateBody } from './template-insert';

interface TemplateListProps {
  editor: Editor;
  context: EditorContext;
  trigger: TriggerMatch;
}

type Load =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; templates: TemplateInfo[] };

/** Second step of "Mẫu": the templates of `Templates/`; choosing one inserts its body. */
export function TemplateList({ editor, context, trigger }: TemplateListProps) {
  const { t } = useTranslation();
  const id = useId();
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    getTemplates().then(
      ({ templates }) => alive && setLoad({ status: 'ready', templates }),
      () => alive && setLoad({ status: 'error' }),
    );
    return () => {
      alive = false;
    };
  }, []);

  const query = foldText(trigger.query);
  const templates =
    load.status === 'ready'
      ? load.templates.filter((template) => foldText(template.title).includes(query))
      : [];
  const [activeIndex, setActiveIndex] = useActiveIndex(trigger.query, templates.length);

  const choose = (index: number) => {
    const template = templates[index];
    if (!template) return;
    loadTemplateBody(template.path, context.getNotePath()).then(
      (body) => insertTemplateBody(editor, trigger, body),
      (error: unknown) => showOperationError(error),
    );
  };
  usePopupKeys(context, listKeyHandler(templates.length, activeIndex, setActiveIndex, choose));

  const emptyText =
    load.status === 'loading'
      ? t('editor.templates.loading')
      : load.status === 'error'
        ? t('editor.templates.loadError')
        : load.templates.length > 0
          ? t('editor.templates.noMatch')
          : t('editor.templates.empty');

  return (
    <SuggestionListbox
      editor={editor}
      anchorPos={trigger.from}
      id={id}
      label={t('editor.templates.label')}
      items={templates}
      activeIndex={activeIndex}
      itemKey={(template) => template.path}
      emptyText={emptyText}
      onChoose={choose}
      onHover={setActiveIndex}
      renderItem={(template) => (
        <>
          <FileText size={18} aria-hidden="true" focusable="false" className="editor-popup__icon" />
          <span className="editor-popup__label">{template.title}</span>
        </>
      )}
    />
  );
}
