/**
 * Folders of SPEC §3 and their fixed subfolders. The server refuses to rename, move or trash them
 * (403 FORBIDDEN); the UI disables those actions up front.
 */
import type { VaultPath } from './api/vault-types';
import { pathKey } from './vault-paths';

const STANDARD = [
  '0 Inbox',
  '1 Projects',
  '2 Areas',
  '3 Resources',
  '3 Resources/papers',
  '3 Resources/slides',
  '3 Resources/web',
  '3 Resources/other',
  '4 Archive',
  'wiki',
  'wiki/papers',
  'wiki/concepts',
  'wiki/research-gaps',
  'Daily',
  'Templates',
  'Attachments',
];

const STANDARD_KEYS = new Set(STANDARD.map(pathKey));

export function isStandardFolder(path: VaultPath): boolean {
  return path === '' || STANDARD_KEYS.has(pathKey(path));
}
