import type { VaultWarning } from './vault-core.js';

/**
 * Collects failures of best-effort housekeeping (temp cleanup, pruning, purging) so one locked
 * file never stops the vault from opening; reports them once, with counts and error codes only.
 */
export interface FailureTally {
  add(error: unknown, detail?: string): void;
  report(warn: VaultWarning, what: string): void;
  readonly count: number;
}

export function errorCodeOf(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' ? code : 'ERROR';
}

export function createFailureTally(): FailureTally {
  const codes = new Set<string>();
  const details: string[] = [];
  let count = 0;
  return {
    add(error, detail) {
      count += 1;
      codes.add(errorCodeOf(error));
      if (detail) details.push(detail);
    },
    report(warn, what) {
      if (count === 0) return;
      warn(`Could not ${what}: ${count} item(s) skipped (${[...codes].join(', ')}).`, {
        count,
        codes: [...codes],
        items: details,
      });
    },
    get count() {
      return count;
    },
  };
}
