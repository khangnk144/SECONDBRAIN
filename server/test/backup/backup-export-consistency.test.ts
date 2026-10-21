import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { removeDir, TEST_TOKEN } from '../helpers/test-environment.js';
import { createVaultTestApp, q, waitUntil, type VaultTestApp } from '../api/vault-test-app.js';

const PORT = 47604;
const NOTE = 'wiki/Ôn thi cuối kỳ.md';
const RENAMED = 'wiki/Ôn thi cuối kỳ – bản chính.md';
const BIG = '3 Resources/papers/bài giảng dài.pdf';
const LOCKED = '2 Areas/Báo cáo đang mở.docx';

/** Test control over the export's file opens: a file "held open by Word", or a paused read. */
const opens = vi.hoisted(() => ({
  locked: null as string | null,
  pause: null as { name: string; reached: () => void; release: Promise<void> } | null,
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...real,
    open: (async (...args: Parameters<typeof real.open>) => {
      const name = String(args[0]).split(path.sep).join('/');
      if (opens.locked && name.endsWith(opens.locked)) {
        throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' });
      }
      const pause = opens.pause;
      if (pause && name.endsWith(pause.name)) {
        opens.pause = null;
        pause.reached();
        await pause.release;
      }
      return real.open(...args);
    }) as typeof real.open,
  };
});

let t: VaultTestApp | undefined;
afterEach(async () => {
  opens.locked = null;
  opens.pause = null;
  await t?.close();
  t = undefined;
});

async function vaultApp(bigBytes: number, listen = false) {
  t = await createVaultTestApp(PORT, {
    listen,
    seed: (root) => {
      const write = (relative: string, data: string | Buffer) => {
        mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
        writeFileSync(path.join(root, relative), data);
      };
      // Early in the listing order, so the export is busy with it when the note comes later.
      write(BIG, Buffer.alloc(bigBytes, 1));
      write(LOCKED, 'PK docx');
      write(NOTE, '# Ôn thi\n\nnội dung quan trọng\n');
    },
  });
  return t;
}

const exportDir = (app: VaultTestApp) =>
  path.join(app.context.vault.paths.cacheDir, 'backup-export');
const wikiNames = (zip: Buffer) =>
  Object.keys(unzipSync(new Uint8Array(zip)))
    .map((n) => n.normalize('NFC'))
    .filter((n) => n.startsWith('wiki/') && n.endsWith('.md'));

describe('a backup export has no silent gaps (F18.5)', () => {
  it('a rename while the zip is built waits for it; reads go on meanwhile', async () => {
    const app = await vaultApp(300_000);
    const revision = (await app.call('GET', `/api/note?${q(NOTE)}`)).json().revision as string;
    let reached!: () => void;
    let release!: () => void;
    const inside = new Promise<void>((resolve) => (reached = resolve));
    opens.pause = { name: BIG, reached, release: new Promise<void>((r) => (release = r)) };

    const exported = app.call('POST', '/api/backup/export');
    await inside; // the export is reading the big file, the note is still to come
    const order: string[] = [];
    const renamed = app
      .call('POST', '/api/note/rename', {
        path: NOTE,
        newPath: RENAMED,
        expectedRevision: revision,
      })
      .then((res) => {
        order.push('rename');
        return res;
      });
    const read = await app.call('GET', `/api/note?${q(NOTE)}`);
    order.push('read');
    expect(read.statusCode).toBe(200);
    // Time enough for a rename that does not wait (it takes a few milliseconds).
    await Promise.race([renamed, new Promise((resolve) => setTimeout(resolve, 300))]);
    expect(order).toEqual(['read']); // the read did not wait; the rename does
    release();
    const res = await exported;
    expect(res.statusCode, res.body).toBe(200);
    expect((await renamed).statusCode).toBe(200);
    expect(wikiNames(res.rawPayload)).toEqual([NOTE]);
    expect(res.headers['x-sb-backup-unreadable']).toBe('0');
    expect(existsSync(path.join(app.vaultRoot, RENAMED))).toBe(true);
  });

  it('a rename during the download changes nothing in the file being sent', async () => {
    const app = await vaultApp(32 * 1024 * 1024, true);
    const revision = (await app.call('GET', `/api/note?${q(NOTE)}`)).json().revision as string;
    const chunks: Buffer[] = [];
    let headers: http.IncomingHttpHeaders = {};
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: PORT,
          method: 'POST',
          path: '/api/backup/export',
          headers: {
            host: `localhost:${PORT}`,
            origin: `http://localhost:${PORT}`,
            'x-sb-token': TEST_TOKEN,
          },
        },
        (res) => {
          headers = res.headers;
          let renamed = false;
          res.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
            if (renamed) return;
            renamed = true;
            res.pause();
            void app
              .call('POST', '/api/note/rename', {
                path: NOTE,
                newPath: RENAMED,
                expectedRevision: revision,
              })
              .then((r) => {
                expect(r.statusCode).toBe(200);
                res.resume();
              }, reject);
          });
          res.on('end', resolve);
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(headers['x-sb-backup-unreadable']).toBe('0');
    expect(Number(headers['content-length'])).toBe(Buffer.concat(chunks).length);
    expect(wikiNames(Buffer.concat(chunks))).toEqual([NOTE]);
    // The finished zip was ours, in the cache; it is gone once sent.
    await waitUntil(() => (readdirSync(exportDir(app)).length === 0 ? true : undefined), 3000);
  });

  it('a file that cannot be opened is counted in x-sb-backup-unreadable', async () => {
    const app = await vaultApp(1000);
    opens.locked = LOCKED;
    const res = await app.call('POST', '/api/backup/export');
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-sb-backup-unreadable']).toBe('1');
    const names = Object.keys(unzipSync(new Uint8Array(res.rawPayload))).map((n) =>
      n.normalize('NFC'),
    );
    expect(names).not.toContain(LOCKED);
    expect(names).toContain(NOTE);
    expect(names).toContain(BIG);
  });

  it('leftovers of an export that never finished are removed; the temp zip is never in a backup', async () => {
    const app = await vaultApp(1000);
    mkdirSync(exportDir(app), { recursive: true });
    writeFileSync(path.join(exportDir(app), 'bỏ dở.zip'), 'half');
    const res = await app.call('POST', '/api/backup/export');
    expect(res.statusCode).toBe(200);
    const names = Object.keys(unzipSync(new Uint8Array(res.rawPayload)));
    expect(names.some((n) => n.includes('cache') || n.endsWith('.zip'))).toBe(false);
    await waitUntil(() => (readdirSync(exportDir(app)).length === 0 ? true : undefined), 3000);
    removeDir(exportDir(app));
  });
});
