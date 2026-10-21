/** Palette command "Dọn Inbox với AI" (SPEC F8 registry, feature `ai`). */
import type { AppCommand } from '../../lib/commands/command-registry';
import { openInboxTidy } from './inbox-tidy-store';

export const AI_INBOX_COMMANDS: readonly AppCommand[] = [
  {
    id: 'ai-tidy-inbox',
    labelKey: 'ai-actions.commands.tidyInbox',
    keywords: ['ai', 'inbox', 'dọn', 'sắp xếp', 'tidy', 'sort', 'gợi ý'],
    feature: 'ai',
    run: () => openInboxTidy({ kind: 'all' }),
  },
];
