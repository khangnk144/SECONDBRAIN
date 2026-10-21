import { useTranslation } from 'react-i18next';
import type { VaultInfo } from '../../lib/api/settings-types';
import { BackupExportRow } from './backup-export-row';
import { BackupRestoreForm } from './backup-restore-form';
import { IndexRebuildRow } from './index-rebuild-row';
import { SettingsSection } from './settings-section';
import { TemplatesUpgradeRow } from './templates-upgrade-row';
import { LogsRevealRow, SampleDataRow, TemplatesRestoreRow } from './vault-maintenance-rows';
import { VaultSwitchForm } from './vault-switch-form';

/** "Kho ghi chú": which folder is open, switching, the index, backups and housekeeping. */
export function VaultSection({ vault }: { vault: VaultInfo | null }) {
  const { t } = useTranslation();
  return (
    <SettingsSection id="vault" title={t('settings.vault.title')}>
      <div className="settings-field">
        <p className="settings-field__label">{t('settings.vault.current')}</p>
        <p className="settings-field__value settings-path">
          {vault ? vault.path : t('settings.vault.none')}
        </p>
        {vault?.isDefault ? (
          <p className="settings-field__hint">{t('settings.vault.isDefault')}</p>
        ) : null}
        <VaultSwitchForm vault={vault} />
      </div>
      <IndexRebuildRow />
      <BackupExportRow />
      <div className="settings-field">
        <BackupRestoreForm />
      </div>
      <TemplatesRestoreRow />
      <TemplatesUpgradeRow />
      <SampleDataRow />
      <LogsRevealRow />
    </SettingsSection>
  );
}
