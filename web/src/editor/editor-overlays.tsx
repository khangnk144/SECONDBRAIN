import type { Editor } from '@tiptap/core';
import { useEffect, useState } from 'react';
import type { EditorContext, TargetMenuRequest } from './editor-context';
import { DatePopup } from './popups/date-popup';
import { useActiveTrigger } from './popups/popup-hooks';
import { SlashMenu } from './popups/slash-menu';
import { TagMenu } from './popups/tag-menu';
import { TargetMenu } from './popups/target-menu';
import { WikilinkMenu } from './popups/wikilink-menu';

interface EditorOverlaysProps {
  editor: Editor;
  context: EditorContext;
}

/** Everything the editor shows above the text: the suggestion popups and the link target menu. */
export function EditorOverlays({ editor, context }: EditorOverlaysProps) {
  const [targetMenu, setTargetMenu] = useState<TargetMenuRequest | null>(null);
  const trigger = useActiveTrigger(editor);

  useEffect(() => {
    context.openTargetMenu = setTargetMenu;
    return () => {
      context.openTargetMenu = () => undefined;
    };
  }, [context]);

  const popupProps = trigger ? { editor, context, trigger } : null;
  // A new trigger (kind or start) gets a fresh popup: active option and mode start over.
  const key = trigger ? `${trigger.kind}:${trigger.from}` : 'none';
  return (
    <>
      {popupProps?.trigger.kind === 'slash' ? <SlashMenu key={key} {...popupProps} /> : null}
      {popupProps?.trigger.kind === 'wikilink' ? <WikilinkMenu key={key} {...popupProps} /> : null}
      {popupProps?.trigger.kind === 'tag' ? <TagMenu key={key} {...popupProps} /> : null}
      {popupProps?.trigger.kind === 'date' ? <DatePopup key={key} {...popupProps} /> : null}
      {targetMenu ? (
        <TargetMenu editor={editor} request={targetMenu} onClose={() => setTargetMenu(null)} />
      ) : null}
    </>
  );
}
