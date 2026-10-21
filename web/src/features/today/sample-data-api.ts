/** The opt-in sample data of SPEC §10, mirrored by hand from `server/src/sample-data/`. */
import { api } from '../../lib/api';
import type { VaultPath } from '../../lib/api/vault-types';

/** `GET /api/sample-data`. */
export interface SampleDataStatus {
  /** First run: no sample set recorded yet and no notes of the user's own. */
  offered: boolean;
  /** Sample files are recorded and may be removed. */
  present: boolean;
}

export function getSampleDataStatus(): Promise<SampleDataStatus> {
  return api().get<SampleDataStatus>('/sample-data');
}

/** `POST /api/sample-data` (201): answers once the index already shows the new notes. */
export function postSampleData(): Promise<{ created: VaultPath[] }> {
  return api().request<{ created: VaultPath[] }>('/sample-data', { method: 'POST' });
}
