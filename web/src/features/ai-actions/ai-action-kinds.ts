/** The AI actions on a selection (SPEC F33 "editor actions"), in menu order. */
import {
  Hash,
  Lightbulb,
  LinkSimple,
  MagicWand,
  TextAlignLeft,
  type Icon,
} from '@phosphor-icons/react';

export const AI_EDITOR_ACTIONS = [
  'summarize',
  'improve',
  'explain',
  'suggest-links',
  'suggest-tags',
] as const;

export type AiEditorAction = (typeof AI_EDITOR_ACTIONS)[number];

export const AI_ACTION_ICONS: Record<AiEditorAction, Icon> = {
  summarize: TextAlignLeft,
  improve: MagicWand,
  explain: Lightbulb,
  'suggest-links': LinkSimple,
  'suggest-tags': Hash,
};

export function aiActionLabelKey(action: AiEditorAction): string {
  return `ai-actions.actions.${action}`;
}

/** Longest selection the server takes (`MAX_ACTION_TEXT`); longer ones are refused up front. */
export const MAX_SELECTION_CHARS = 20_000;
