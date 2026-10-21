import { Warning } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { PendingJournalEntry } from '../../lib/api/journal-types';
import { useJournalStore } from './journal-store';
import './journal-banner.css';

const OP_KEYS = ['rename', 'move', 'trash', 'restore', 'reschedule'] as const;

/** Folder operations may use their own op names (`folder-rename`…); match by the verb they hold. */
function opKey(op: string): (typeof OP_KEYS)[number] | null {
  return OP_KEYS.find((key) => op.includes(key)) ?? null;
}

function EntryRow({ entry }: { entry: PendingJournalEntry }) {
  const { t } = useTranslation();
  const busy = useJournalStore((state) => state.busyId === entry.id);
  const key = opKey(entry.op);
  const counts = { done: entry.appliedSteps, count: entry.totalSteps };
  const message = key
    ? t('journal.pending', { ...counts, op: t(`journal.ops.${key}`) })
    : t('journal.pendingGeneric', counts);

  return (
    <li className="journal-banner__entry">
      <Warning size={18} aria-hidden="true" focusable="false" />
      <span className="journal-banner__message">{message}</span>
      <button
        type="button"
        className="journal-banner__button"
        disabled={busy}
        onClick={() => void useJournalStore.getState().complete(entry.id)}
      >
        {t('journal.complete')}
      </button>
      <button
        type="button"
        className="journal-banner__button"
        disabled={busy}
        onClick={() => void useJournalStore.getState().undo(entry.id)}
      >
        {t('journal.undo')}
      </button>
    </li>
  );
}

/** "Một thao tác đổi tên chưa hoàn tất (3/8 file)." with "Hoàn tất" / "Hoàn tác" (SPEC §4.12). */
export function JournalBanner() {
  const { t } = useTranslation();
  const entries = useJournalStore((state) => state.entries);
  if (entries.length === 0) return null;
  return (
    <section className="journal-banner" aria-label={t('journal.region')}>
      <ul>
        {entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} />
        ))}
      </ul>
    </section>
  );
}
