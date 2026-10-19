import type { Editor } from '@tiptap/core';
import { useEffect, useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TagCount } from '../../lib/api/search-types';
import type { EditorContext } from '../editor-context';
import type { TriggerMatch } from '../extensions/editor-triggers';
import { useActiveIndex, usePopupKeys } from './popup-hooks';
import { listKeyHandler, SuggestionListbox } from './suggestion-listbox';
import { rankTags, useTagSuggestions } from './tag-suggestions';
import { replaceTrigger } from './trigger-replace';

interface TagMenuProps {
  editor: Editor;
  context: EditorContext;
  trigger: TriggerMatch;
}

/** `#` autocomplete of existing tags (F6.1), nesting by `/` shown; inserts `#tag` as text. */
export function TagMenu({ editor, context, trigger }: TagMenuProps) {
  const { t } = useTranslation();
  const id = useId();
  const tags = useTagSuggestions((s) => s.tags);

  useEffect(() => {
    useTagSuggestions.getState().ensure();
  }, []);

  // A lone `#` at the start of a line is usually a heading on its way (`# `): wait for a letter.
  const atLineStart = editor.state.doc.resolve(trigger.from).parentOffset === 0;
  const hidden = atLineStart && trigger.query === '';
  const items = useMemo(
    () => (hidden ? [] : rankTags(tags, trigger.query)),
    [hidden, tags, trigger.query],
  );
  const [activeIndex, setActiveIndex] = useActiveIndex(trigger.query, items.length);

  const choose = (index: number) => {
    const tag = items[index];
    if (!tag) return;
    // No space after it: a space at the end of a line would be saved as `&#x20;`.
    replaceTrigger(editor, trigger, `#${tag.tag}`);
  };
  usePopupKeys(context, listKeyHandler(items.length, activeIndex, setActiveIndex, choose));

  if (items.length === 0) return null;
  return (
    <SuggestionListbox
      editor={editor}
      anchorPos={trigger.from}
      id={id}
      label={t('editor.tag.label')}
      items={items}
      activeIndex={activeIndex}
      itemKey={(tag) => tag.norm}
      onChoose={choose}
      onHover={setActiveIndex}
      renderItem={(tag) => (
        <TagOption tag={tag} count={t('editor.tag.count', { count: tag.count })} />
      )}
    />
  );
}

function TagOption({ tag, count }: { tag: TagCount; count: string }) {
  const slash = tag.tag.lastIndexOf('/');
  return (
    <>
      <span className="editor-popup__label">
        <span className="tag-option__hash">#</span>
        {slash === -1 ? null : (
          <span className="tag-option__parent">{tag.tag.slice(0, slash + 1)}</span>
        )}
        {tag.tag.slice(slash + 1)}
      </span>
      <span className="editor-popup__meta">{count}</span>
    </>
  );
}
