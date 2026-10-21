import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { strToU8, Zip, ZipPassThrough, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BackupRefusedError } from '../../src/backup/backup-errors.js';
import { extractZipArchive } from '../../src/backup/zip-archive-extract.js';
import { safeEntrySegments } from '../../src/backup/zip-entry-names.js';
import { centralEntries, multipartBody } from '../helpers/backup-test-helpers.js';
import { makeTempDir, removeDir, TEST_TOKEN } from '../helpers/test-environment.js';
import { createVaultTestApp, type VaultTestApp } from '../api/vault-test-app.js';

const PORT = 47614;
const goodZip = () => Buffer.from(zipSync({ 'ghi chú.md': strToU8('# Xin chào\n') }));

/** Two entries with the same name (zipSync cannot make that: it takes an object). */
function duplicateZip(): Buffer {
  const chunks: Uint8Array[] = [];
  const zip = new Zip((_error, chunk) => chunks.push(chunk));
  for (let i = 0; i < 2; i += 1) {
    const file = new ZipPassThrough('a.md');
    zip.add(file);
    file.push(strToU8(`copy ${i}`), true);
  }
  zip.end();
  return Buffer.concat(chunks);
}

describe('restore refuses unsafe and broken archives, leaving nothing behind (F18.5)', () => {
  let t: VaultTestApp;
  let parent: string;
  beforeAll(async () => {
    t = await createVaultTestApp(PORT);
    parent = makeTempDir('sb khôi phục an toàn');
  });
  afterAll(async () => {
    await t?.close();
    removeDir(parent);
  });

  const restore = (fields: [string, string][], data?: Buffer, after: [string, string][] = []) => {
    const form = multipartBody(fields, data ? { data } : undefined, after);
    return t.app.inject({
      method: 'POST',
      url: '/api/backup/restore',
      headers: {
        host: `localhost:${PORT}`,
        'x-sb-token': TEST_TOKEN,
        origin: `http://localhost:${PORT}`,
        'content-type': form.contentType,
      },
      payload: form.payload,
    });
  };
  const expectRefused = (res: Awaited<ReturnType<typeof restore>>, reason: string) => {
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'VALIDATION', details: { reason } });
  };

  it.each([
    ['parent segment', '../x'],
    ['nested parent segment', 'a/../../x'],
    ['drive path', 'C:/x'],
    ['absolute path', '/x'],
    ['backslashes', 'a\\..\\b'],
    ['UNC path', '//server/share/x'],
    ['NUL character', 'a\u0000b.md'],
    ['reserved device name', '0 Inbox/CON.md'],
    ['trailing dot', 'ghi chú.'],
  ])('zip-slip entry (%s) is refused and nothing is written', async (_label, name) => {
    const folder = makeTempDir('sb zip slip');
    const target = path.join(folder, 'đích');
    const evil = Buffer.from(zipSync({ 'ok.md': strToU8('ok'), [name]: strToU8('pwned') }));
    expectRefused(
      await restore(
        [
          ['target', target],
          ['open', 'false'],
        ],
        evil,
      ),
      'unsafe-entry',
    );
    expect(readdirSync(folder)).toEqual([]); // no target, no temp folder
    expect(existsSync(path.join(path.dirname(folder), 'x'))).toBe(false);
    expect(t.context.vault.root).toBe(t.vaultRoot);
    removeDir(folder);
  });

  it('duplicate entry names are refused', async () => {
    expectRefused(
      await restore([['target', path.join(parent, 'trùng')]], duplicateZip()),
      'unsafe-entry',
    );
    expect(existsSync(path.join(parent, 'trùng'))).toBe(false);
  });

  it('a non-empty target is refused and left untouched', async () => {
    const target = path.join(parent, 'đã có');
    mkdirSync(target);
    writeFileSync(path.join(target, 'của tôi.md'), 'mine');
    expectRefused(await restore([['target', target]], goodZip()), 'target-not-empty');
    expect(readdirSync(target)).toEqual(['của tôi.md']);
    expect(readFileSync(path.join(target, 'của tôi.md'), 'utf8')).toBe('mine');
  });

  it.each([
    [
      'inside the open vault',
      () => path.join(t.vaultRoot, '0 Inbox', 'khôi phục'),
      'target-inside-vault',
    ],
    ['the app state folder', () => path.join(t.home, '.secondbrain', 'khôi phục'), 'overlaps-app'],
    ['a relative path', () => 'khôi phục', 'target-invalid'],
    ['a missing parent', () => path.join(parent, 'không có', 'đích'), 'target-invalid'],
  ])('a target %s is refused', async (_label, target, reason) => {
    expectRefused(await restore([['target', target()]], goodZip()), reason);
  });

  it('a target that is a file outside the vault is refused', async () => {
    const file = path.join(parent, 'tệp.txt');
    writeFileSync(file, 'x');
    expectRefused(await restore([['target', file]], goodZip()), 'target-invalid');
  });

  it('not a zip, a CRC mismatch, an unsupported method or an undecodable name → bad-archive', async () => {
    expectRefused(
      await restore([['target', path.join(parent, 'r1')]], Buffer.from('not a zip at all')),
      'bad-archive',
    );

    const stored = Buffer.from(zipSync({ 'a.md': strToU8('hello world') }, { level: 0 }));
    const flipped = Buffer.from(stored);
    const firstDataByte = 30 + 'a.md'.length; // of the only entry
    flipped.writeUInt8(flipped.readUInt8(firstDataByte) ^ 0xff, firstDataByte);
    expectRefused(await restore([['target', path.join(parent, 'r2')]], flipped), 'bad-archive');

    const method = Buffer.from(stored);
    method.writeUInt16LE(12, centralEntries(method)[0]!.offset + 10); // bzip2
    expectRefused(await restore([['target', path.join(parent, 'r3')]], method), 'bad-archive');

    const name = Buffer.from(stored);
    name[centralEntries(name)[0]!.offset + 46] = 0xff; // not UTF-8, no Unicode field
    expectRefused(await restore([['target', path.join(parent, 'r4')]], name), 'bad-archive');

    const lying = Buffer.from(zipSync({ 'a.md': strToU8('x'.repeat(5000)) }));
    lying.writeUInt32LE(10, centralEntries(lying)[0]!.offset + 24); // declares 10 bytes
    expectRefused(await restore([['target', path.join(parent, 'r5')]], lying), 'bad-archive');

    for (const name of ['r1', 'r2', 'r3', 'r4', 'r5'])
      expect(existsSync(path.join(parent, name))).toBe(false);
    expect(readdirSync(parent).filter((n) => n.startsWith('.sb-restore-'))).toEqual([]);
  });

  it('form problems are bad-form: no file, the file before the target, a strange open value, not multipart', async () => {
    expectRefused(await restore([['target', path.join(parent, 'f1')]]), 'bad-form');
    expectRefused(await restore([], goodZip(), [['target', path.join(parent, 'f2')]]), 'bad-form');
    expectRefused(
      await restore(
        [
          ['target', path.join(parent, 'f3')],
          ['open', 'yes'],
        ],
        goodZip(),
      ),
      'bad-form',
    );
    const json = await t.call('POST', '/api/backup/restore', { target: path.join(parent, 'f4') });
    expectRefused(json, 'bad-form');
    for (const name of ['f1', 'f2', 'f3', 'f4'])
      expect(existsSync(path.join(parent, name))).toBe(false);
  });
});

describe('zip-bomb caps and entry names', () => {
  let dir: string;
  beforeAll(() => {
    dir = makeTempDir('sb zip bomb');
  });
  afterAll(() => removeDir(dir));

  const extract = async (zip: Buffer, limits: { maxBytes: number; maxEntries: number }) => {
    const file = path.join(dir, `in-${Math.random().toString(16).slice(2)}.zip`);
    writeFileSync(file, zip);
    const dest = path.join(dir, `out-${Math.random().toString(16).slice(2)}`);
    mkdirSync(dest);
    return extractZipArchive(file, dest, limits).catch((error: unknown) =>
      error instanceof BackupRefusedError ? error.reason : Promise.reject(error),
    );
  };

  it('more bytes or entries than allowed → too-large before anything is written', async () => {
    const big = Buffer.from(zipSync({ 'a.md': new Uint8Array(2000) }));
    expect(await extract(big, { maxBytes: 1000, maxEntries: 10 })).toBe('too-large');
    const many = Buffer.from(
      zipSync({ 'a.md': strToU8('a'), 'b.md': strToU8('b'), 'c.md': strToU8('c') }),
    );
    expect(await extract(many, { maxBytes: 1000, maxEntries: 2 })).toBe('too-large');
    expect(await extract(many, { maxBytes: 1000, maxEntries: 3 })).toEqual({ files: 3, bytes: 3 });
  });

  it('entry names follow the path-guard rules but allow .secondbrain', () => {
    expect(safeEntrySegments('.secondbrain/state/reminders.json')).toEqual([
      '.secondbrain',
      'state',
      'reminders.json',
    ]);
    expect(safeEntrySegments('4 Archive/Thư mục trống/')).toEqual(['4 Archive', 'Thư mục trống']);
    for (const bad of [
      '',
      '/',
      '../a',
      'a/./b',
      'a//b',
      'a\\b',
      'C:a',
      'nul.txt',
      'a ',
      'a\u0007',
      'a:b',
    ])
      expect(safeEntrySegments(bad), JSON.stringify(bad)).toBeNull();
  });
});
