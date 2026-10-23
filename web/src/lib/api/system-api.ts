/** How the app runs and the tray helper (SPEC F29.2, F29.4). */
import { api } from '../api';
import type { SystemInfo } from './system-types';

export function getSystemInfo(): Promise<SystemInfo> {
  return api().get<SystemInfo>('/system');
}

/** Re-creates the Desktop and Start-menu shortcuts (exe on Windows); 204. */
export function recreateShortcuts(): Promise<void> {
  return api().request<void>('/system/shortcuts', { method: 'POST' });
}
