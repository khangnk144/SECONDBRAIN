/** The Settings screen's calls (SPEC §9, F18, F21), each one request. */
import { api } from '../api';
import type { SampleDataRemoval, SettingsPatch, SettingsResponse } from './settings-types';

export function getSettings(): Promise<SettingsResponse> {
  return api().get<SettingsResponse>('/settings');
}

/** Saves only the fields given; answers with the whole settings view. */
export function putSettings(patch: SettingsPatch): Promise<SettingsResponse> {
  return api().request<SettingsResponse>('/settings', { method: 'PUT', body: patch });
}

/** "Khôi phục mẫu gốc": re-creates missing bundled templates, never overwrites. */
export function restoreTemplates(): Promise<{ restored: string[] }> {
  return api().request<{ restored: string[] }>('/templates/restore', { method: 'POST' });
}

/** "Xóa dữ liệu mẫu": sample files moved to the trash, edited ones kept. */
export function deleteSampleData(): Promise<SampleDataRemoval> {
  return api().request<SampleDataRemoval>('/sample-data', { method: 'DELETE' });
}

/** "Mở thư mục log": opens the vault's log folder in the file manager. */
export function revealLogs(): Promise<void> {
  return api().request<void>('/logs/reveal', { method: 'POST' });
}

/** "Xây lại chỉ mục": 202 at once; progress arrives as `index:progress` events. */
export function startIndexRebuild(): Promise<{ started: true }> {
  return api().request<{ started: true }>('/index/rebuild', { method: 'POST' });
}

/** "Thoát Second Brain": the server answers 202, then stops. */
export function shutdownServer(): Promise<{ ok: true }> {
  return api().request<{ ok: true }>('/shutdown', { method: 'POST' });
}
