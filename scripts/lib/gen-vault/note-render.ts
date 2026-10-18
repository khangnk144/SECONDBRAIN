// Renders one planned note to Markdown (front matter, sections, links, tasks, tags, padding)
// and records what it generated in the shared stats object.
import type { PlannedNote } from './note-plan.js';
import { addDays, type Rng } from './prng.js';
import { TAGS, TASK_OBJECTS, TASK_VERBS, WORDS } from './vocabulary.js';

export interface RenderStats {
  links: {
    total: number;
    titleForm: number;
    pathForm: number;
    alias: number;
    heading: number;
    ghost: number;
    ambiguousTitle: number;
    inCodeBlocks: number;
  };
  tasks: { total: number; open: number; done: number; dated: number };
  frontmatterCourseLinks: number;
  projectsWithDeadline: number;
  tagsUsed: Set<string>;
}

export function emptyStats(): RenderStats {
  return {
    links: {
      total: 0,
      titleForm: 0,
      pathForm: 0,
      alias: 0,
      heading: 0,
      ghost: 0,
      ambiguousTitle: 0,
      inCodeBlocks: 0,
    },
    tasks: { total: 0, open: 0, done: 0, dated: 0 },
    frontmatterCourseLinks: 0,
    projectsWithDeadline: 0,
    tagsUsed: new Set(),
  };
}

export interface RenderContext {
  rng: Rng;
  today: string;
  targets: readonly PlannedNote[]; // hub-first order: early entries are linked more often
  duplicateTitles: ReadonlySet<string>;
  stats: RenderStats;
}

const TYPE_BY_KIND: Record<PlannedNote['kind'], string> = {
  course: 'course',
  lecture: 'lecture',
  project: 'project',
  inbox: 'note',
  area: 'note',
  resource: 'note',
  archive: 'project',
  'wiki-paper': 'paper',
  'wiki-concept': 'wiki',
  'wiki-gap': 'research',
  'wiki-control': 'wiki',
  daily: 'daily',
};

function sentence(rng: Rng): string {
  const words = Array.from({ length: rng.int(8, 20) }, () => rng.pick(WORDS));
  const text = words.join(' ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

function paragraph(ctx: RenderContext): string {
  const parts = Array.from({ length: ctx.rng.int(3, 6) }, () => sentence(ctx.rng));
  if (ctx.rng.chance(0.3)) {
    const tag = ctx.rng.pick(TAGS);
    ctx.stats.tagsUsed.add(tag);
    parts.push(`#${tag}`);
  }
  return parts.join(' ');
}

function linkMarkup(ctx: RenderContext, self: PlannedNote): string {
  const { rng, stats } = ctx;
  stats.links.total += 1;
  if (rng.chance(0.04)) {
    stats.links.ghost += 1;
    return `[[Ghi chú chưa tạo – ${rng.pick(WORDS)} ${rng.int(1, 999)}]]`;
  }
  let target = self;
  for (let tries = 0; target === self && tries < 5; tries += 1) {
    const idx = Math.floor(ctx.targets.length * rng.next() ** 2.5);
    target = ctx.targets[idx] ?? self;
  }
  const pathForm = target.relPath.replace(/\.md$/, '');
  const ambiguous = ctx.duplicateTitles.has(target.title);
  if ((ambiguous && rng.chance(0.8)) || rng.chance(0.1)) {
    stats.links.pathForm += 1;
    return `[[${pathForm}]]`;
  }
  if (ambiguous) stats.links.ambiguousTitle += 1;
  const roll = rng.next();
  if (roll < 0.09) {
    stats.links.alias += 1;
    return `[[${target.title}|${rng.pick(WORDS)} ${rng.pick(WORDS)}]]`;
  }
  if (roll < 0.17) {
    stats.links.heading += 1;
    return `[[${target.title}#Ghi chú]]`;
  }
  stats.links.titleForm += 1;
  return `[[${target.title}]]`;
}

function taskLine(ctx: RenderContext): string {
  const { rng, today, stats } = ctx;
  const text = `${rng.pick(TASK_VERBS)} ${rng.pick(TASK_OBJECTS)}`;
  stats.tasks.total += 1;
  if (rng.chance(0.35)) {
    stats.tasks.done += 1;
    const due = rng.chance(0.5) ? ` 📅 ${addDays(today, rng.int(-20, 5))}` : '';
    if (due) stats.tasks.dated += 1;
    return `- [x] ${text}${due} ✅ ${addDays(today, -rng.int(0, 30))}`;
  }
  stats.tasks.open += 1;
  if (rng.chance(0.6)) {
    stats.tasks.dated += 1;
    return `- [ ] ${text} 📅 ${addDays(today, rng.int(-10, 60))}`;
  }
  return `- [ ] ${text}`;
}

function frontMatter(note: PlannedNote, ctx: RenderContext): string {
  const { rng, today, stats } = ctx;
  const lines = ['---', `type: ${TYPE_BY_KIND[note.kind]}`];
  if (note.kind === 'project' || note.kind === 'archive') {
    lines.push(
      `status: ${note.kind === 'archive' ? 'done' : rng.pick(['todo', 'doing', 'doing', 'done'])}`,
    );
    if (note.kind === 'project' && rng.chance(0.85)) {
      stats.projectsWithDeadline += 1;
      lines.push(`deadline: ${addDays(today, rng.int(-5, 90))}`);
    }
  }
  if (note.course && note.kind !== 'course') {
    stats.frontmatterCourseLinks += 1;
    lines.push(`course: "[[${note.course}]]"`);
  }
  if (rng.chance(0.6)) {
    const tags = [rng.pick(TAGS), rng.pick(TAGS)].filter((t, i, a) => a.indexOf(t) === i);
    tags.forEach((t) => stats.tagsUsed.add(t));
    lines.push(`tags: [${tags.join(', ')}]`);
  }
  lines.push(
    `created: ${note.kind === 'daily' ? note.title : addDays(today, -rng.int(0, 400))}`,
    '---',
  );
  return lines.join('\n');
}

/** Markdown text (LF line endings) of one note. */
export function renderNote(note: PlannedNote, ctx: RenderContext): string {
  const { rng } = ctx;
  const blocks: string[] = [
    frontMatter(note, ctx),
    '',
    paragraph(ctx),
    '',
    '## Tóm tắt',
    '',
    paragraph(ctx),
  ];
  if (note.taskCount > 0) {
    blocks.push('', '## Việc cần làm', '');
    for (let i = 0; i < note.taskCount; i += 1) blocks.push(taskLine(ctx));
  }
  if (rng.chance(0.03)) {
    ctx.stats.links.inCodeBlocks += 1;
    blocks.push('', '```md', 'Cú pháp liên kết: [[Bài 1]] và #không-phải-thẻ', '```');
  }
  blocks.push('', '## Ghi chú');
  let size = Buffer.byteLength(blocks.join('\n'));
  let linksLeft = note.linkCount;
  while (size < note.targetBytes || linksLeft > 0) {
    let para = paragraph(ctx);
    const here = size >= note.targetBytes ? linksLeft : Math.min(linksLeft, rng.int(0, 2));
    for (let k = 0; k < here; k += 1) para += ` Xem thêm ${linkMarkup(ctx, note)}.`;
    linksLeft -= here;
    blocks.push('', para);
    size += Buffer.byteLength(para) + 2;
  }
  return `${blocks.join('\n')}\n`;
}
