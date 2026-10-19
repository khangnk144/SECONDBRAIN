import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { EditorContext } from '../editor-context';
import { matchTrigger, TRIGGER_KINDS, type TriggerMatch } from './trigger-matchers';

export type { TriggerKind, TriggerMatch } from './trigger-matchers';

interface TriggerMeta {
  close?: true;
}

export const triggersKey = new PluginKey<TriggerMatch | null>('editorTriggers');

/**
 * Tracks which popup the text before the caret asks for. A popup opens only when its trigger was
 * just typed (`/` on an empty line, `[[`, `#`, `@`, `📅`) – never because the caret moved next to
 * old text – follows the query while the caret stays inside it, and closes on Esc, blur, a
 * selection, or when the text stops matching. While one is open, keys go to its handler first.
 */
export function createEditorTriggers(context: EditorContext) {
  return Extension.create({
    name: 'editorTriggers',
    // Before every keymap, so Enter/arrows reach the popup instead of splitting the paragraph.
    priority: 1100,

    addProseMirrorPlugins() {
      return [
        new Plugin<TriggerMatch | null>({
          key: triggersKey,
          state: {
            init: () => null,
            apply: (tr, previous, _old, state) => nextTrigger(tr, previous, state),
          },
          props: {
            handleKeyDown: (view, event) => {
              if (!triggersKey.getState(view.state)) return false;
              if (event.key === 'Escape') {
                closeTrigger(view);
                return true;
              }
              return context.popupKeyHandler?.(event) ?? false;
            },
            handleDOMEvents: {
              blur: (view) => {
                if (triggersKey.getState(view.state)) closeTrigger(view);
                return false;
              },
            },
          },
        }),
      ];
    },
  });
}

function nextTrigger(
  tr: Transaction,
  previous: TriggerMatch | null,
  state: EditorState,
): TriggerMatch | null {
  const meta = tr.getMeta(triggersKey) as TriggerMeta | undefined;
  if (meta?.close) return null;
  const { selection } = state;
  if (!selection.empty) return null;
  const $pos = selection.$from;
  if (previous) {
    const kept = matchTrigger(previous.kind, $pos);
    if (kept && kept.from === tr.mapping.map(previous.from)) return kept;
  }
  // Opening needs fresh typing: the trigger characters end at the caret with nothing after them.
  if (!tr.docChanged || tr.getMeta('paste') || tr.getMeta('uiEvent') === 'paste') return null;
  for (const kind of TRIGGER_KINDS) {
    const match = matchTrigger(kind, $pos);
    if (match && match.query === '') return match;
  }
  return null;
}

export function closeTrigger(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(triggersKey, { close: true } satisfies TriggerMeta));
}

export function activeTrigger(state: EditorState): TriggerMatch | null {
  return triggersKey.getState(state) ?? null;
}
