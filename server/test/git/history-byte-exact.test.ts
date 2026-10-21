import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HistoryService } from '../../src/git/history-types.js';
import { HAS_GIT, isolatedGitEnv, manualTimers } from './git-test-env.js';
import { openHistoryTestVault, type HistoryTestVault } from './history-test-vault.js';

const NOTE = '2 Areas/Giải tích 1.md';
const CRLF_TEXT = '# Giải tích 1\r\n\r\nDòng một.\r\nDòng hai.\r\n';

describe.skipIf(!HAS_GIT)('history keeps file bytes exactly (F20.3)', () => {
  let vault: HistoryTestVault;
  let git: ReturnType<typeof isolatedGitEnv>;

  afterEach(async () => {
    await vault?.close();
    git?.dispose();
  });

  it('a .gitattributes with text=auto in the vault does not change line endings in history', async () => {
    git = isolatedGitEnv();
    vault = await openHistoryTestVault({
      seed: (root) => {
        writeFileSync(path.join(root, '.gitattributes'), '* text=auto eol=lf\n');
        mkdirSync(path.join(root, '2 Areas'));
        writeFileSync(path.join(root, NOTE), CRLF_TEXT);
      },
    });
    const history: HistoryService = await vault.startHistory({
      env: git.env,
      timers: manualTimers(),
    });
    await history.idle();
    const [first] = await history.noteHistory(NOTE);
    expect(first).toBeDefined();
    expect((await history.noteVersion(NOTE, first!.commit))?.content).toBe(CRLF_TEXT);
  });
});
