/** What the intent step decided about a chat question (SPEC F33 "structured questions first"). */
export type QuestionKind = 'deadlines' | 'tasks' | 'text';

export interface QuestionIntent {
  kind: QuestionKind;
  /** Inclusive calendar-date range asked about (both null when none). */
  from: string | null;
  to: string | null;
  /** Also list the open overdue items (in their own group). */
  overdue: boolean;
  /** Titles of course/project/research notes the question is about (from the offered list). */
  about: string[];
  /** Who decided: the model's JSON, or the local rules (provider error, invalid JSON, no corpus). */
  source: 'model' | 'rules';
}

/** Longest range a question may cover (a year, leap day included). */
export const MAX_RANGE_DAYS = 366;
