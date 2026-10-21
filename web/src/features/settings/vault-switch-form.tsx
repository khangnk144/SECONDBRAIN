import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { VaultInfo } from '../../lib/api/settings-types';
import { ActionMessage } from './action-message';
import { vaultActionError } from './settings-errors';
import { useActionStatus } from './use-action-status';
import { openOtherVault } from './vault-reload';

/**
 * "Mở thư mục khác…" (SPEC F18.3): unsaved edits are saved into the vault open now, then the
 * server switches; on success the page reloads into the other vault, on failure the message says
 * why and the current vault stays open.
 */
export function VaultSwitchForm({ vault }: { vault: VaultInfo | null }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState('');
  const { state, run, set } = useActionStatus();
  const input = useRef<HTMLInputElement>(null);
  // The field appears because she asked for it: the caret goes there.
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (state.kind === 'busy') return;
    const target = path.trim();
    if (target === '') {
      set({ kind: 'error', message: t('settings.vault.switchEmpty') });
      return;
    }
    void run(
      async () =>
        (await openOtherVault(target, vault)) === 'already-open'
          ? t('settings.vault.alreadyOpen')
          : t('settings.vault.switching'),
      vaultActionError,
    );
  };

  if (!open) {
    return (
      <div className="settings-field__control">
        <button type="button" className="button button--secondary" onClick={() => setOpen(true)}>
          {t('settings.vault.openOther')}
        </button>
      </div>
    );
  }
  return (
    <form className="settings-form" onSubmit={submit}>
      <label className="settings-field__label" htmlFor="settings-vault-path">
        {t('settings.vault.pathLabel')}
      </label>
      <div className="settings-field__control">
        <input
          id="settings-vault-path"
          className="text-input settings-input--path"
          value={path}
          placeholder={t('settings.vault.pathPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          ref={input}
          aria-describedby="settings-vault-path-hint"
          onChange={(event) => setPath(event.target.value)}
        />
        <button
          type="submit"
          className="button button--secondary"
          aria-disabled={state.kind === 'busy' || undefined}
        >
          {t('settings.vault.open')}
        </button>
      </div>
      <p id="settings-vault-path-hint" className="settings-field__hint">
        {t('settings.vault.pathHint')}
      </p>
      <ActionMessage state={state} busyText={t('settings.vault.switchBusy')} />
    </form>
  );
}
