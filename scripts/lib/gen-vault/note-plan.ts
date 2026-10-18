// Decides which notes the generated vault contains: kind, folder, title, size and how many
// links and tasks each one gets (exact totals via largest-remainder allocation).
import { LINK_WEIGHT, SIZE_WEIGHT, TASK_WEIGHT, type NoteKind } from './note-kinds.js';
import { addDays, allocate, type Rng } from './prng.js';
import { AREAS, AUTHORS, CONCEPTS, COURSES, DUPLICATE_TITLES, IDEAS, WORDS } from './vocabulary.js';

export interface PlannedNote {
  kind: NoteKind;
  title: string;
  relPath: string; // vault-relative, POSIX, NFC, with .md
  course?: string;
  duplicateTitle: boolean;
  targetBytes: number;
  linkCount: number;
  taskCount: number;
  crlf: boolean;
  nfdName: boolean;
}

export interface PlanTotals {
  notes: number;
  bytes: number;
  links: number;
  tasks: number;
}

/** Default totals that match the performance vault of the spec (5k notes ≈ 50 MB). */
export function defaultTotals(notes: number): PlanTotals {
  return { notes, bytes: notes * 10_000, links: notes * 4, tasks: Math.round(notes * 0.6) };
}

export function planNotes(totals: PlanTotals, rng: Rng, today: string): PlannedNote[] {
  const taken = new Set<string>();
  const unique = (base: string): string => {
    let title = base;
    for (let k = 2; taken.has(title.toLowerCase()); k += 1) title = `${base} ${k}`;
    taken.add(title.toLowerCase());
    return title;
  };
  const courseCount = Math.min(Math.max(Math.round(totals.notes * 0.006), 3), totals.notes);
  const kinds: NoteKind[] = [
    'lecture',
    'project',
    'inbox',
    'resource',
    'archive',
    'wiki-paper',
    'wiki-concept',
    'wiki-gap',
    'daily',
    'area',
  ];
  const rest = Math.max(totals.notes - courseCount - 2, 0);
  const counts = allocate(rest, [0.18, 0.08, 0.05, 0.08, 0.08, 0.075, 0.055, 0.02, 0.2, 0.17]);
  const notes: Omit<PlannedNote, 'targetBytes' | 'linkCount' | 'taskCount' | 'crlf' | 'nfdName'>[] =
    [];
  const add = (kind: NoteKind, folder: string, title: string, extra: Partial<PlannedNote> = {}) =>
    notes.push({ kind, title, relPath: `${folder}/${title}.md`, duplicateTitle: false, ...extra });

  const courses: string[] = [];
  for (let i = 0; i < courseCount; i += 1) {
    const base = COURSES[i % COURSES.length] ?? 'Môn học';
    const title = unique(
      i < COURSES.length ? base : `${base} – nhóm ${Math.floor(i / COURSES.length) + 1}`,
    );
    courses.push(title);
    add('course', '2 Areas', title);
  }
  if (totals.notes >= courseCount + 2) {
    add('wiki-control', 'wiki', 'index');
    add('wiki-control', 'wiki', 'log');
    taken.add('index').add('log');
  }
  const duplicatePairs = Math.min(
    Math.max(Math.round(totals.notes / 1000), 2),
    DUPLICATE_TITLES.length,
  );
  const sessionByCourse = new Map<string, number>();
  kinds.forEach((kind, kindIdx) => {
    for (let i = 0; i < (counts[kindIdx] ?? 0); i += 1) {
      const course = courses[i % courses.length] ?? 'Môn học';
      switch (kind) {
        case 'lecture': {
          if (i < duplicatePairs * 2 && courses.length >= 2) {
            const title = DUPLICATE_TITLES[Math.floor(i / 2)] ?? 'Bài 1';
            const owner = courses[(Math.floor(i / 2) + (i % 2)) % courses.length] ?? course;
            taken.add(title.toLowerCase());
            add('lecture', `2 Areas/${owner}`, title, { course: owner, duplicateTitle: true });
            break;
          }
          const n = (sessionByCourse.get(course) ?? 0) + 1;
          sessionByCourse.set(course, n);
          add('lecture', `2 Areas/${course}`, unique(`Bài giảng ${course} – buổi ${n}`), {
            course,
          });
          break;
        }
        case 'project':
          add(
            'project',
            '1 Projects',
            unique(rng.chance(0.75) ? `Đồ án ${course}` : `Research – ${rng.pick(CONCEPTS)}`),
            { course },
          );
          break;
        case 'inbox':
          add('inbox', '0 Inbox', unique(`${rng.pick(IDEAS)} ${rng.pick(WORDS)}`));
          break;
        case 'area':
          add(
            'area',
            '2 Areas',
            unique(`${rng.pick(AREAS)} – ${rng.pick(WORDS)} ${rng.pick(WORDS)}`),
          );
          break;
        case 'resource':
          add('resource', '3 Resources/web', unique(`Bài viết – ${rng.pick(CONCEPTS)}`));
          break;
        case 'archive':
          add('archive', '4 Archive', unique(`Đồ án cũ ${course}`), { course });
          break;
        case 'wiki-paper':
          add(
            'wiki-paper',
            'wiki/papers',
            unique(`${rng.pick(AUTHORS)} ${rng.int(2015, 2026)} – ${rng.pick(CONCEPTS)}`),
          );
          break;
        case 'wiki-concept':
          add(
            'wiki-concept',
            'wiki/concepts',
            unique(CONCEPTS[i % CONCEPTS.length] ?? 'Khái niệm'),
          );
          break;
        case 'wiki-gap':
          add('wiki-gap', 'wiki/research-gaps', unique(`research-gap-${i + 1}`));
          break;
        case 'daily':
          add('daily', 'Daily', unique(addDays(today, -i)));
          break;
        default:
          break;
      }
    }
  });

  const noise = () => 0.35 + 1.3 * rng.next();
  const bytes = allocate(
    totals.bytes,
    notes.map((n) => SIZE_WEIGHT[n.kind] * noise()),
  );
  const links = allocate(
    totals.links,
    notes.map((n) => LINK_WEIGHT[n.kind] * (0.3 + 1.4 * rng.next())),
  );
  const tasks = allocate(
    totals.tasks,
    notes.map((n) => (TASK_WEIGHT[n.kind] ?? 0) * noise()),
  );
  return notes.map((n, i) => ({
    ...n,
    targetBytes: bytes[i] ?? 0,
    linkCount: links[i] ?? 0,
    taskCount: tasks[i] ?? 0,
    crlf: rng.chance(0.01),
    nfdName: n.title.normalize('NFD') !== n.title && rng.chance(0.006),
  }));
}
