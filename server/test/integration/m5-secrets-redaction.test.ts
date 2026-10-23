import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildBackupFile } from '../../src/backup/backup-export-file.js';
import { startServer } from '../../src/runtime/start-server.js';
import { makeFakeAppDir, makeTempDir, removeDir } from '../helpers/test-environment.js';

const PORT = 47763;
const TOKEN = 'ghp_GITHUBSECRET00000000000000000000aaaa';
const BOT = '7012345678:AAH-TELEGRAMSECRET1111111111111111bbbb';
const PASSWORD = 'smtp mật khẩu cccc';
const LATER = 'github_pat_LATERSECRET22222222222222222dddd';
const ALL = [TOKEN, BOT, PASSWORD, LATER];

describe('M5 secrets never reach the log or a backup (F27.5, F31.3)', () => {
  let home: string;
  beforeEach(() => {
    home = makeTempDir('sb bí mật M5');
    mkdirSync(path.join(home, '.secondbrain'), { recursive: true });
    writeFileSync(
      path.join(home, '.secondbrain', 'settings.json'),
      JSON.stringify({
        backup: {
          github: { enabled: true, remoteUrl: 'https://github.com/a/b.git', token: TOKEN },
        },
        notify: { telegram: { botToken: BOT }, email: { password: PASSWORD } },
      }),
    );
  });
  afterEach(() => removeDir(home));

  it('the logger redacts stored and newly saved secrets; the backup zip holds none', async () => {
    const { appDir } = makeFakeAppDir(home);
    const result = await startServer({
      argv: ['--home', home, '--port', String(PORT)],
      env: {},
      appDir,
    });
    if (result.kind !== 'started') throw new Error(`unexpected ${result.kind}`);
    try {
      const settingsFile = path.join(home, '.secondbrain', 'settings.json');
      const { sessionToken } = JSON.parse(readFileSync(settingsFile, 'utf8'));
      result.logger.info(`probe ${TOKEN} ${BOT} ${PASSWORD}`);
      // A secret saved while running is redacted from then on (the logger reads them live).
      const res = await result.app.inject({
        method: 'PUT',
        url: '/api/settings',
        headers: {
          host: `localhost:${PORT}`,
          origin: `http://localhost:${PORT}`,
          'x-sb-token': sessionToken,
        },
        payload: { backup: { github: { token: LATER } } },
      });
      expect(res.statusCode, res.body).toBe(200);

      result.logger.info(`later ${LATER}`);
      const log = readFileSync(path.join(home, 'vault', '.secondbrain', 'logs', 'app.log'), 'utf8');
      expect(log).toContain('probe [redacted] [redacted] [redacted]');
      expect(log).toContain('later [redacted]');
      for (const secret of ALL) expect(log.includes(secret)).toBe(false);

      const built = await buildBackupFile(result.context.vault);
      const entries = unzipSync(new Uint8Array(readFileSync(built.file)));
      expect(Object.keys(entries).length).toBeGreaterThan(0);
      for (const [name, bytes] of Object.entries(entries)) {
        const text = Buffer.from(bytes).toString('utf8');
        for (const secret of [...ALL, sessionToken])
          expect(text.includes(secret), `${name} holds a secret`).toBe(false);
        expect(name).not.toMatch(/settings\.json$/);
      }
    } finally {
      await result.stop();
    }
  });
});
