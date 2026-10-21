import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { saveAiAnswer } from '../../lib/api/ai-api';
import type { VaultPath } from '../../lib/api/vault-types';
import { useTabsStore } from '../../lib/tabs-store';
import { showToast, TOAST_MS } from '../../lib/toast-store';
import { useTreeStore } from '../../lib/tree-store';
import { parentFolder, pathKey } from '../../lib/vault-paths';
import { ModalFrame } from '../dialogs/modal-frame';
import './ai-chat.css';

const INBOX = '0 Inbox';
const WIKI = 'wiki';

/** The current note's folder when asked from a note, else the Inbox; then `wiki` (SPEC F33). */
export function saveFolders(notePath: VaultPath | null): string[] {
  const first = notePath !== null ? parentFolder(notePath) : INBOX;
  return pathKey(first) === pathKey(WIKI) ? [first] : [first, WIKI];
}

/**
 * "Lưu thành ghi chú": the question and the answer become a new note (`POST /ai/save-answer`;
 * the server names it and marks the answer as the AI's). A 4 s toast offers "Mở".
 */
export function SaveAnswerDialog({
  question,
  answer,
  notePath,
  onClose,
}: {
  question: string;
  answer: string;
  notePath: VaultPath | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const folders = saveFolders(notePath);
  const [folder, setFolder] = useState(folders[0] ?? INBOX);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const titleId = useId();
  const bodyId = useId();
  const firstRef = useRef<HTMLInputElement>(null);

  async function save() {
    if (saving) return;
    setSaving(true);
    setFailed(false);
    try {
      const { path } = await saveAiAnswer({ question, answer, folder });
      useTreeStore.getState().scheduleRefresh();
      onClose();
      showToast({
        message: t('ai-chat.save.done'),
        // design.md §5: only toasts with "Hoàn tác" stay 10 s; "Mở" keeps the plain 4 s.
        durationMs: TOAST_MS,
        action: {
          label: t('ai-chat.save.open'),
          run: () => useTabsStore.getState().openNote(path),
        },
      });
    } catch {
      setSaving(false);
      setFailed(true);
    }
  }

  return createPortal(
    <ModalFrame
      labelledBy={titleId}
      describedBy={bodyId}
      onCancel={onClose}
      initialFocus={firstRef}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h2 id={titleId} className="modal__title">
          {t('ai-chat.save.title')}
        </h2>
        <p id={bodyId} className="modal__body">
          {t('ai-chat.save.body')}
        </p>
        <fieldset className="ai-save__folders">
          <legend className="modal__label">{t('ai-chat.save.folderLabel')}</legend>
          {folders.map((option, index) => (
            <label key={option} className="ai-save__folder">
              <input
                ref={index === 0 ? firstRef : undefined}
                type="radio"
                name={`${titleId}-folder`}
                value={option}
                checked={folder === option}
                onChange={() => setFolder(option)}
              />
              <span>{option === '' ? t('ai-chat.save.root') : option}</span>
            </label>
          ))}
        </fieldset>
        {failed ? (
          <p className="modal__error" role="alert">
            {t('ai-chat.save.failed')}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button button--secondary" onClick={onClose}>
            {t('ai-chat.save.cancel')}
          </button>
          <button
            type="submit"
            className="button button--primary"
            aria-disabled={saving ? true : undefined}
          >
            {saving ? t('ai-chat.save.saving') : t('ai-chat.save.confirm')}
          </button>
        </div>
      </form>
    </ModalFrame>,
    document.body,
  );
}
