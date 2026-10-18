// Note kinds of the generated vault and how strongly each kind attracts bytes, links and tasks.

export type NoteKind =
  | 'course'
  | 'lecture'
  | 'project'
  | 'inbox'
  | 'area'
  | 'resource'
  | 'archive'
  | 'wiki-paper'
  | 'wiki-concept'
  | 'wiki-gap'
  | 'wiki-control'
  | 'daily';

export const SIZE_WEIGHT: Record<NoteKind, number> = {
  course: 1.6,
  lecture: 1.3,
  project: 1.2,
  inbox: 0.3,
  area: 0.9,
  resource: 1.5,
  archive: 0.9,
  'wiki-paper': 1.4,
  'wiki-concept': 1,
  'wiki-gap': 1.2,
  'wiki-control': 0.8,
  daily: 0.5,
};
export const LINK_WEIGHT: Record<NoteKind, number> = {
  course: 1,
  lecture: 1.2,
  project: 1.5,
  inbox: 0.4,
  area: 0.8,
  resource: 0.4,
  archive: 0.7,
  'wiki-paper': 1.6,
  'wiki-concept': 1.8,
  'wiki-gap': 2,
  'wiki-control': 6,
  daily: 1,
};
// Only user notes (and archived ones) carry tasks; wiki pages and raw sources do not.
export const TASK_WEIGHT: Partial<Record<NoteKind, number>> = {
  project: 4,
  daily: 1.4,
  lecture: 0.6,
  course: 0.6,
  inbox: 0.5,
  area: 0.5,
  archive: 0.6,
};
