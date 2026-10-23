/**
 * What the "Học kỳ này" page lists (SPEC F25.1), read from the index:
 * - courses: user notes (not `4 Archive`) with `type: course`, each with the number of user notes
 *   of `type: lecture` whose `course:` resolves to it;
 * - projects: user notes with `type: project | research` whose `status` is not `done`, with the
 *   deadline, days left (local calendar days) and done/total tasks of the note; grouped by the
 *   first `course:` value that resolves to a listed course, else under "Khác".
 * `course:` resolves like any link (SPEC §4.4) from the note that holds it.
 */
import { compareTitles, isDoneStatus } from '../index/deadline-rules.js';
import type { IndexedNote, IndexService } from '../index/index-types.js';
import { diffDays } from '../lib/local-date.js';
import type { LinkCatalog } from '../markdown/markdown-types.js';
import { resolveLink } from '../markdown/resolve-link.js';
import { parseWikilinkInner } from '../markdown/wikilink-scan.js';
import type { VaultPath } from '../vault/vault-types.js';

export interface CourseRow {
  path: VaultPath;
  title: string;
  lectures: number;
}

export interface ProjectRow {
  path: VaultPath;
  title: string;
  /** Path of the listed course it belongs to, or null ("Khác"). */
  course: VaultPath | null;
  deadline: string | null;
  /** Calendar days from today (negative = overdue), null without a deadline. */
  daysLeft: number | null;
  /** done/total tasks of the note; null when it has none ("chưa có việc"). */
  progress: { done: number; total: number } | null;
}

export interface SemesterRows {
  courses: CourseRow[];
  projects: ProjectRow[];
  /** Every user note of a page type (done projects too): an edit of one may change the page. */
  watched: VaultPath[];
}

export type SemesterIndex = Pick<IndexService, 'listNotes' | 'allTasks' | 'linkCatalog'>;

const PROJECT_TYPES = new Set(['project', 'research']);
/** Types whose notes change what the page shows (the plugin regenerates on their edits). */
export const PAGE_TYPES = new Set(['course', 'lecture', ...PROJECT_TYPES]);

export const typeOf = (note: Pick<IndexedNote, 'type'>): string =>
  note.type?.trim().toLowerCase() ?? '';

/** `course: "[[Giải tích 1]]"`, `course: Giải tích 1`, or a list of those → link targets. */
export function courseTargets(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const entry of values) {
    if (typeof entry !== 'string' || entry.trim() === '') continue;
    const text = entry.trim();
    const wrapped = /^!?\[\[(.*)\]\]$/s.exec(text);
    const target = wrapped ? parseWikilinkInner(wrapped[1] ?? '')?.target : text;
    if (target) out.push(target);
  }
  return out;
}

function courseOf(
  note: IndexedNote,
  catalog: LinkCatalog,
  courses: ReadonlySet<VaultPath>,
): VaultPath | null {
  for (const target of courseTargets(note.frontmatter?.course)) {
    const resolution = resolveLink(catalog, { kind: 'wikilink', target }, note.path);
    if (resolution.status === 'resolved' && courses.has(resolution.path)) return resolution.path;
  }
  return null;
}

/** Nearest deadline first, projects without one after; then by title. */
function compareProjects(a: ProjectRow, b: ProjectRow): number {
  return (
    (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || compareTitles(a.title, b.title)
  );
}

export function collectSemesterRows(
  index: SemesterIndex,
  today: string,
  exclude: (path: VaultPath) => boolean = () => false,
): SemesterRows {
  const notes = index.listNotes().filter((n) => n.class === 'user' && !exclude(n.path));
  const courseNotes = notes.filter((n) => typeOf(n) === 'course');
  const coursePaths = new Set(courseNotes.map((n) => n.path));
  const catalog = index.linkCatalog();

  const lectures = new Map<VaultPath, number>();
  for (const note of notes) {
    if (typeOf(note) !== 'lecture') continue;
    const course = courseOf(note, catalog, coursePaths);
    if (course !== null) lectures.set(course, (lectures.get(course) ?? 0) + 1);
  }
  const courses = courseNotes
    .map((n) => ({ path: n.path, title: n.title, lectures: lectures.get(n.path) ?? 0 }))
    .sort((a, b) => compareTitles(a.title, b.title) || (a.path < b.path ? -1 : 1));

  const projectNotes = notes.filter((n) => PROJECT_TYPES.has(typeOf(n)) && !isDoneStatus(n.status));
  const wanted = new Set(projectNotes.map((n) => n.path));
  const counts = new Map<VaultPath, { done: number; total: number }>();
  for (const task of index.allTasks()) {
    if (!wanted.has(task.path)) continue;
    const count = counts.get(task.path) ?? { done: 0, total: 0 };
    count.total += 1;
    if (task.done) count.done += 1;
    counts.set(task.path, count);
  }
  const projects = projectNotes
    .map((n) => ({
      path: n.path,
      title: n.title,
      course: courseOf(n, catalog, coursePaths),
      deadline: n.deadline,
      daysLeft: n.deadline ? diffDays(today, n.deadline) : null,
      progress: counts.get(n.path) ?? null,
    }))
    .sort(compareProjects);
  const watched = notes.filter((n) => PAGE_TYPES.has(typeOf(n))).map((n) => n.path);
  return { courses, projects, watched };
}
