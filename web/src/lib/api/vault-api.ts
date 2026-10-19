import { api } from '../api';
import type { HealthResponse, VaultPath } from './vault-types';

/** Liveness and the open vault's id (keys every per-vault browser state). */
export function getHealth(): Promise<HealthResponse> {
  return api().get<HealthResponse>('/health');
}

/** Opens the OS file manager with the file selected (204). */
export function postReveal(path: VaultPath): Promise<void> {
  return api().request<void>('/reveal', { method: 'POST', body: { path } });
}
