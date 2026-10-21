import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOWNLOAD_CSP, SVG_CSP } from '../../src/api/files-route.js';
import { createVaultTestApp, q, type VaultTestApp } from './vault-test-app.js';

const PORT = 4791;
// Reveal never launches anything in these tests.
const NO_SPAWN = { reveal: { spawn: () => undefined } };
const REV = '0'.repeat(64);

/** Each case of SPEC §5 "Path guard" (after the HTTP layer decoded the request once). */
const BAD_PATHS: [string, string][] = [
  ['parent segment', '../secret.md'],
  ['nested parent segment', '0 Inbox/../../secret.md'],
  ['backslash parent segment', '0 Inbox\\..\\..\\secret.md'],
  ['absolute POSIX path', '/etc/passwd'],
  ['drive-absolute path', 'C:\\Windows\\win.ini'],
  ['drive-relative path', 'C:secret.md'],
  ['UNC path', '\\\\server\\share\\secret.md'],
  ['UNC with slashes', '//server/share/secret.md'],
  ['reserved device name', 'CON.md'],
  ['reserved device name without extension', 'nul'],
  ['reserved device name in a folder', '0 Inbox/lpt1.txt'],
  ['trailing dot', '0 Inbox/a.md.'],
  ['trailing space', '0 Inbox/a.md '],
  ['NUL character', '0 Inbox/a\u0000.md'],
  ['control character', '0 Inbox/a\u0007.md'],
  ['alternate data stream', '0 Inbox/a.md:hidden'],
  ['Windows-invalid character', '0 Inbox/a?.md'],
  ['empty path', ''],
  ['empty segment', '0 Inbox//a.md'],
  ['dot segment', './0 Inbox/a.md'],
  ['app state folder', '.secondbrain/vault.json'],
  ['app state folder, other case', '.SecondBrain/state/sample.json'],
  ['git internals', '.git/config'],
];

describe('path guard through the API (F1.5)', () => {
  let t: VaultTestApp;
  let revision: string;
  beforeAll(async () => {
    t = await createVaultTestApp(PORT, { vaultRoutes: NO_SPAWN });
    const created = await t.call('POST', '/api/note', { path: '0 Inbox/a.md' });
    revision = created.json().revision;
    await t.call('POST', '/api/folder', { path: '1 Projects/Thư mục' });
    // A folder and a file outside the vault, reachable only through links inside it.
    const outside = path.join(t.home, 'outside');
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'secret.md'), 'secret');
    symlinkSync(path.join(outside, 'secret.md'), path.join(t.vaultRoot, 'link.md'));
    symlinkSync(outside, path.join(t.vaultRoot, 'linked folder'), 'dir');
  });
  afterAll(async () => t?.close());

  const expectInvalidPath = async (response: Awaited<ReturnType<VaultTestApp['call']>>) => {
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json().error.code).toBe('INVALID_PATH');
    expect(response.json()).not.toHaveProperty('content');
  };

  it.each(BAD_PATHS)(
    '%s → 400 INVALID_PATH for read, write, create, rename target and files',
    async (_l, bad) => {
      await expectInvalidPath(await t.call('GET', `/api/note?${q(bad)}`));
      await expectInvalidPath(
        await t.call('PUT', '/api/note', { path: bad, content: 'x', expectedRevision: REV }),
      );
      await expectInvalidPath(await t.call('POST', '/api/note', { path: bad }));
      await expectInvalidPath(
        await t.call('POST', '/api/note/rename', {
          path: '0 Inbox/a.md',
          newPath: bad,
          expectedRevision: revision,
        }),
      );
      await expectInvalidPath(await t.call('GET', `/api/files?${q(bad)}`));
    },
  );

  it.each(BAD_PATHS)(
    '%s → 400 INVALID_PATH for properties, mentions, folders, reveal, tasks, reschedule and graph',
    async (_l, bad) => {
      const rev = { expectedRevision: revision };
      for (const [method, url, payload] of [
        ['PATCH', '/api/note/frontmatter', { path: bad, ...rev, set: { a: 1 } }],
        ['GET', `/api/note/mentions?${q(bad)}`, undefined],
        [
          'POST',
          '/api/note/link-mention',
          { path: bad, ...rev, start: 0, end: 1, target: '0 Inbox/a.md' },
        ],
        [
          'POST',
          '/api/note/link-mention',
          { path: '0 Inbox/a.md', ...rev, start: 0, end: 1, target: bad },
        ],
        ['POST', '/api/folder/rename', { path: bad, newPath: '1 Projects/x' }],
        ['POST', '/api/folder/rename', { path: '1 Projects/Thư mục', newPath: bad }],
        ['POST', '/api/folder/trash', { path: bad }],
        ['POST', '/api/reveal', { path: bad }],
        ['POST', '/api/note/rename', { path: '0 Inbox/a.md', newPath: bad, ...rev, dryRun: true }],
        ['PATCH', '/api/note/task', { path: bad, ...rev, line: 1, expectedText: 'x', done: true }],
        [
          'POST',
          '/api/note/reschedule',
          { path: bad, ...rev, target: { kind: 'note' }, date: '2026-10-20' },
        ],
        ['GET', `/api/graph/local?${q(bad)}`, undefined],
      ] as const) {
        await expectInvalidPath(await t.call(method, url, payload));
      }
    },
  );

  it('decodes the query only once: %2e%2e is rejected, %252e%252e is a literal name', async () => {
    await expectInvalidPath(await t.call('GET', '/api/note?path=%2e%2e%2Fsecret.md'));
    const literal = await t.call('GET', '/api/note?path=%252e%252e%2Fsecret.md');
    expect(literal.statusCode).toBe(404);
  });

  it('rejects links inside the vault that point outside it', async () => {
    await expectInvalidPath(await t.call('GET', `/api/note?${q('link.md')}`));
    await expectInvalidPath(await t.call('GET', `/api/files?${q('link.md')}`));
    await expectInvalidPath(
      await t.call('PUT', '/api/note', { path: 'link.md', content: 'x', expectedRevision: REV }),
    );
    await expectInvalidPath(await t.call('POST', '/api/note', { path: 'linked folder/new.md' }));
    await expectInvalidPath(await t.call('GET', `/api/files?${q('linked folder/secret.md')}`));
    await expectInvalidPath(
      await t.call('PATCH', '/api/note/frontmatter', {
        path: 'link.md',
        expectedRevision: REV,
        set: { a: 1 },
      }),
    );
    await expectInvalidPath(await t.call('POST', '/api/reveal', { path: 'linked folder' }));
    await expectInvalidPath(
      await t.call('PATCH', '/api/note/task', {
        path: 'link.md',
        expectedRevision: REV,
        line: 1,
        expectedText: 'secret',
        done: true,
      }),
    );
    await expectInvalidPath(
      await t.call('POST', '/api/note/reschedule', {
        path: 'linked folder/secret.md',
        expectedRevision: REV,
        target: { kind: 'note' },
        date: '2026-10-20',
      }),
    );
    await expectInvalidPath(await t.call('POST', '/api/folder/trash', { path: 'linked folder' }));
    await expectInvalidPath(
      await t.call('POST', '/api/folder/rename', {
        path: 'linked folder',
        newPath: '1 Projects/x',
      }),
    );
    await expectInvalidPath(
      await t.call('POST', '/api/folder/rename', {
        path: '1 Projects/Thư mục',
        newPath: 'linked folder/x',
      }),
    );
  });

  it('never serves vault.json or the global settings file', async () => {
    for (const target of [
      '.secondbrain/vault.json',
      '../.secondbrain/settings.json',
      path.join(t.home, '.secondbrain', 'settings.json'),
    ]) {
      const res = await t.call('GET', `/api/files?${q(target)}`);
      expect(res.statusCode).toBe(400);
      expect(res.body).not.toContain('sessionToken');
    }
  });
});

describe('vault file serving headers (SPEC §5 Security)', () => {
  let t: VaultTestApp;
  beforeAll(async () => {
    t = await createVaultTestApp(PORT + 10);
    const write = (relative: string, content: string | Buffer) => {
      mkdirSync(path.dirname(path.join(t.vaultRoot, relative)), { recursive: true });
      writeFileSync(path.join(t.vaultRoot, relative), content);
    };
    write('3 Resources/web/trang web (bản lưu).html', '<script>alert(1)</script>');
    write('0 Inbox/ghi chú.md', '# hi\n');
    write(
      'Attachments/hình.svg',
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    write('Attachments/2026-10/ảnh.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    write('3 Resources/papers/bài giảng 3.pdf', '%PDF-1.4\n');
    write('0 Inbox/ghi chú macOS.md'.normalize('NFD'), '# nfd\n');
    // A link inside the vault whose name claims an image while the target is an HTML page.
    symlinkSync(
      path.join('..', '3 Resources', 'web', 'trang web (bản lưu).html'),
      path.join(t.vaultRoot, 'Attachments', 'logo.png'),
    );
  });
  afterAll(async () => t?.close());

  const get = (vaultPath: string) => t.call('GET', `/api/files?${q(vaultPath)}`);

  it('HTML and Markdown are downloads that are never sniffed or rendered in the app origin', async () => {
    for (const file of ['3 Resources/web/trang web (bản lưu).html', '0 Inbox/ghi chú.md']) {
      const res = await get(file);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="[^"]*"; filename\*=UTF-8''/,
      );
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-type']).toBe('application/octet-stream');
      expect(res.headers['content-security-policy']).toBe(DOWNLOAD_CSP);
      expect(res.headers['cache-control']).toBe('no-store');
    }
    const md = await get('0 Inbox/ghi chú.md');
    expect(md.headers['content-disposition']).toContain(
      `filename*=UTF-8''${encodeURIComponent('ghi chú.md')}`,
    );
    expect(md.body).toBe('# hi\n');
  });

  it('SVG is served only as a sandboxed image', async () => {
    const res = await get('Attachments/hình.svg');
    expect(res.headers['content-type']).toBe('image/svg+xml');
    expect(res.headers['content-security-policy']).toBe(SVG_CSP);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('raster images are inline with their type; PDFs are attachments with their type', async () => {
    const png = await get('Attachments/2026-10/ảnh.png');
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.headers['content-disposition']).toBeUndefined();
    expect(png.rawPayload).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const pdf = await get('3 Resources/papers/bài giảng 3.pdf');
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toMatch(/^attachment;/);
  });

  it('takes type and download name from the file actually served, not the requested spelling', async () => {
    const linked = await get('Attachments/logo.png');
    expect(linked.statusCode).toBe(200);
    expect(linked.headers['content-type']).toBe('application/octet-stream');
    expect(linked.headers['content-disposition']).toContain(
      `filename*=UTF-8''${encodeURIComponent('trang web (bản lưu).html').replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
    );
    const nfd = await get('0 Inbox/ghi chú macOS.md'.normalize('NFC'));
    expect(nfd.statusCode).toBe(200);
    expect(nfd.headers['content-disposition']).toContain(
      `filename*=UTF-8''${encodeURIComponent('ghi chú macOS.md'.normalize('NFD'))}`,
    );
  });

  it('a missing file is 404 NOT_FOUND', async () => {
    const res = await get('Attachments/không có.png');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});
