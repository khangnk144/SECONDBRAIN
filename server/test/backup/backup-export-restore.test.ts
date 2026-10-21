import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backupFileName } from '../../src/backup/backup-file-name.js';
import { centralEntries, multipartBody, readTree } from '../helpers/backup-test-helpers.js';
import { makeTempDir, removeDir } from '../helpers/test-environment.js';
import { createVaultTestApp, q, type VaultTestApp } from '../api/vault-test-app.js';

const PORT = 47613;
const KEY = 'sk-ant-api03-SECRETSECRETSECRETSECRET-9876';
const NFD_NOTE = '0 Inbox/ghi chú macOS.md'.normalize('NFD');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(300_000, 7)]);

/** What a backup leaves out, as vault-relative names. */
const notInBackup = (relative: string) =>
  /^\.secondbrain\/(cache|logs)(\/|$)/.test(relative) ||
  /^\.git(\/|$)/.test(relative) ||
  /(^|\/)\.sb-[0-9a-f]{12}\.tmp$/.test(relative);

describe('backup export → restore round trip (F18.5)', () => {
  let t: VaultTestApp;
  let outside: string;
  let zip: Buffer;
  let original: Map<string, Buffer>;
  let backlinks: unknown;

  beforeAll(async () => {
    outside = makeTempDir('sb ngoài vault Khôi phục');
    t = await createVaultTestApp(PORT, {
      seed: (root) => {
        const write = (relative: string, data: string | Buffer) => {
          mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
          writeFileSync(path.join(root, relative), data);
        };
        write('2 Areas/Giải tích 1.md', '---\ntype: course\n---\n# Giải tích 1\n');
        write(
          '1 Projects/Đồ án Giải tích.md',
          '---\ntype: project\ndeadline: 2030-01-20\n---\nXem [[Giải tích 1]] và ![[hình.png]].\n\n- [ ] Nộp bài 📅 2030-01-15\n',
        );
        write('Attachments/2026-10/hình.png', PNG);
        write('3 Resources/papers/bài giảng 3.pdf', PDF);
        write(NFD_NOTE, '# NFD\n');
        write('0 Inbox/trống.md', '');
        write('0 Inbox/Bỏ đi.md', '# Bỏ\n');
        write('.secondbrain/state/reminders.json', '{"version":1,"entries":[]}\n');
        write('.git/config', '[core]\n');
        mkdirSync(path.join(root, '4 Archive', 'Thư mục trống'), { recursive: true });
      },
    });
    const root = t.vaultRoot;
    // Things that exist only at run time: a trash entry (and its journal), cache, logs, temp
    // files, a link to outside the vault, and secrets in the global settings.
    const trashed = (await t.call('GET', `/api/note?${q('0 Inbox/Bỏ đi.md')}`)).json();
    await t.call('POST', '/api/note/trash', {
      paths: ['0 Inbox/Bỏ đi.md'],
      expectedRevisions: [trashed.revision],
    });
    writeFileSync(path.join(root, '.secondbrain', 'logs', 'app.log'), 'log line\n');
    writeFileSync(path.join(root, '0 Inbox', '.sb-0123456789ab.tmp'), 'half written');
    writeFileSync(path.join(outside, 'bí mật.md'), 'outside');
    symlinkSync(path.join(outside, 'bí mật.md'), path.join(root, '0 Inbox', 'liên kết.md'));
    t.settings.ai.apiKeys.anthropic = KEY;
    await t.context.settled();
    backlinks = (await t.call('GET', `/api/note?${q('2 Areas/Giải tích 1.md')}`)).json().backlinks;
    original = readTree(root, notInBackup);

    const res = await t.call('POST', '/api/backup/export');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="second-brain-sao-luu-\d{4}-\d{2}-\d{2}-\d{4}\.zip"; filename\*=UTF-8''second-brain-sao-luu-/,
    );
    zip = res.rawPayload;
  });
  afterAll(async () => {
    await t?.close();
    removeDir(outside);
  });

  it('names the file in local time', () => {
    expect(backupFileName(new Date(2026, 9, 21, 7, 5))).toBe(
      'second-brain-sao-luu-2026-10-21-0705.zip',
    );
  });

  it('holds every vault file byte for byte, state and trash included, and nothing else', () => {
    const files = unzipSync(new Uint8Array(zip));
    const names = Object.keys(files).filter((name) => !name.endsWith('/'));
    expect(names.sort()).toEqual([...original.keys()].sort());
    for (const [name, bytes] of original)
      expect(Buffer.from(files[name]!).equals(bytes), name).toBe(true);
    expect(names).toContain('.secondbrain/vault.json');
    expect(names).toContain('.secondbrain/state/reminders.json');
    expect(names.some((n) => /^\.secondbrain\/trash\/[0-9A-Z]{26}\/meta\.json$/.test(n))).toBe(
      true,
    );
    expect(names.some((n) => n.startsWith('.secondbrain/state/journal/'))).toBe(true);
    expect(Object.keys(files)).toContain('4 Archive/Thư mục trống/');
    expect(names.some((n) => /(^|\/)(cache|logs)\/|^\.git\/|\.tmp$|liên kết/.test(n))).toBe(false);
  });

  it('contains no session token and no API key anywhere', () => {
    const everything = Buffer.concat(
      Object.values(unzipSync(new Uint8Array(zip))).map((b) => Buffer.from(b)),
    );
    expect(everything.includes(t.settings.sessionToken)).toBe(false);
    expect(everything.includes(KEY)).toBe(false);
    expect(zip.includes(KEY)).toBe(false);
  });

  it('writes names as UTF-8 with the language-encoding flag; NFC and NFD stay as on disk', () => {
    const entries = centralEntries(zip);
    for (const entry of entries) {
      const ascii = entry.name.every((byte) => byte < 0x80);
      expect(Boolean(entry.flags & 0x0800), entry.name.toString()).toBe(!ascii);
    }
    const names = entries.map((e) => e.name.toString('utf8'));
    expect(names).toContain(NFD_NOTE);
    expect(names).toContain('1 Projects/Đồ án Giải tích.md'.normalize('NFC'));
    const byName = new Map(entries.map((e) => [e.name.toString('utf8'), e.method]));
    expect(byName.get('3 Resources/papers/bài giảng 3.pdf')).toBe(0); // already compressed: stored
    expect(byName.get('2 Areas/Giải tích 1.md')).toBe(8);
  });

  it('restores into a new folder without opening it: same files, a vault id of its own', async () => {
    const target = path.join(outside, 'Bản khôi phục', 'vault mới');
    mkdirSync(path.dirname(target));
    const form = multipartBody(
      [
        ['target', target],
        ['open', 'false'],
      ],
      { data: zip },
    );
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/backup/restore',
      headers: {
        host: `localhost:${PORT}`,
        'x-sb-token': t.settings.sessionToken,
        origin: `http://localhost:${PORT}`,
        'content-type': form.contentType,
      },
      payload: form.payload,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toEqual({ path: target, vaultId: expect.any(String) });
    expect(res.json().vaultId).not.toBe(t.context.vault.id);
    const restored = readTree(target);
    expect([...restored.keys()].sort()).toEqual([...original.keys()].sort());
    for (const [name, bytes] of original) {
      if (name === '.secondbrain/vault.json') continue; // only its id differs
      expect(restored.get(name)?.equals(bytes), name).toBe(true);
    }
    expect(JSON.parse(restored.get('.secondbrain/vault.json')!.toString('utf8'))).toEqual({
      ...JSON.parse(original.get('.secondbrain/vault.json')!.toString('utf8')),
      id: res.json().vaultId,
    });
    expect(existsSync(path.join(target, '4 Archive', 'Thư mục trống'))).toBe(true);
    expect(readdirSync(path.dirname(target))).toEqual(['vault mới']); // no temp folder left
    expect(t.context.vault.root).toBe(t.vaultRoot); // still the original vault
  });

  it('restores into an empty folder and opens it: the index is rebuilt with the same links', async () => {
    const target = path.join(outside, 'Mở luôn');
    mkdirSync(target);
    const form = multipartBody([['target', target]], { data: zip });
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/backup/restore',
      headers: {
        host: `localhost:${PORT}`,
        'x-sb-token': t.settings.sessionToken,
        origin: `http://localhost:${PORT}`,
        'content-type': form.contentType,
      },
      payload: form.payload,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().vaultId).toBe(
      readFileSync(path.join(target, '.secondbrain', 'vault.json'), 'utf8').match(
        /"id": ?"([^"]+)"/,
      )![1],
    );
    expect(t.context.vault.root).toBe(res.json().path);
    const reopened = await t.call('GET', `/api/note?${q('2 Areas/Giải tích 1.md')}`);
    expect(reopened.json().backlinks).toEqual(backlinks);
    expect(JSON.stringify((await t.call('GET', '/api/tasks')).json())).toContain('Nộp bài');
    expect((await t.call('GET', `/api/note?${q(NFD_NOTE.normalize('NFC'))}`)).statusCode).toBe(200);
    expect((await t.call('GET', '/api/journal/pending')).json()).toEqual({ entries: [] });
    expect(readFileSync(path.join(target, '.secondbrain', 'state', 'reminders.json'), 'utf8')).toBe(
      '{"version":1,"entries":[]}\n',
    );
  });
});
