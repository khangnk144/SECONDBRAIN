/** "Cập nhật mẫu" (owner request: the richer Paper format). */
import { api } from '../api';
import type { TemplateUpgradeItem, TemplateUpgradeResult } from './templates-types';
import type { VaultPath } from './vault-types';

/** Which bundled files could get the new text (read-only). */
export async function getTemplateUpgrades(): Promise<TemplateUpgradeItem[]> {
  const { items } = await api().get<{ items: TemplateUpgradeItem[] }>('/templates/upgrades');
  return items;
}

/** Replaces the given files when still unedited; the old copies go to the trash. */
export function upgradeTemplates(paths: VaultPath[]): Promise<TemplateUpgradeResult> {
  return api().request<TemplateUpgradeResult>('/templates/upgrade', {
    method: 'POST',
    body: { paths },
  });
}
