/**
 * The Markdown of the "Học kỳ này" page (SPEC F25.1). Deterministic: the same rows, day and
 * language give the same bytes, so the plugin can skip a write that would change nothing.
 * Links use the title form when the title is unique in the vault, else the path form (SPEC §4.4);
 * a name that cannot sit inside `[[…]]` (`[`, `]`, `|`, `#`, `^`) becomes a Markdown link with a
 * percent-encoded path. The page holds no tasks, no `deadline:` and no date tokens, so it never
 * adds deadline items or reminders. Lines end with LF.
 */
import { catalogIndex } from '../markdown/link-catalog.js';
import type { LinkCatalog } from '../markdown/markdown-types.js';
import { linkIdentityKey } from '../markdown/normalize-text.js';
import type { VaultPath } from '../vault/vault-types.js';
import { pageText, type PageLanguage, type PageText } from './semester-page-messages.js';
import type { ProjectRow, SemesterRows } from './semester-page-rows.js';

export interface PageInput {
  rows: SemesterRows;
  catalog: LinkCatalog;
  language: PageLanguage;
  /** `created:` of the page (the day it was first made; kept across regenerations). */
  created: string;
}

const NOT_IN_WIKILINK = /[[\]|#^\r\n]/;
const MARKDOWN_SPECIAL = /[\\[\]*_`<>]/g;

/** `[[Title]]`, `[[folder/Title]]` or `[Title](folder/Title.md)` for a note. */
export function noteLink(catalog: LinkCatalog, path: VaultPath, title: string): string {
  const sameTitle = catalogIndex(catalog).byTitle.get(linkIdentityKey(title));
  const unique = sameTitle?.length === 1 && sameTitle[0] === path;
  const target = unique ? title : path.slice(0, -3);
  if (!NOT_IN_WIKILINK.test(target)) return `[[${target}]]`;
  const href = path.split('/').map(encodeURIComponent).join('/');
  return `[${title.replace(MARKDOWN_SPECIAL, '\\$&')}](${href})`;
}

function projectLine(text: PageText, catalog: LinkCatalog, project: ProjectRow): string {
  const parts: string[] = [];
  if (project.deadline !== null && project.daysLeft !== null) {
    parts.push(text.due(project.deadline), text.daysLeft(project.daysLeft));
  } else {
    parts.push(text.noDeadline);
  }
  parts.push(
    project.progress ? text.progress(project.progress.done, project.progress.total) : text.noTasks,
  );
  return `- ${noteLink(catalog, project.path, project.title)}: ${parts.join(', ')}`;
}

function projectSections(text: PageText, input: PageInput): string[] {
  const { rows, catalog } = input;
  if (rows.projects.length === 0) return [text.noProjects, ''];
  const out: string[] = [];
  const groups: { heading: string; projects: ProjectRow[] }[] = rows.courses.map((course) => ({
    heading: noteLink(catalog, course.path, course.title),
    projects: rows.projects.filter((p) => p.course === course.path),
  }));
  groups.push({ heading: text.other, projects: rows.projects.filter((p) => p.course === null) });
  for (const group of groups) {
    if (group.projects.length === 0) continue;
    out.push(`### ${group.heading}`, '');
    for (const project of group.projects) out.push(projectLine(text, catalog, project));
    out.push('');
  }
  return out;
}

export function renderSemesterPage(input: PageInput): string {
  const text = pageText(input.language);
  const { rows, catalog } = input;
  const lines = [
    '---',
    'type: note',
    'generated: true',
    `created: ${input.created}`,
    '---',
    `> ${text.intro}`,
    '',
    `## ${text.courses}`,
    '',
  ];
  if (rows.courses.length === 0) lines.push(text.noCourses);
  for (const course of rows.courses) {
    lines.push(
      `- ${noteLink(catalog, course.path, course.title)}: ${text.lectures(course.lectures)}`,
    );
  }
  lines.push('', `## ${text.projects}`, '', ...projectSections(text, input));
  // Exactly one final newline.
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return `${lines.join('\n')}\n`;
}
