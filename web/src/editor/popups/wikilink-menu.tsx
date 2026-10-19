import type { Editor } from '@tiptap/core';
import { Plus } from '@phosphor-icons/react';
import { useEffect, useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLinkTargetsStore } from '../../lib/link-targets-store';
import type { EditorContext } from '../editor-context';
import type { TriggerMatch } from '../extensions/editor-triggers';
import {
  hasExactTitle,
  parseLinkQuery,
  rankLinkCandidates,
  type LinkCandidate,
} from './link-candidates';
import { createLinkedNote } from './link-create';
import { useActiveIndex, usePopupKeys } from './popup-hooks';
import { listKeyHandler, SuggestionListbox } from './suggestion-listbox';
import { replaceTrigger } from './trigger-replace';

interface WikilinkMenuProps {
  editor: Editor;
  context: EditorContext;
  trigger: TriggerMatch;
}

type Item = { kind: 'note'; candidate: LinkCandidate } | { kind: 'create'; title: string };

/**
 * `[[` autocomplete (F4.1/F4.2): the best 8 notes with their folder, then "Tạo '<text>'". Enter
 * inserts a wikilink node with the title, or the path form when the title is not unique; text
 * typed after `#` or `|` becomes the heading or alias.
 */
export function WikilinkMenu({ editor, context, trigger }: WikilinkMenuProps) {
  const { t } = useTranslation();
  const id = useId();
  const titles = useLinkTargetsStore((s) => s.titles);
  const files = useLinkTargetsStore((s) => s.files);
  const status = useLinkTargetsStore((s) => s.status);
  const query = parseLinkQuery(trigger.query);

  useEffect(() => {
    if (status === 'idle') void useLinkTargetsStore.getState().fetchTargets();
  }, [status]);

  const candidates = useMemo(
    () => rankLinkCandidates(titles, files, query.search, trigger.embed),
    [titles, files, query.search, trigger.embed],
  );
  const items: Item[] = candidates.map((candidate) => ({ kind: 'note', candidate }));
  if (query.search !== '' && !trigger.embed && !hasExactTitle(candidates, query.search)) {
    items.push({ kind: 'create', title: query.search });
  }
  const [activeIndex, setActiveIndex] = useActiveIndex(trigger.query, items.length);

  const insertLink = (target: string) => {
    const type = editor.schema.nodes['wikilink'];
    if (!type) return;
    const attrs = { target, heading: query.heading, alias: query.alias, embed: trigger.embed };
    replaceTrigger(editor, trigger, type.create(attrs));
  };
  const choose = (index: number) => {
    const item = items[index];
    if (!item) return;
    if (item.kind === 'note') insertLink(item.candidate.target);
    else createLinkedNote(item.title, insertLink, editor);
  };
  usePopupKeys(context, listKeyHandler(items.length, activeIndex, setActiveIndex, choose));

  if (items.length === 0) return null;
  return (
    <SuggestionListbox
      editor={editor}
      anchorPos={trigger.from}
      id={id}
      label={t('editor.wikilink.label')}
      items={items}
      activeIndex={activeIndex}
      itemKey={(item) => (item.kind === 'note' ? item.candidate.path : 'create')}
      onChoose={choose}
      onHover={setActiveIndex}
      renderItem={(item) =>
        item.kind === 'note' ? (
          <>
            <span className="editor-popup__label">{item.candidate.title}</span>
            {item.candidate.folder ? (
              <span className="editor-popup__meta">{item.candidate.folder}</span>
            ) : null}
          </>
        ) : (
          <>
            <Plus size={18} aria-hidden="true" focusable="false" className="editor-popup__icon" />
            <span className="editor-popup__label">
              {t('editor.wikilink.create', { text: item.title })}
            </span>
          </>
        )
      }
    />
  );
}
