import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { authHeaders } from '../helpers/test-environment.js';
import { createVaultTestApp, q, type VaultTestApp } from '../api/vault-test-app.js';
import { multipartBody, type MultipartPart } from './multipart-body.js';

const PORT = 47631;
const PDF = Buffer.from('%PDF-1.4\n% bài giảng\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let t: VaultTestApp | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});

function upload(app: VaultTestApp, parts: MultipartPart[]) {
  const { payload, contentType } = multipartBody(parts);
  return app.app.inject({
    method: 'POST',
    url: '/api/attachments',
    headers: {
      ...authHeaders(PORT),
      origin: `http://localhost:${PORT}`,
      'content-type': contentType,
    },
    payload,
  });
}

const file = (filename: string, content: Buffer = PDF): MultipartPart => ({
  name: 'file',
  filename,
  content,
});

describe('POST /api/attachments (F15.1)', () => {
  it('keeps the name of a dropped PDF, then makes the next one unique with " 2"', async () => {
    t = await createVaultTestApp(PORT);
    const first = await upload(t, [{ name: 'target', value: 'auto' }, file('bài giảng 3.pdf')]);
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json()).toEqual({
      path: '3 Resources/papers/bài giảng 3.pdf',
      name: 'bài giảng 3.pdf',
      kind: 'pdf',
      link: '[[bài giảng 3.pdf]]',
    });
    expect(
      readFileSync(path.join(t.vaultRoot, '3 Resources', 'papers', 'bài giảng 3.pdf')),
    ).toEqual(PDF);
    const second = await upload(t, [file('bài giảng 3.pdf')]);
    expect(second.json()).toMatchObject({
      path: '3 Resources/papers/bài giảng 3 2.pdf',
      link: '[[bài giảng 3 2.pdf]]',
    });
  });

  it('two image.png dropped in October and November get distinct names and links', async () => {
    let clock = new Date(2026, 9, 21, 10, 0);
    t = await createVaultTestApp(PORT, { now: () => clock });
    const october = await upload(t, [file('image.png', PNG)]);
    clock = new Date(2026, 10, 2, 8, 30);
    const november = await upload(t, [{ name: 'target', value: 'papers' }, file('image.png', PNG)]);
    expect(october.json()).toEqual({
      path: 'Attachments/2026-10/image.png',
      name: 'image.png',
      kind: 'image',
      link: '![[image.png]]',
    });
    expect(november.json()).toMatchObject({
      path: 'Attachments/2026-11/image 2.png',
      link: '![[image 2.png]]',
    });
  });

  it('compares names case-insensitively and across NFC/NFD, vault-wide', async () => {
    t = await createVaultTestApp(PORT, {
      seed: (root) => {
        mkdirSync(path.join(root, '3 Resources', 'other'), { recursive: true });
        writeFileSync(path.join(root, '3 Resources', 'other', 'Image.PNG'), PNG);
        mkdirSync(path.join(root, '0 Inbox'));
        writeFileSync(path.join(root, '0 Inbox', 'báo cáo.pdf.md'), 'ghi chú tên giống tệp\n');
      },
    });
    expect((await upload(t, [file('image.png', PNG)])).json().name).toBe('image 2.png');
    expect((await upload(t, [file('IMAGE 2.png', PNG)])).json().name).toBe('IMAGE 2 2.png');
    const nfd = await upload(t, [file('Báo cáo.pdf'.normalize('NFD'))]);
    // `[[báo cáo.pdf]]` would open the note titled "báo cáo.pdf": the file gets " 2".
    expect(nfd.json()).toMatchObject({
      name: 'Báo cáo 2.pdf',
      path: '3 Resources/papers/Báo cáo 2.pdf',
    });
    expect(readdirSync(path.join(t.vaultRoot, '3 Resources', 'papers'))).toEqual(['Báo cáo 2.pdf']);
  });

  it('turns dangerous client names into safe names inside the target folder', async () => {
    const clock = new Date(2026, 9, 21, 9, 5);
    t = await createVaultTestApp(PORT, { now: () => clock });
    const cases: [string, string][] = [
      ['..\\x.png', 'Attachments/2026-10/x.png'],
      ['../../.secondbrain/settings.json', '3 Resources/other/secondbrain settings.json'],
      ['a/b.pdf', '3 Resources/papers/a b.pdf'],
      ['CON.pdf', '3 Resources/papers/Tệp đính kèm 2026-10-21 09-05.pdf'],
      ['C:\\Windows\\win.ini', '3 Resources/other/C Windows win.ini'],
    ];
    for (const [clientName, expected] of cases) {
      const res = await upload(t, [file(clientName)]);
      expect(res.statusCode, clientName).toBe(201);
      expect(res.json().path, clientName).toBe(expected);
      expect(existsSync(path.join(t.vaultRoot, ...expected.split('/')))).toBe(true);
    }
    expect(existsSync(path.join(t.home, 'x.png'))).toBe(false);
    expect(existsSync(path.join(t.vaultRoot, '.secondbrain', 'settings.json'))).toBe(false);
  });

  it('honours the chosen folder for documents and refuses an unknown one', async () => {
    t = await createVaultTestApp(PORT);
    const slides = await upload(t, [{ name: 'target', value: 'slides' }, file('Chương 2.pdf')]);
    expect(slides.json()).toMatchObject({ path: '3 Resources/slides/Chương 2.pdf', kind: 'pdf' });
    const doc = await upload(t, [file('Đề cương.docx', Buffer.from('PK'))]);
    expect(doc.json()).toMatchObject({ path: '3 Resources/other/Đề cương.docx', kind: 'document' });
    const md = await upload(t, [file('nguồn.md', Buffer.from('# Nguồn\n'))]);
    expect(md.json()).toMatchObject({ kind: 'document', link: '[[nguồn.md]]' });
    const bad = await upload(t, [{ name: 'target', value: 'wiki' }, file('x.pdf')]);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'invalid-target' },
    });
  });

  it('answers 400 without a file part and for bodies that are not multipart', async () => {
    t = await createVaultTestApp(PORT);
    const noFile = await upload(t, [{ name: 'target', value: 'auto' }]);
    expect(noFile.statusCode).toBe(400);
    expect(noFile.json().error).toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'no-file' },
    });
    const json = await t.call('POST', '/api/attachments', { file: 'x' });
    expect(json.statusCode).toBe(400);
    expect(json.json().error).toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'not-multipart' },
    });
    const broken = await t.app.inject({
      method: 'POST',
      url: '/api/attachments',
      headers: {
        ...authHeaders(PORT),
        origin: `http://localhost:${PORT}`,
        'content-type': 'multipart/form-data',
      },
      payload: 'not really multipart',
    });
    expect(broken.statusCode).toBe(400);
    expect(broken.json().error.code).toBe('VALIDATION');
  });

  it('inserted links resolve through the link targets and in a note', async () => {
    t = await createVaultTestApp(PORT);
    const pdf = (await upload(t, [file('bài giảng 3.pdf')])).json();
    const image = (await upload(t, [file('sơ đồ.png', PNG)])).json();
    const targets = (await t.call('GET', '/api/link-targets')).json();
    expect(targets.files).toEqual(
      expect.arrayContaining([
        { path: pdf.path, name: pdf.name },
        { path: image.path, name: image.name },
      ]),
    );
    const note = '1 Projects/Đồ án.md';
    await t.call('POST', '/api/note', {
      path: note,
      content: `Xem ${pdf.link} và ${image.link}\n`,
    });
    const read = (await t.call('GET', `/api/note?${q(note)}`)).json();
    expect(read.outlinks.map((link: { toPath: string }) => link.toPath)).toEqual([
      pdf.path,
      image.path,
    ]);
  });
});
