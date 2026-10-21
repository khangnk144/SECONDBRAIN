import { api } from '../api';
import type { RemindersResponse } from './reminders-types';

export function getReminders(): Promise<RemindersResponse> {
  return api().get<RemindersResponse>('/reminders');
}

/** "Bỏ qua": answers how many were newly dismissed (unknown keys are ignored). */
export function dismissReminders(keys: readonly string[]): Promise<{ dismissed: number }> {
  return api().request<{ dismissed: number }>('/reminders/dismiss', {
    method: 'POST',
    body: { keys },
  });
}
