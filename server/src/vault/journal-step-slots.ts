import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { JournalEntry, JournalStep } from './journal-types.js';
import { trashFileAbs } from './trash-store.js';
import { resolvePath, type VaultCore } from './vault-core.js';
import type { DiskLocation } from './vault-disk-names.js';
import { readFileState } from './vault-file-state.js';
import type { VaultPath } from './vault-types.js';

/**
 * One place a step's file can be: a vault path (resolved to its real on-disk names) or a file in
 * the step's trash entry. `key` identifies the place in the dry-run overlay.
 */
export interface Slot {
  key: string;
  abs: string;
  location: DiskLocation | null;
}

/** Simulated revisions (null = absent) of places earlier steps of a dry run would change. */
export type Overlay = Map<string, string | null>;

export function slotKeys(step: JournalStep): { fromKey: string; toKey: string } {
  const fromKey = step.kind === 'restore' ? `t:${step.path}` : `v:${step.path}`;
  if (step.kind === 'write') return { fromKey, toKey: fromKey };
  if (step.kind === 'trash') return { fromKey, toKey: `t:${step.path}` };
  return { fromKey, toKey: `v:${step.newPath}` };
}

async function vaultSlot(core: VaultCore, key: string, vaultPath: VaultPath): Promise<Slot> {
  const location = await resolvePath(core, vaultPath, 'real');
  return { key, abs: location.abs, location };
}

function trashSlot(core: VaultCore, entry: JournalEntry, key: string, vaultPath: VaultPath): Slot {
  if (!entry.trash) throw new Error(`Journal entry ${entry.id} has no trash entry`);
  return { key, abs: trashFileAbs(core, entry.trash.id, vaultPath), location: null };
}

export async function stepSlots(
  core: VaultCore,
  entry: JournalEntry,
  step: JournalStep,
): Promise<{ from: Slot; to: Slot }> {
  const { fromKey, toKey } = slotKeys(step);
  const from =
    step.kind === 'restore'
      ? trashSlot(core, entry, fromKey, step.path)
      : await vaultSlot(core, fromKey, step.path);
  if (step.kind === 'write') return { from, to: from };
  const to =
    step.kind === 'trash'
      ? trashSlot(core, entry, toKey, step.path)
      : await vaultSlot(core, toKey, step.newPath!);
  return { from, to };
}

export async function revisionAt(slot: Slot, overlay?: Overlay): Promise<string | null> {
  if (overlay?.has(slot.key)) return overlay.get(slot.key)!;
  return (await readFileState(slot.abs))?.revision ?? null;
}

/** True when anything (file or folder) already occupies the slot. */
export async function isOccupied(slot: Slot): Promise<boolean> {
  if (slot.location) return slot.location.kind !== null;
  try {
    await lstat(slot.abs);
    return true;
  } catch {
    return false;
  }
}

/** Case- and NFC-insensitive key: two names with the same key are one name on Windows. */
export const nameKey = (name: string) => name.normalize('NFC').toLowerCase();

export async function entryNames(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    // Folder gone: every name is absent, which the callers report as a conflict.
    return [];
  }
}

/** Folder holding both names of a same-file rename, and the entries currently in it. */
export async function sameFileRenameDir(
  core: VaultCore,
  step: JournalStep,
): Promise<{ dir: string; names: string[]; newName: string }> {
  const segments = step.path.split('/');
  const dir =
    segments.length === 1
      ? core.root
      : (await resolvePath(core, segments.slice(0, -1).join('/'), 'real')).abs;
  return { dir, names: await entryNames(dir), newName: step.newPath!.split('/').pop()! };
}

/**
 * Entries other than the interim one that carry the step's name in any case/NFC spelling. Outside
 * a crash window there is exactly one (the file itself); with the file parked under the interim
 * name there must be none, or someone created a file in its place.
 */
export function nameVariants(names: string[], step: JournalStep, newName: string): string[] {
  const key = nameKey(newName);
  return names.filter((name) => name !== step.viaTemp && nameKey(name) === key);
}

/** True when a same-file rename has its file parked under the interim name right now. */
export async function interimPresent(core: VaultCore, step: JournalStep): Promise<boolean> {
  if (!step.viaTemp) return false;
  return (await sameFileRenameDir(core, step)).names.includes(step.viaTemp);
}

export async function revisionOfEntry(dir: string, name: string): Promise<string | null> {
  return (await readFileState(path.join(dir, name)))?.revision ?? null;
}
