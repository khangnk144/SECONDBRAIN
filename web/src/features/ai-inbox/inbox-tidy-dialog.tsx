import { X } from '@phosphor-icons/react';
import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { isInAiScope, useAiStatusStore } from '../../lib/ai-status-store';
import { meaningProviderValues, providerValues } from '../ai-actions/ai-error-message';
import { aiBlocker, blockerMessage, blockerNeedsSettings } from '../ai-actions/ai-readiness';
import { openAiSettings } from '../ai-actions/open-ai-settings';
import { ModalFrame } from '../dialogs/modal-frame';
import { InboxNoteRow } from './inbox-note-row';
import { INBOX_PROBE_PATH } from './inbox-notes';
import type { InboxTidyMode } from './inbox-tidy-store';
import { useInboxList } from './use-inbox-list';
import { usePlacementRows, type RowState } from './use-placement-rows';
import './ai-inbox.css';

interface InboxTidyDialogProps {
  mode: InboxTidyMode;
  onClose: () => void;
}

/**
 * What goes where, honestly: the list says what "Gợi ý" will send; the one-note dialog (asked from
 * the note itself) says, once the request went out, what was sent. In hybrid mode the note's text
 * also goes to the embedding provider to find related notes.
 */
function useSentLine(onePath: string | null, row: RowState | undefined): string | null {
  const { t } = useTranslation();
  const status = useAiStatusStore((store) => store.status);
  const meaning = meaningProviderValues(status, t);
  if (onePath === null) {
    const sends = t('ai-actions.inbox.sends', providerValues(status, t));
    return meaning ? `${sends} ${t('ai-actions.inbox.sendsHybrid', meaning)}` : sends;
  }
  // Nothing is said before the request leaves, nor after a refusal or failure (the error does).
  if (row === undefined || row.kind === 'idle' || row.kind === 'error') return null;
  const sent = t('ai-actions.inbox.oneSent', providerValues(status, t));
  return meaning ? `${sent} ${t('ai-actions.inbox.oneSentHybrid', meaning)}` : sent;
}

/**
 * "Dọn Inbox với AI" (PLAN Giai đoạn 3, owner request R1): every Inbox note with "Gợi ý" per row;
 * AI proposes a folder and a clearer name; "Áp dụng" moves/renames through the journaled
 * operations with undo. In "Gợi ý chỗ để" mode it shows one note and asks at once. When AI is not
 * ready or the Inbox is out of scope it says so and sends nothing.
 */
export function InboxTidyDialog({ mode, onClose }: InboxTidyDialogProps) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const status = useAiStatusStore((store) => store.status);
  const { list, lines, retry } = useInboxList(mode);
  const rows = usePlacementRows();
  const blocker =
    aiBlocker(status, null) ??
    (isInAiScope(status, INBOX_PROBE_PATH) ? null : ('out-of-scope' as const));

  // "Gợi ý chỗ để" was the request itself: ask once, as soon as the note is listed.
  const asked = useRef(false);
  const onePath = mode.kind === 'one' ? mode.path : null;
  useEffect(() => {
    if (onePath === null || asked.current || blocker || list.status !== 'ready') return;
    asked.current = true;
    rows.suggest(onePath);
  }, [onePath, blocker, list.status, rows]);

  const apply = async (path: string) => {
    const moved = await rows.apply(path);
    if (moved !== null && mode.kind === 'one') onClose();
  };
  const leaveForSettings = () => {
    onClose();
    openAiSettings();
  };

  const blocked = blocker
    ? blocker === 'out-of-scope'
      ? { key: 'ai-actions.inbox.outOfScope', values: {} }
      : blockerMessage(blocker, status, i18n.language)
    : null;
  const sentLine = useSentLine(onePath, onePath !== null ? rows.rows[onePath] : undefined);

  return (
    <ModalFrame labelledBy={titleId} onCancel={onClose} className="inbox-tidy">
      <div className="inbox-tidy__header">
        <h2 id={titleId} className="modal__title">
          {t(mode.kind === 'one' ? 'ai-actions.inbox.oneTitle' : 'ai-actions.inbox.title')}
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label={t('ai-actions.inbox.close')}
          onClick={onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      {blocked && blocker ? (
        <>
          <p role="alert" className="modal__body">
            {t(blocked.key, blocked.values)}
          </p>
          {blockerNeedsSettings(blocker) ? (
            <div className="modal__actions">
              <button type="button" className="button button--secondary" onClick={leaveForSettings}>
                {t('ai-actions.panel.openSettings')}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <p className="modal__body">
            {t(onePath !== null ? 'ai-actions.inbox.oneIntro' : 'ai-actions.inbox.intro')}
          </p>
          {sentLine ? <p className="modal__hint">{sentLine}</p> : null}
          {list.status === 'loading' ? (
            <p role="status" className="modal__hint">
              {t('ai-actions.inbox.loading')}
            </p>
          ) : list.status === 'error' ? (
            <div className="inbox-tidy__actions">
              <p role="alert" className="modal__hint">
                {t('ai-actions.inbox.loadFailed')}
              </p>
              <button type="button" className="button button--secondary" onClick={retry}>
                {t('ai-actions.panel.retry')}
              </button>
            </div>
          ) : list.notes.length === 0 ? (
            <p className="modal__body">{t('ai-actions.inbox.empty')}</p>
          ) : (
            <ul className="inbox-tidy__list" aria-label={t('ai-actions.inbox.listLabel')}>
              {list.notes.map((note) => (
                <InboxNoteRow
                  key={note.path}
                  path={note.path}
                  title={note.title}
                  line={lines[note.path]}
                  row={rows.rows[note.path] ?? { kind: 'idle' }}
                  busyElsewhere={rows.busyPath !== null && rows.busyPath !== note.path}
                  status={status}
                  primaryApply={onePath !== null}
                  onSuggest={() => rows.suggest(note.path)}
                  onCancel={rows.cancel}
                  onToggle={(part) => rows.toggle(note.path, part)}
                  onApply={() => void apply(note.path)}
                  onSkip={() => rows.skip(note.path)}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </ModalFrame>
  );
}
