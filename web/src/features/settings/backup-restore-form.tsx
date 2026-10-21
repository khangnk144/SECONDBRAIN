import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { restoreBackup } from '../../lib/api/backup-api';
import { ActionMessage } from './action-message';
import { vaultActionError } from './settings-errors';
import { useActionStatus } from './use-action-status';
import { forgetVaultOpened, rememberVaultOpened } from './vault-opened-notice';
import { flushOpenNotes, reloadIntoOpenVault } from './vault-reload';

export type RestoreProblem = 'no-file' | 'not-zip' | 'no-target';

/** What is missing before the restore can start, or null. */
export function restoreFormProblem(file: File | null, target: string): RestoreProblem | null {
  if (!file) return 'no-file';
  if (!file.name.toLowerCase().endsWith('.zip')) return 'not-zip';
  if (target.trim() === '') return 'no-target';
  return null;
}

/**
 * "Khôi phục thử…" (SPEC F18.5): a backup zip goes into an empty folder (new or existing) and
 * opens there as the vault; the page then reloads into it. The current vault is never touched.
 */
export function BackupRestoreForm() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState('');
  const { state, run, set } = useActionStatus();
  const fileInput = useRef<HTMLInputElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) chooseButton.current?.focus();
  }, [open]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (state.kind === 'busy') return;
    const problem = restoreFormProblem(file, target);
    if (problem !== null || !file) {
      set({ kind: 'error', message: t(`settings.vault.restoreProblem.${problem ?? 'no-file'}`) });
      return;
    }
    void run(async () => {
      await flushOpenNotes({ save: true });
      // Remembered first: the switch event may reload the page before the answer arrives.
      rememberVaultOpened({ kind: 'restored', path: target.trim() });
      let restored: Awaited<ReturnType<typeof restoreBackup>>;
      try {
        restored = await restoreBackup(file, target.trim(), { open: true });
      } catch (error) {
        forgetVaultOpened();
        throw error;
      }
      rememberVaultOpened({ kind: 'restored', path: restored.path });
      await reloadIntoOpenVault();
      return t('settings.vault.restoreOpening');
    }, vaultActionError);
  };

  if (!open) {
    return (
      <div className="settings-field__control">
        <button type="button" className="button button--secondary" onClick={() => setOpen(true)}>
          {t('settings.vault.restore')}
        </button>
      </div>
    );
  }
  return (
    <form className="settings-form" onSubmit={submit} noValidate>
      <label className="settings-field__label" htmlFor="settings-restore-file">
        {t('settings.vault.restoreFile')}
      </label>
      <div className="settings-field__control">
        {/* The browser's own picker shows its own words and colours; the real input stays (out
            of sight and out of the tab order) and the button opens it. */}
        <input
          id="settings-restore-file"
          ref={fileInput}
          type="file"
          accept=".zip,application/zip"
          className="visually-hidden"
          tabIndex={-1}
          aria-describedby="settings-restore-file-name"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <button
          ref={chooseButton}
          type="button"
          className="button button--secondary"
          aria-describedby="settings-restore-file-name"
          onClick={() => fileInput.current?.click()}
        >
          {t(file ? 'settings.vault.restoreChooseOther' : 'settings.vault.restoreChoose')}
        </button>
        <span
          id="settings-restore-file-name"
          className={file ? 'settings-file-name' : 'settings-file-name settings-file-name--none'}
        >
          {file ? file.name : t('settings.vault.restoreNoFile')}
        </span>
      </div>
      <label className="settings-field__label" htmlFor="settings-restore-target">
        {t('settings.vault.restoreTarget')}
      </label>
      <div className="settings-field__control">
        <input
          id="settings-restore-target"
          className="text-input settings-input--path"
          value={target}
          placeholder={t('settings.vault.restoreTargetPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          aria-describedby="settings-restore-hint"
          onChange={(event) => setTarget(event.target.value)}
        />
        <button
          type="submit"
          className="button button--secondary"
          aria-disabled={state.kind === 'busy' || undefined}
        >
          {t('settings.vault.restoreSubmit')}
        </button>
      </div>
      <p id="settings-restore-hint" className="settings-field__hint">
        {t('settings.vault.restoreHint')}
      </p>
      <ActionMessage state={state} busyText={t('settings.vault.restoreBusy')} />
    </form>
  );
}
