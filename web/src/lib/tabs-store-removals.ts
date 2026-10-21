/**
 * Removals the app itself started (trash): their WS deletion events need no "tab closed" toast,
 * the app already told the user (undo toast).
 */
import type { VaultPath } from './api/vault-types';
import { isInsideFolder, samePath } from './vault-paths';

let expectedRemovals: { matches: (path: VaultPath) => boolean; until: number }[] = [];
const EXPECTED_REMOVAL_MS = 30_000;

/** Announces that the app is about to delete these notes or everything below `folder`. */
export function expectTabRemoval(paths: VaultPath[], folder?: VaultPath): void {
  const now = Date.now();
  expectedRemovals = expectedRemovals.filter((entry) => entry.until > now);
  expectedRemovals.push({
    until: now + EXPECTED_REMOVAL_MS,
    matches: (path) =>
      paths.some((p) => samePath(p, path)) ||
      (folder !== undefined && isInsideFolder(path, folder)),
  });
}

export function wasExpectedRemoval(path: VaultPath): boolean {
  const now = Date.now();
  return expectedRemovals.some((entry) => entry.until > now && entry.matches(path));
}
