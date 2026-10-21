import {
  isVaultError,
  type VaultPath,
  type VaultService,
  type WriteResult,
} from '../vault/vault-types.js';

/** Re-reads after a conflict this many times (another writer appended at the same moment). */
const ATTEMPTS = 4;

/** Line ending a file already uses (CRLF when it has any), so appended text matches it. */
export function lineEndingOf(content: string): '\r\n' | '\n' {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

/** Text with every line break turned into `eol`. */
export function withLineEnding(text: string, eol: string): string {
  return text.replace(/\r\n?|\n/g, eol);
}

export interface AppendPlan {
  /** What to add after the current content (computed from it, inside the write queue). */
  addition(current: string): string;
  /** Content of the file when it does not exist yet. */
  initial(): Promise<string> | string;
}

/**
 * Adds text at the very end of a file without touching a byte before it: a text patch at the
 * revision the server itself just read (SPEC §4.9 "append"), retried when another writer got
 * there first. A missing file is created (never overwriting one created meanwhile).
 */
export async function appendToFile(
  vault: VaultService,
  path: VaultPath,
  plan: AppendPlan,
): Promise<WriteResult> {
  for (let attempt = 1; ; attempt += 1) {
    const retry = attempt < ATTEMPTS;
    let revision: string;
    try {
      revision = (await vault.read(path)).revision;
    } catch (error) {
      if (!(isVaultError(error) && error.code === 'NOT_FOUND')) throw error;
      try {
        return await vault.create(path, await plan.initial());
      } catch (createError) {
        if (retry && isVaultError(createError) && createError.code === 'EXISTS') continue;
        throw createError;
      }
    }
    try {
      return await vault.patchWith(path, revision, (content) => [
        { start: content.length, end: content.length, text: plan.addition(content) },
      ]);
    } catch (error) {
      if (retry && isVaultError(error) && error.code === 'CONFLICT') continue;
      throw error;
    }
  }
}
