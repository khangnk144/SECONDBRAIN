import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../lib/api-client';
import { getTemplateUpgrades, upgradeTemplates } from '../../lib/api/templates-api';
import type { TemplateUpgradeItem } from '../../lib/api/templates-types';
import { noteTitleFromPath } from '../../lib/vault-paths';
import { ActionMessage } from './action-message';
import { settingsSaveError } from './settings-errors';
import { formatList } from './settings-format';
import { useActionStatus } from './use-action-status';

/** "Templates/Paper.md" → "Paper.md" (the name she knows the file by). */
const fileName = (path: string) => `${noteTitleFromPath(path)}.md`;

/**
 * "Cập nhật mẫu" (owner request: the richer Paper format): offered only while a bundled file is
 * still exactly a version the app wrote; a file she edited is named and left alone (no button).
 * Shows nothing when every file is current or missing ("Khôi phục mẫu gốc" handles missing ones).
 */
export function TemplatesUpgradeRow() {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<TemplateUpgradeItem[]>([]);
  const { state, run } = useActionStatus();
  const message = useRef<HTMLParagraphElement>(null);
  const refresh = useCallback(async () => {
    try {
      setItems(await getTemplateUpgrades());
    } catch {
      // Not offered when the server cannot tell; the rest of Settings works as before.
      setItems([]);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upgradable = items.filter((item) => item.state === 'upgradable');
  const edited = items.filter((item) => item.state === 'edited');
  const hasButton = upgradable.length > 0;
  // The button goes away with a successful update: focus moves on to the outcome sentence
  // instead of falling to the page (the next Tab would start over at the top).
  useEffect(() => {
    if (state.kind !== 'done' && state.kind !== 'error') return;
    const active = document.activeElement;
    if (active === null || active === document.body) message.current?.focus();
  }, [state, hasButton]);
  if (upgradable.length === 0 && edited.length === 0 && state.kind === 'idle') return null;

  const onUpgrade = () =>
    void run(
      async () => {
        try {
          const result = await upgradeTemplates(upgradable.map((item) => item.path));
          // By name ("Paper.md và CLAUDE.md"): she may not think of CLAUDE.md as a template.
          const done =
            result.upgraded.length === 0
              ? t('settings.vault.templatesUpgradeNone')
              : t('settings.vault.templatesUpgradeDone', {
                  count: result.upgraded.length,
                  names: formatList(result.upgraded.map(fileName), i18n.language),
                });
          const kept = result.skipped
            .filter((skip) => skip.reason === 'edited')
            .map((skip) =>
              t('settings.vault.templatesUpgradeEdited', { name: fileName(skip.path) }),
            );
          return [done, ...kept].join(' ');
        } finally {
          await refresh();
        }
      },
      (error) =>
        isApiError(error, 'CONFLICT')
          ? t('settings.vault.templatesUpgradeConflict')
          : settingsSaveError(error),
    );

  return (
    <div className="settings-field">
      {/* Without the button, the label says what the sentences below are about. */}
      {upgradable.length === 0 ? (
        <p className="settings-field__label">{t('settings.vault.templatesUpgradeLabel')}</p>
      ) : null}
      {upgradable.length > 0 ? (
        <>
          <p className="settings-field__hint">
            {t('settings.vault.templatesUpgradeOffer', {
              names: formatList(
                upgradable.map((item) => fileName(item.path)),
                i18n.language,
              ),
            })}
          </p>
          <div className="settings-field__control">
            <button
              type="button"
              className="button button--secondary"
              aria-disabled={state.kind === 'busy' || undefined}
              aria-describedby="settings-templates-upgrade-hint"
              onClick={onUpgrade}
            >
              {t('settings.vault.templatesUpgrade')}
            </button>
          </div>
          <p id="settings-templates-upgrade-hint" className="settings-field__hint">
            {t('settings.vault.templatesUpgradeHint')}
          </p>
        </>
      ) : null}
      {edited.map((item) => (
        <p key={item.path} className="settings-field__hint">
          {t('settings.vault.templatesUpgradeEdited', { name: fileName(item.path) })}
        </p>
      ))}
      <ActionMessage
        state={state}
        busyText={t('settings.vault.templatesUpgradeBusy')}
        messageRef={message}
      />
    </div>
  );
}
