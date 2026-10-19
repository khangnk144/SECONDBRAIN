import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { VaultFaults } from '../../../src/vault/vault-faults.js';
import type { RelinkPlanner, VaultService } from '../../../src/vault/vault-types.js';
import { listTree, openTempVault, sha256, type TempVault } from './vault-test-kit.js';

/** A user folder with a note, a linked note, an image and an empty subfolder; one note outside. */
export const FOLDER = '1 Projects/Đồ án cũ';
export const MOVED = '4 Archive/Đồ án 2025';
export const INSIDE = `${FOLDER}/Ghi chú dự án.md`;
export const DOC = `${FOLDER}/Tài liệu.md`;
export const IMAGE = `${FOLDER}/hình/ảnh 1.png`;
export const OUTSIDE = '2 Areas/Môn học.md';
export const BEFORE: Record<string, string> = {
  [INSIDE]: `Xem [[${FOLDER}/Tài liệu]] và [[Tài liệu]].\n`,
  [DOC]: '# Tài liệu\n',
  [IMAGE]: 'PNG',
  [OUTSIDE]: `Dự án: [[${FOLDER}/Ghi chú dự án]] ![[${FOLDER}/hình/ảnh 1.png]]\n`,
};
/** After the rename: the two path-form links follow the folder (planned by the stub below). */
export const AFTER: Record<string, string> = {
  [`${MOVED}/Ghi chú dự án.md`]: `Xem [[${MOVED}/Tài liệu]] và [[Tài liệu]].\n`,
  [`${MOVED}/Tài liệu.md`]: BEFORE[DOC]!,
  [`${MOVED}/hình/ảnh 1.png`]: BEFORE[IMAGE]!,
  [OUTSIDE]: `Dự án: [[${MOVED}/Ghi chú dự án]] ![[${MOVED}/hình/ảnh 1.png]]\n`,
};

export const stepCrash = (k: number): VaultFaults => ({
  crashAfterJournalStep: (_id, n) => n === k,
});

export interface FolderFixture {
  readonly t: TempVault;
  planned: unknown[];
  /** Every vault file and folder outside `.secondbrain`, with file contents. */
  snapshot(): Record<string, string>;
  open(faults?: VaultFaults): Promise<VaultService>;
  setup(): Promise<void>;
}

export function expectedState(
  files: Record<string, string>,
  folders: string[],
): Record<string, string> {
  const state: Record<string, string> = {};
  for (const folder of folders) state[`${folder}/`] = 'dir';
  for (const [file, content] of Object.entries(files)) state[file] = content;
  return state;
}

export function createFolderFixture(): FolderFixture {
  let t: TempVault;
  const planned: unknown[] = [];
  const planner: RelinkPlanner = {
    plan: async () => [],
    planMoves: async (moves) => {
      planned.push(moves.map((move) => [move.from, move.to]));
      return {
        edits: [OUTSIDE, INSIDE].map((p) => ({
          path: p,
          expectedRevision: sha256(BEFORE[p]!),
          newContent: AFTER[p === INSIDE ? `${MOVED}/Ghi chú dự án.md` : p]!,
        })),
        skipped: [],
      };
    },
  };
  const snapshot = () => {
    const state: Record<string, string> = {};
    for (const entry of listTree(t.root)) {
      if (entry.startsWith('.secondbrain') || !/^(1 Projects|2 Areas|4 Archive)\//.test(entry)) {
        continue;
      }
      if (entry.endsWith('/')) {
        // Standard folders are always there; only their content matters.
        if (!['1 Projects/', '2 Areas/', '4 Archive/'].includes(entry)) state[entry] = 'dir';
        continue;
      }
      state[entry] = readFileSync(path.join(t.root, ...entry.split('/')), 'utf8');
    }
    return state;
  };
  return {
    get t() {
      return t;
    },
    planned,
    snapshot,
    open: async (faults) => {
      const vault = await t.reopen(faults);
      vault.setRelinkPlanner(planner);
      return vault;
    },
    setup: async () => {
      t = await openTempVault();
      planned.length = 0;
      for (const [p, content] of Object.entries(BEFORE)) await t.vault.create(p, content);
      mkdirSync(path.join(t.root, ...FOLDER.split('/'), 'rỗng'));
      t.vault.setRelinkPlanner(planner);
      t.changes.length = 0;
    },
  };
}

export const BEFORE_STATE = () =>
  expectedState(BEFORE, [FOLDER, `${FOLDER}/hình`, `${FOLDER}/rỗng`]);
export const AFTER_STATE = () => expectedState(AFTER, [MOVED, `${MOVED}/hình`, `${MOVED}/rỗng`]);

/** Trash entries on disk (ids), for "one entry" and "entry removed" checks. */
export function trashIds(root: string): string[] {
  const dir = path.join(root, '.secondbrain', 'trash');
  return existsSync(dir) ? readdirSync(dir) : [];
}
