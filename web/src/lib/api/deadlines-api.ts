/** Today, Calendar, Tasks and the line patches that change a deadline (SPEC §4.7, F9–F11). */
import { api } from '../api';
import type {
  CalendarView,
  PatchTaskRequest,
  PatchTaskResponse,
  RescheduleRequest,
  RescheduleResponse,
  TaskGroups,
  TodayView,
} from './deadlines-types';
import { withQuery } from './query-string';

export interface IncludeArchiveOption {
  /** Also list items of `4 Archive` (the "Bao gồm Archive" toggle). */
  includeArchive?: boolean;
}

/** Only sent when asked for, so the default request stays the plain route. */
function archiveParam(options: IncludeArchiveOption): true | undefined {
  return options.includeArchive === true ? true : undefined;
}

export function getToday(): Promise<TodayView> {
  return api().get<TodayView>('/today');
}

/** `month` is `YYYY-MM`. */
export function getCalendar(
  month: string,
  options: IncludeArchiveOption = {},
): Promise<CalendarView> {
  return api().get<CalendarView>(
    withQuery('/calendar', { month, includeArchive: archiveParam(options) }),
  );
}

export function getTasks(options: IncludeArchiveOption = {}): Promise<TaskGroups> {
  return api().get<TaskGroups>(withQuery('/tasks', { includeArchive: archiveParam(options) }));
}

/** Ticks/unticks or re-dates one task line at a revision. */
export function patchTask(body: PatchTaskRequest): Promise<PatchTaskResponse> {
  return api().request<PatchTaskResponse>('/note/task', { method: 'PATCH', body });
}

/** Moves a note deadline or a task due date; answers with the journal id for undo. */
export function postReschedule(body: RescheduleRequest): Promise<RescheduleResponse> {
  return api().request<RescheduleResponse>('/note/reschedule', { method: 'POST', body });
}
