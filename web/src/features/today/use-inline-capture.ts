import { useRef, useState, type KeyboardEvent } from 'react';
import { captureToInbox } from '../../lib/capture-flow';

/** Enter while an input method is still composing a character (macOS Vietnamese, IMEs) is not "save". */
function isComposing(event: KeyboardEvent<HTMLElement>): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

export interface InlineCapture {
  text: string;
  setText: (text: string) => void;
  saving: boolean;
  save: () => Promise<void>;
  /** Enter saves; Shift+Enter is left to the field (a new line in a textarea). */
  onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}

/**
 * Today's "Ghi nhanh" (SPEC F12), for the calm textarea and the Bento input alike: the text
 * empties after saving to Inbox; while saving the field is read-only (a disabled field would drop
 * focus); when saving fails the text stays, so nothing typed is lost.
 */
export function useInlineCapture(): InlineCapture {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  async function save() {
    if (busy.current || text.trim() === '') return;
    busy.current = true;
    setSaving(true);
    const path = await captureToInbox(text);
    busy.current = false;
    setSaving(false);
    if (path !== null) setText('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || isComposing(event)) return;
    event.preventDefault();
    void save();
  }

  return { text, setText, saving, save, onKeyDown };
}
