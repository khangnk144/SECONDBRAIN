/**
 * Palette commands for the AI actions on a selection (SPEC F8 registry, feature `ai`): listed
 * while a note editor holds a selection; each opens the same result panel as the AI menu.
 */
import type { AppCommand } from '../../lib/commands/command-registry';
import { AI_EDITOR_ACTIONS, type AiEditorAction } from './ai-action-kinds';
import { aiActionTarget } from './ai-action-target';

const KEYWORDS: Record<AiEditorAction, readonly string[]> = {
  summarize: ['ai', 'tóm tắt', 'summary', 'summarize'],
  improve: ['ai', 'viết lại', 'rewrite', 'improve', 'wording', 'sửa câu'],
  explain: ['ai', 'giải thích', 'explain'],
  'suggest-links': ['ai', 'liên kết', 'link', 'gợi ý'],
  'suggest-tags': ['ai', 'thẻ', 'tag', 'gợi ý'],
};

export const AI_ACTION_COMMANDS: readonly AppCommand[] = AI_EDITOR_ACTIONS.map((action) => ({
  id: `ai-${action}`,
  labelKey: `ai-actions.commands.${action}`,
  keywords: KEYWORDS[action],
  feature: 'ai' as const,
  isAvailable: () => aiActionTarget()?.hasSelection() === true,
  run: () => aiActionTarget()?.start(action),
}));
