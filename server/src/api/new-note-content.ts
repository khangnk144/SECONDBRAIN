import { toLocalDate } from '../lib/local-date.js';
import { classifyPath } from '../markdown/content-classes.js';
import { guardVaultPath } from '../security/path-guard.js';
import { VaultError, type VaultService } from '../vault/vault-types.js';

export interface TemplateVariables {
  title: string;
  /** Local calendar date `YYYY-MM-DD`. */
  date: string;
  /** Local time `HH:mm`. */
  time: string;
}

export function templateVariablesAt(title: string, now: Date): TemplateVariables {
  const pad = (n: number) => String(n).padStart(2, '0');
  return { title, date: toLocalDate(now), time: `${pad(now.getHours())}:${pad(now.getMinutes())}` };
}

/**
 * The basic template variables (F14): `{{title}}`, `{{date}}`, `{{time}}`; `{{cursor}}` only
 * marks the caret position and is removed. Other variables (Daily-note formats) stay as written
 * until full template support.
 */
export function fillTemplateVariables(template: string, vars: TemplateVariables): string {
  // Replacement functions, so `$&` or `$1` in a title is inserted literally.
  return template
    .replace(/\{\{title\}\}/g, () => vars.title)
    .replace(/\{\{date\}\}/g, () => vars.date)
    .replace(/\{\{time\}\}/g, () => vars.time)
    .replace(/\{\{cursor\}\}/g, '');
}

/** A blank note carries the properties every app-created note gets (SPEC §4.3). */
export function blankNoteContent(date: string): string {
  return `---\ntype: note\ncreated: ${date}\n---\n\n`;
}

/** Content of a note created by `POST /api/note`, from a template in `Templates/` or blank. */
export async function newNoteContent(
  vault: VaultService,
  template: string | undefined,
  vars: TemplateVariables,
): Promise<string> {
  if (template === undefined || template === '') return blankNoteContent(vars.date);
  const path = guardVaultPath(template);
  if (classifyPath(path) !== 'template') {
    throw new VaultError('VALIDATION', 'Templates must be Markdown files in Templates/.', { path });
  }
  const { content } = await vault.read(path);
  return fillTemplateVariables(content, vars);
}
