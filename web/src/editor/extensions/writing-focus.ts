import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { useWritingFocus } from '../../lib/writing-focus-store';

/** Typing counts as continuous while the gaps between keys stay under this. */
export const TYPING_PAUSE_MS = 1_500;
/** SPEC F3: after 5 s of continuous typing both side panes fade (the layout clears it on mouse move). */
export const FOCUS_AFTER_MS = 5_000;

/** Focus mode: sets the writing-focus flag after a few seconds of uninterrupted typing. */
export const WritingFocus = Extension.create({
  name: 'writingFocus',

  addProseMirrorPlugins() {
    let startedAt = 0;
    let lastAt = Number.NEGATIVE_INFINITY;
    const typed = () => {
      const now = Date.now();
      if (now - lastAt > TYPING_PAUSE_MS) startedAt = now;
      lastAt = now;
      if (now - startedAt >= FOCUS_AFTER_MS) useWritingFocus.getState().setFocused(true);
    };
    return [
      new Plugin({
        key: new PluginKey('writingFocus'),
        props: {
          handleKeyDown: (_view, event) => {
            if (!event.ctrlKey && !event.metaKey && !event.altKey && isTypingKey(event.key))
              typed();
            return false;
          },
          handleDOMEvents: {
            // IME input (Telex, Unikey) arrives as input events rather than plain key presses.
            compositionupdate: () => {
              typed();
              return false;
            },
          },
        },
      }),
    ];
  },
});

function isTypingKey(key: string): boolean {
  return key.length === 1 || key === 'Enter' || key === 'Backspace' || key === 'Process';
}
