/**
 * "Cập nhật mẫu" (`GET /api/templates/upgrades`, `POST /api/templates/upgrade`), mirrored by hand
 * from `server/src/templates/template-upgrades.ts`.
 */
import type { VaultPath } from './vault-types';

/**
 * `upgradable`: byte-identical to an older bundled version; `edited`: changed by her (never
 * replaced); `current`: already the newest; `missing`: not in the vault.
 */
export type TemplateUpgradeState = 'upgradable' | 'edited' | 'current' | 'missing';

export interface TemplateUpgradeItem {
  path: VaultPath;
  state: TemplateUpgradeState;
}

export interface TemplateUpgradeResult {
  upgraded: VaultPath[];
  skipped: { path: string; reason: Exclude<TemplateUpgradeState, 'upgradable'> | 'unknown' }[];
}
