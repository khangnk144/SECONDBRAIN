import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isInAiScope, useAiStatusStore } from '../../lib/ai-status-store';
import type { VaultPath } from '../../lib/api/vault-types';
import { PanelSection } from '../backlinks/panel-section';
import { AiChat } from './ai-chat';
import { chatSentCopy } from './chat-sent-copy';
import { noteThreadId } from './chat-types';

/**
 * "Hỏi" in the note's right pane (design.md screen 7): a small chat about this note (its path
 * goes with each question). First section, collapsed at first; the conversation of each note
 * stays while the window is open, also when the section is collapsed.
 */
export function AskSection({ path }: { path: VaultPath }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const status = useAiStatusStore((state) => state.status);
  // The server leaves a note outside the AI folders out of the answer; say so up front.
  const outOfScope = status?.ready === true && !isInAiScope(status, path);
  return (
    <PanelSection
      title={t('ai-chat.panel.title')}
      expanded={expanded}
      onToggle={() => setExpanded((value) => !value)}
    >
      <p className="panel-section__note">
        {t(outOfScope ? 'ai-chat.panel.outOfScope' : 'ai-chat.panel.intro')}
        {status?.ready ? ` ${chatSentCopy(status, t)}` : null}
      </p>
      <AiChat threadId={noteThreadId(path)} notePath={path} variant="panel" />
    </PanelSection>
  );
}
