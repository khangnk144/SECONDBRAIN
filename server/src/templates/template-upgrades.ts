import { createHash } from 'node:crypto';
import { guardVaultPath } from '../security/path-guard.js';
import {
  isVaultError,
  VaultError,
  type VaultPath,
  type VaultService,
} from '../vault/vault-types.js';
import { BUNDLED_TEMPLATES } from './bundled-templates.js';
import { CLAUDE_MD_SKELETON } from './claude-md-skeleton.js';

/**
 * "Cập nhật mẫu" (owner request R2): `Templates/Paper.md` and `CLAUDE.md` are replaced by the
 * current bundled text only while they are byte-identical to a version the app itself shipped,
 * so a file the owner edited is never touched. The old bytes go to the trash first.
 */
export type TemplateUpgradeState = 'upgradable' | 'edited' | 'current' | 'missing';

export interface TemplateUpgradeItem {
  path: VaultPath;
  state: TemplateUpgradeState;
}

export interface TemplateUpgradeResult {
  upgraded: VaultPath[];
  skipped: { path: string; reason: Exclude<TemplateUpgradeState, 'upgradable'> | 'unknown' }[];
}

interface UpgradableFile {
  path: VaultPath;
  content: string;
  /**
   * SHA-256 (hex, of the UTF-8 bytes the app wrote) of every bundled version, oldest first; the
   * last one is the current text (a test checks it). Taken from `git log -p` of the source files.
   */
  versions: readonly string[];
}

const PAPER_CONTENT = BUNDLED_TEMPLATES.find((t) => t.name === 'Paper.md')?.content ?? '';

export const UPGRADABLE_FILES: readonly UpgradableFile[] = [
  {
    path: 'Templates/Paper.md',
    content: PAPER_CONTENT,
    versions: [
      // milestone 1 (f48558b): Tóm tắt, Phương pháp, Kết quả, Nhận xét
      '18c4fac0c4767a00cc74f1c9ca96739de879c7b1e8ebfe25744c7c488cd00dc9',
      // milestone 6: Bài toán, Các cách hiện có, Khoảng trống, Dữ liệu, Thí nghiệm, Hạn chế…
      'abbd2b87c8da6486140ac23355b322cfbbf9069690a133c64652376822bd8243',
    ],
  },
  {
    path: 'CLAUDE.md',
    content: CLAUDE_MD_SKELETON,
    versions: [
      // milestone 1 (f48558b)
      '84326c9b3a40a7cc7f20b40c74dc9286d0e695f617e26241b516dfe1aa6ff0f9',
      // milestone 6: richer paper-page format, tool list
      '623eb2d4143e1f8ac73841360f306a6d469b9f92422ae7ce03143783536d02c3',
      // milestone 6 review: `- Nguồn: [[<file>.pdf]]` under Liên quan (paper → PDF edge)
      '95afd637e89b416b71d90e618ee858179be4ec5e79eb49f9d3aaac2f843b9c09',
    ],
  },
];

export function sha256Hex(text: string | Uint8Array): string {
  return createHash('sha256').update(text).digest('hex');
}

const key = (path: string) => path.normalize('NFC').toLowerCase();

function stateOf(file: UpgradableFile, revision: string): TemplateUpgradeState {
  if (revision === sha256Hex(file.content)) return 'current';
  return file.versions.slice(0, -1).includes(revision) ? 'upgradable' : 'edited';
}

async function currentRevision(vault: VaultService, path: VaultPath): Promise<string | null> {
  try {
    return (await vault.read(path)).revision;
  } catch (error) {
    if (isVaultError(error) && error.code === 'NOT_FOUND') return null;
    throw error;
  }
}

/** `GET /api/templates/upgrades`: read-only. */
export async function templateUpgradeStates(vault: VaultService): Promise<TemplateUpgradeItem[]> {
  const items: TemplateUpgradeItem[] = [];
  for (const file of UPGRADABLE_FILES) {
    const revision = await currentRevision(vault, file.path);
    items.push({ path: file.path, state: revision === null ? 'missing' : stateOf(file, revision) });
  }
  return items;
}

/**
 * `POST /api/templates/upgrade`: each upgradable file is copied to the trash (reason
 * `template-upgrade`) and replaced at the revision just read, in one step of the vault's write
 * queue. A file that changed in between stops the call with CONFLICT (`details.upgraded` lists
 * the files already replaced). Edited, current, missing and unknown files are never written.
 */
export async function upgradeTemplates(
  vault: VaultService,
  paths: readonly string[],
): Promise<TemplateUpgradeResult> {
  const result: TemplateUpgradeResult = { upgraded: [], skipped: [] };
  const seen = new Set<string>();
  for (const input of paths) {
    const path = guardVaultPath(input);
    if (seen.has(key(path))) continue;
    seen.add(key(path));
    const file = UPGRADABLE_FILES.find((candidate) => key(candidate.path) === key(path));
    if (!file) {
      result.skipped.push({ path, reason: 'unknown' });
      continue;
    }
    const revision = await currentRevision(vault, file.path);
    const state = revision === null ? 'missing' : stateOf(file, revision);
    if (revision === null || state !== 'upgradable') {
      result.skipped.push({
        path: file.path,
        reason: state as Exclude<typeof state, 'upgradable'>,
      });
      continue;
    }
    try {
      await vault.writeKeepingConflictCopy(file.path, file.content, revision, 'template-upgrade');
    } catch (error) {
      if (isVaultError(error) && error.code === 'CONFLICT') {
        throw new VaultError('CONFLICT', error.message, {
          ...error.details,
          upgraded: [...result.upgraded],
        });
      }
      throw error;
    }
    result.upgraded.push(file.path);
  }
  return result;
}
