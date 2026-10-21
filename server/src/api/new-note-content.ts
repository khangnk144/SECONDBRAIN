import { classifyPath } from '../markdown/content-classes.js';
import { guardVaultPath } from '../security/path-guard.js';
import {
  fillTemplate,
  type FilledTemplate,
  type TemplateContext,
} from '../templates/template-variables.js';
import { isVaultError, VaultError, type VaultService } from '../vault/vault-types.js';

/** A blank note carries the properties every app-created note gets (SPEC §4.3). */
export function blankNoteContent(date: string): string {
  return `---\ntype: note\ncreated: ${date}\n---\n\n`;
}

/** Content of a note created by `POST /api/note`, from a template in `Templates/` or blank. */
export async function newNoteContent(
  vault: VaultService,
  template: string | undefined,
  context: TemplateContext,
): Promise<FilledTemplate> {
  if (template === undefined || template === '') {
    return { content: blankNoteContent(context.date), cursor: null };
  }
  const path = guardVaultPath(template);
  if (classifyPath(path) !== 'template') {
    throw new VaultError('VALIDATION', 'Templates must be Markdown files in Templates/.', { path });
  }
  const read = await vault.read(path);
  // A lossy decode would put U+FFFD into the new note: refuse and create nothing.
  if (!read.utf8) {
    throw new VaultError('VALIDATION', 'The template is not UTF-8 text.', {
      path,
      reason: 'template-not-utf8',
    });
  }
  return fillTemplate(read.content, context);
}

export const DAILY_TEMPLATE = 'Templates/Daily.md';

/**
 * Daily note `date` (SPEC F13): `Templates/Daily.md` with the variables of that day (`{{title}}`
 * is the date); a minimal `type: daily` note when the template cannot be used for any reason
 * (missing, not UTF-8, a symlink or anything else the path guard or the disk refuses), so
 * Alt+T always creates today's note. Unusable templates other than a missing one are reported
 * through `onUnusable` with the error code only.
 */
export async function dailyNoteContent(
  vault: VaultService,
  context: Omit<TemplateContext, 'title'>,
  onUnusable: (code: string) => void = () => undefined,
): Promise<FilledTemplate> {
  try {
    const template = await vault.read(DAILY_TEMPLATE);
    if (template.utf8) return fillTemplate(template.content, { ...context, title: context.date });
    onUnusable('not-utf8');
  } catch (error) {
    if (!(isVaultError(error) && error.code === 'NOT_FOUND')) onUnusable(errorCode(error));
  }
  return { content: `---\ntype: daily\ncreated: ${context.date}\n---\n\n`, cursor: null };
}

function errorCode(error: unknown): string {
  if (isVaultError(error)) {
    const reason = error.details?.reason;
    return typeof reason === 'string' ? `${error.code} ${reason}` : error.code;
  }
  return (error as NodeJS.ErrnoException | null)?.code ?? 'unknown';
}
