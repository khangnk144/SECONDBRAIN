import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { VaultFaults } from '../../../src/vault/vault-faults.js';
import type {
  MultiFileResult,
  RelinkPlanner,
  VaultService,
} from '../../../src/vault/vault-types.js';
import { openTempVault, sha256, type TempVault } from './vault-test-kit.js';

/** A note renamed with relink: two notes link to it and it links to itself. */
export const OWN = '1 Projects/Đồ án.md';
export const NEW = '1 Projects/Đồ án Giải tích.md';
export const COURSE = '2 Areas/Giải tích 1.md';
export const DAILY = 'Daily/2026-10-18.md';
export const BEFORE: Record<string, string> = {
  [OWN]: '# Đồ án\n\nXem [[Đồ án]] và [[Giải tích 1]].\n',
  [COURSE]: 'Đồ án môn: [[Đồ án]]\n',
  [DAILY]: '- [ ] nộp [[Đồ án|bài]] 📅 2026-10-20\n',
};
export const AFTER: Record<string, string> = {
  [NEW]: '# Đồ án\n\nXem [[Đồ án Giải tích]] và [[Giải tích 1]].\n',
  [COURSE]: 'Đồ án môn: [[Đồ án Giải tích]]\n',
  [DAILY]: '- [ ] nộp [[Đồ án Giải tích|bài]] 📅 2026-10-20\n',
};
export const BEFORE_STATE = { ...BEFORE, [NEW]: null };
export const AFTER_STATE = { ...AFTER, [OWN]: null };

export const stepCrash = (k: number): VaultFaults => ({
  crashAfterJournalStep: (_id, n) => n === k,
});

export interface RelinkFixture {
  readonly t: TempVault;
  /** What the stub planner was asked, and whether the source was still untouched then. */
  planned: unknown[];
  disk(vaultPath: string): string | null;
  snapshot(): Record<string, string | null>;
  /** True when the file is whole: its before or after content (or absent). */
  isBeforeOrAfter(vaultPath: string): boolean;
  /** Reopens the vault (optionally with faults) with the stub planner attached. */
  open(faults?: VaultFaults): Promise<VaultService>;
  rename(vault: VaultService): Promise<MultiFileResult>;
  setup(): Promise<void>;
}

export function createRelinkFixture(): RelinkFixture {
  let t: TempVault;
  const planned: unknown[] = [];
  const disk = (p: string) => {
    const file = path.join(t.root, ...p.split('/'));
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  };
  // Rewrites both linking notes and the note's own self-link (listed in the middle on purpose).
  const planner: RelinkPlanner = {
    plan: async (op) => {
      planned.push({ op, sourceStillThere: disk(op.from) === BEFORE[OWN] });
      return [COURSE, OWN, DAILY].map((p) => ({
        path: p,
        expectedRevision: sha256(BEFORE[p]!),
        newContent: AFTER[p === OWN ? NEW : p]!,
      }));
    },
  };
  return {
    get t() {
      return t;
    },
    planned,
    disk,
    snapshot: () => Object.fromEntries([OWN, NEW, COURSE, DAILY].map((p) => [p, disk(p)])),
    // The note's own edit is applied at its old path before the rename step.
    isBeforeOrAfter: (p) =>
      [BEFORE[p], AFTER[p], p === OWN ? AFTER[NEW] : undefined, null].includes(disk(p)),
    open: async (faults) => {
      const vault = await t.reopen(faults);
      vault.setRelinkPlanner(planner);
      return vault;
    },
    rename: (vault) =>
      vault.rename(OWN, NEW, { expectedRevision: sha256(BEFORE[OWN]!), relink: true }),
    setup: async () => {
      t = await openTempVault();
      planned.length = 0;
      for (const [p, content] of Object.entries(BEFORE)) await t.vault.create(p, content);
      t.vault.setRelinkPlanner(planner);
      t.changes.length = 0;
    },
  };
}
