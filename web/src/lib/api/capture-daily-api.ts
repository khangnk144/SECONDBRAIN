/** Quick capture and daily-note endpoints. `GET` never creates anything (SPEC §5). */
import { api } from '../api';
import type {
  CaptureResponse,
  CreateDailyResponse,
  DailyNeighbors,
  DailyNoteResponse,
} from './capture-daily-types';
import { withQuery } from './query-string';

/** Saves `text` as a new note in `0 Inbox` (the server names it). */
export function postCapture(text: string): Promise<CaptureResponse> {
  return api().request<CaptureResponse>('/capture', { method: 'POST', body: { text } });
}

/** 404 NOT_FOUND when the daily note of `date` does not exist. */
export function getDaily(date: string): Promise<DailyNoteResponse> {
  return api().get<DailyNoteResponse>(withQuery('/daily', { date }));
}

/** Creates the daily note from `Templates/Daily.md`; 409 EXISTS (`details.path`) when present. */
export function postDaily(date: string): Promise<CreateDailyResponse> {
  return api().request<CreateDailyResponse>('/daily', { method: 'POST', body: { date } });
}

export function getDailyNeighbors(date: string): Promise<DailyNeighbors> {
  return api().get<DailyNeighbors>(withQuery('/daily/neighbors', { date }));
}
