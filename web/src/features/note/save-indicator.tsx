import {
  CheckCircle,
  CircleNotch,
  PencilSimpleLine,
  Warning,
  WarningCircle,
  type Icon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { SaveStatus } from '../note-session/note-session-types';

const STATES: Partial<Record<SaveStatus, { key: string; icon: Icon }>> = {
  dirty: { key: 'note.save.draft', icon: PencilSimpleLine },
  draft: { key: 'note.save.draft', icon: PencilSimpleLine },
  saving: { key: 'note.save.saving', icon: CircleNotch },
  saved: { key: 'note.save.saved', icon: CheckCircle },
  error: { key: 'note.save.error', icon: WarningCircle },
  conflict: { key: 'note.save.conflict', icon: Warning },
};

interface SaveIndicatorProps {
  status: SaveStatus;
  onRetry: () => void;
}

/**
 * The real save state (SPEC §5, design.md screen 2): "Đang lưu…", "Đã lưu" (only once the server
 * confirmed), "Bản nháp", "Lỗi lưu" with "Thử lại", "Xung đột". Always words, never colour alone.
 */
export function SaveIndicator({ status, onRetry }: SaveIndicatorProps) {
  const { t } = useTranslation();
  const state = STATES[status];
  const StateIcon = state?.icon;
  return (
    <div className="save-indicator" data-status={status}>
      <span className="save-indicator__state" role="status" aria-live="polite">
        {state && StateIcon ? (
          <>
            <StateIcon size={16} aria-hidden="true" className="save-indicator__icon" />
            <span>{t(state.key)}</span>
          </>
        ) : null}
      </span>
      {status === 'error' ? (
        <button type="button" className="save-indicator__retry" onClick={onRetry}>
          {t('note.save.retry')}
        </button>
      ) : null}
    </div>
  );
}
