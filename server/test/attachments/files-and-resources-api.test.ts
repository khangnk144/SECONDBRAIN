import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOWNLOAD_CSP, SVG_CSP } from '../../src/api/files-route.js';
import { createVaultTestApp, q, type VaultTestApp } from '../api/vault-test-app.js';

const PORT = 47633;

function write(root: string, vaultPath: string, content: string | Buffer) {
  const abs = path.join(root, ...vaultPath.split('/'));
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

const FILES: Record<string, string> = {
  '3 Resources/papers/bài báo.pdf': '%PDF-1.4 bài báo',
  '3 Resources/papers/Trùng tên.pdf': '%PDF a',
  '3 Resources/other/Trùng tên.pdf': '%PDF b',
  '3 Resources/web/trang.html': '<script>alert(1)</script>',
  '3 Resources/web/trang.htm': '<b>htm</b>',
  '3 Resources/other/nguồn.md': '# Nguồn\n',
  '3 Resources/slides/Chương 10.pptx': 'PK',
  '3 Resources/slides/Chương 2.pptx': 'PK',
  'Attachments/2026-10/ảnh.png': 'png',
  'Attachments/2026-10/vẽ.svg':
    '<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>',
  '0 Inbox/không phải tài liệu.png': 'png',
  '1 Projects/Đồ án.md': [
    'Đọc [[bài báo.pdf]] và ![[ảnh.png]].',
    'Trang: [trang](<../3 Resources/web/trang.html>) và [[nguồn]].',
    'Mơ hồ: [[Trùng tên.pdf]].',
    'Lặp lại [[bài báo.pdf|bài báo]].',
    '',
  ].join('\n'),
  '2 Areas/Giải tích.md':
    'Ảnh ![[ảnh.png]], [[Attachments/2026-10/vẽ.svg]] và [[3 Resources/papers/Trùng tên.pdf]].\n',
};

describe('files, documents view and opening with the OS (F15)', () => {
  let t: VaultTestApp;
  const spawned: { command: string; args: string[] }[] = [];

  beforeAll(async () => {
    t = await createVaultTestApp(PORT, {
      seed: (root) => {
        for (const [vaultPath, content] of Object.entries(FILES)) write(root, vaultPath, content);
        write(root, '3 Resources/other/cài đặt.exe', 'MZ');
        // Written by macOS-style tools in NFD: listed under its NFC vault path, size still known.
        write(root, 'Attachments/2026-10/ảnh macOS.png'.normalize('NFD'), 'png nfd');
      },
      vaultRoutes: { reveal: { spawn: (command) => spawned.push(command), platform: 'win32' } },
    });
  });
  afterAll(async () => t?.close());

  describe('GET /api/files (F15.3)', () => {
    it.each([
      ['3 Resources/web/trang.html', 'trang.html'],
      ['3 Resources/web/trang.htm', 'trang.htm'],
      ['3 Resources/other/nguồn.md', 'nguồn.md'],
      ['3 Resources/papers/bài báo.pdf', 'bài báo.pdf'],
    ])('%s is a sandboxed download, never rendered in the app origin', async (vaultPath, name) => {
      const res = await t.call('GET', `/api/files?${q(vaultPath)}`);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-disposition']).toContain('attachment;');
      expect(res.headers['content-disposition']).toContain(
        `filename*=UTF-8''${encodeURIComponent(name)}`,
      );
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBe(DOWNLOAD_CSP);
      expect(res.headers['content-type']).not.toMatch(/html|markdown|text/);
    });

    it('serves images inline and SVG only as a sandboxed image', async () => {
      const png = await t.call('GET', `/api/files?${q('Attachments/2026-10/ảnh.png')}`);
      expect(png.headers['content-type']).toBe('image/png');
      expect(png.headers['content-disposition']).toBeUndefined();
      const svg = await t.call('GET', `/api/files?${q('Attachments/2026-10/vẽ.svg')}`);
      expect(svg.headers['content-type']).toBe('image/svg+xml');
      expect(svg.headers['content-security-policy']).toBe(SVG_CSP);
      expect(svg.headers['content-disposition']).toBeUndefined();
    });

    it('download=1 forces a download for images and SVG too', async () => {
      for (const [vaultPath, type] of [
        ['Attachments/2026-10/ảnh.png', 'image/png'],
        ['Attachments/2026-10/vẽ.svg', 'image/svg+xml'],
        ['3 Resources/papers/bài báo.pdf', 'application/pdf'],
      ] as const) {
        const res = await t.call('GET', `/api/files?${q(vaultPath)}&download=1`);
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe(type);
        expect(res.headers['content-disposition']).toMatch(/^attachment; filename="/);
        expect(res.headers['x-content-type-options']).toBe('nosniff');
      }
      const inline = await t.call(
        'GET',
        `/api/files?${q('Attachments/2026-10/ảnh.png')}&download=0`,
      );
      expect(inline.headers['content-disposition']).toBeUndefined();
      const bad = await t.call(
        'GET',
        `/api/files?${q('Attachments/2026-10/ảnh.png')}&download=yes`,
      );
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error.code).toBe('VALIDATION');
    });
  });

  describe('GET /api/resources', () => {
    it('lists Resources and Attachments with the notes that reference each file', async () => {
      const res = await t.call('GET', '/api/resources');
      expect(res.statusCode).toBe(200);
      const files = res.json().files as {
        path: string;
        name: string;
        folder: string;
        kind: string;
        size: number;
        mtime: number;
        referencedBy: { path: string; title: string }[];
      }[];
      expect(files.map((file) => file.path)).toEqual([
        '3 Resources/other/cài đặt.exe',
        '3 Resources/other/nguồn.md',
        '3 Resources/other/Trùng tên.pdf',
        '3 Resources/papers/bài báo.pdf',
        '3 Resources/papers/Trùng tên.pdf',
        '3 Resources/slides/Chương 2.pptx',
        '3 Resources/slides/Chương 10.pptx',
        '3 Resources/web/trang.htm',
        '3 Resources/web/trang.html',
        'Attachments/2026-10/ảnh macOS.png',
        'Attachments/2026-10/ảnh.png',
        'Attachments/2026-10/vẽ.svg',
      ]);
      const byPath = new Map(files.map((file) => [file.path, file]));
      const project = { path: '1 Projects/Đồ án.md', title: 'Đồ án' };
      const area = { path: '2 Areas/Giải tích.md', title: 'Giải tích' };
      expect(byPath.get('3 Resources/papers/bài báo.pdf')).toMatchObject({
        name: 'bài báo.pdf',
        folder: '3 Resources/papers',
        kind: 'pdf',
        size: Buffer.byteLength(FILES['3 Resources/papers/bài báo.pdf']!),
        referencedBy: [project],
      });
      expect(byPath.get('3 Resources/papers/bài báo.pdf')!.mtime).toBeGreaterThan(0);
      expect(byPath.get('Attachments/2026-10/ảnh.png')).toMatchObject({
        kind: 'image',
        referencedBy: [project, area],
      });
      expect(byPath.get('3 Resources/web/trang.html')).toMatchObject({
        kind: 'other',
        referencedBy: [project],
      });
      expect(byPath.get('3 Resources/other/nguồn.md')).toMatchObject({
        kind: 'note',
        referencedBy: [project],
      });
      expect(byPath.get('Attachments/2026-10/vẽ.svg')!.referencedBy).toEqual([area]);
      expect(byPath.get('Attachments/2026-10/ảnh macOS.png')!.size).toBe(7);
      expect(byPath.get('3 Resources/slides/Chương 2.pptx')!.kind).toBe('document');
      // The title-form link to the duplicated name is ambiguous and counts for neither file;
      // the path form counts for its own file only.
      expect(byPath.get('3 Resources/other/Trùng tên.pdf')!.referencedBy).toEqual([]);
      expect(byPath.get('3 Resources/papers/Trùng tên.pdf')!.referencedBy).toEqual([area]);
    });
  });

  describe('POST /api/files/open-external', () => {
    it('opens a vault file with the OS through explorer.exe (no shell, quoted path)', async () => {
      spawned.length = 0;
      const res = await t.call('POST', '/api/files/open-external', {
        path: '3 Resources/papers/bài báo.pdf',
      });
      expect(res.statusCode).toBe(204);
      expect(spawned).toEqual([
        {
          command: 'explorer.exe',
          args: [`"${path.join(t.vaultRoot, '3 Resources', 'papers', 'bài báo.pdf')}"`],
          windowsVerbatimArguments: true,
        },
      ]);
    });

    it('refuses folders, missing files, programs and paths outside the vault', async () => {
      spawned.length = 0;
      const folder = await t.call('POST', '/api/files/open-external', { path: '3 Resources' });
      expect(folder.statusCode).toBe(400);
      expect(folder.json().error.details.reason).toBe('not-a-file');
      const missing = await t.call('POST', '/api/files/open-external', {
        path: 'Attachments/x.pdf',
      });
      expect(missing.statusCode).toBe(404);
      const program = await t.call('POST', '/api/files/open-external', {
        path: '3 Resources/other/cài đặt.exe',
      });
      expect(program.statusCode).toBe(400);
      expect(program.json().error.details.reason).toBe('executable');
      for (const bad of [
        '.secondbrain/vault.json',
        '../settings.json',
        'C:\\Windows\\notepad.exe',
      ]) {
        const res = await t.call('POST', '/api/files/open-external', { path: bad });
        expect(res.statusCode, bad).toBe(400);
        expect(res.json().error.code).toBe('INVALID_PATH');
      }
      expect(spawned).toEqual([]);
    });
  });
});
