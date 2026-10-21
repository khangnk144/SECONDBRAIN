/**
 * Where Inbox tidying starts: a quiet "Gợi ý chỗ để" on a note directly in `0 Inbox` (note header
 * and tree menu) and "Dọn Inbox với AI" on the Inbox folder's menu (the palette command is in
 * `ai-inbox-commands.ts`). Nothing shows before the AI status is known or when the server has no
 * AI; when AI is not ready or the Inbox is out of scope the entries are disabled with the reason.
 */
import { Sparkle } from '@phosphor-icons/react';
import type { TFunction } from 'i18next';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { VaultPath } from '../../lib/api/vault-types';
import { useAiStatusStore } from '../../lib/ai-status-store';
import { INBOX_FOLDER, samePath } from '../../lib/vault-paths';
import { aiBlocker, blockerReasonKey } from '../ai-actions/ai-readiness';
import type { PopupMenuItem } from '../dialogs/popup-menu';
import { INBOX_PROBE_PATH, isDirectlyInInbox } from './inbox-notes';
import { openInboxTidy } from './inbox-tidy-store';
import './ai-inbox.css';

/** The reason Inbox tidying cannot run now (short form), or null. */
function inboxBlockReason(t: TFunction, path: VaultPath = INBOX_PROBE_PATH): string | null {
  const blocker = aiBlocker(useAiStatusStore.getState().status, path);
  return blocker ? t(blockerReasonKey(blocker)) : null;
}

/** Tree context-menu entries for an Inbox note or the Inbox folder (none for other rows). */
export function inboxTreeMenuItems(
  row: { kind: 'note' | 'folder'; path: VaultPath },
  t: TFunction,
): PopupMenuItem[] {
  if (useAiStatusStore.getState().status?.available !== true) return [];
  if (row.kind === 'note' && isDirectlyInInbox(row.path)) {
    const reason = inboxBlockReason(t, row.path);
    return [
      {
        id: 'ai-placement',
        label: t('ai-actions.inbox.menuItem'),
        icon: Sparkle,
        disabled: reason !== null,
        disabledReason: reason ?? undefined,
        onSelect: () => openInboxTidy({ kind: 'one', path: row.path }),
      },
    ];
  }
  if (row.kind === 'folder' && samePath(row.path, INBOX_FOLDER)) {
    const reason = inboxBlockReason(t);
    return [
      {
        id: 'ai-tidy-inbox',
        label: t('ai-actions.inbox.folderMenuItem'),
        icon: Sparkle,
        disabled: reason !== null,
        disabledReason: reason ?? undefined,
        onSelect: () => openInboxTidy({ kind: 'all' }),
      },
    ];
  }
  return [];
}

interface NoteInboxActionProps {
  path: VaultPath;
  /** Saves pending typing first: AI reads the note from disk. */
  beforeOpen: () => Promise<unknown>;
}

/** "Gợi ý chỗ để" in the note header, for a note directly in the Inbox. */
export function NoteInboxAction({ path, beforeOpen }: NoteInboxActionProps) {
  const { t } = useTranslation();
  const reasonId = useId();
  const status = useAiStatusStore((store) => store.status);
  if (status?.available !== true || !isDirectlyInInbox(path)) return null;
  const blocker = aiBlocker(status, path);
  const reason = blocker ? t(blockerReasonKey(blocker)) : null;
  return (
    <>
      <button
        type="button"
        className="ai-inbox-action"
        aria-disabled={reason ? true : undefined}
        aria-describedby={reason ? reasonId : undefined}
        title={reason ?? undefined}
        onClick={async () => {
          if (reason) return;
          await beforeOpen();
          openInboxTidy({ kind: 'one', path });
        }}
      >
        <Sparkle size={16} aria-hidden="true" />
        <span>{t('ai-actions.inbox.menuItem')}</span>
      </button>
      {reason ? (
        <span id={reasonId} hidden>
          {reason}
        </span>
      ) : null}
    </>
  );
}
