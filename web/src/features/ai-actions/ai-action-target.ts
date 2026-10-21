/**
 * The note editor that AI palette commands act on: the note screen registers itself while it is
 * shown (one at a time; the newest wins), so a command can ask whether there is a selection and
 * start an action on it.
 */
import type { AiEditorAction } from './ai-action-kinds';

export interface AiActionTarget {
  /** A non-blank selection in the rich editor. */
  hasSelection(): boolean;
  /** Opens the result panel for `action` on the selection (or says why it cannot run). */
  start(action: AiEditorAction): void;
}

let current: AiActionTarget | null = null;

export function registerAiActionTarget(target: AiActionTarget): () => void {
  current = target;
  return () => {
    if (current === target) current = null;
  };
}

export function aiActionTarget(): AiActionTarget | null {
  return current;
}
