import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTempDir, removeDir } from '../helpers/test-environment.js';
import { makeClock } from '../index/helpers/index-test-vault.js';
import { createVaultTestApp, q, snapshotTree, type VaultTestApp } from './vault-test-app.js';

const PORT = 4843;

describe('daily notes (F13.1–F13.3)', () => {
  let t: VaultTestApp;
  const read = (p: string) => readFileSync(path.join(t.vaultRoot, ...p.split('/')), 'utf8');
  const notes = () => snapshotTree(t.vaultRoot, (p) => p.startsWith('.secondbrain'));

  beforeAll(async () => {
    t = await createVaultTestApp(PORT, {
      now: makeClock(new Date(2026, 9, 19, 7, 30)).now,
      seed: (root) => {
        mkdirSync(path.join(root, 'Daily'));
        for (const name of ['2026-10-12.md', '2026-10-25.md', 'ghi chú.md', '2026-02-30.md']) {
          writeFileSync(path.join(root, 'Daily', name), '# x\n');
        }
      },
    });
  });
  afterAll(async () => t?.close());

  it('GET for a missing day is 404 and creates nothing', async () => {
    const before = notes();
    const res = await t.call('GET', '/api/daily?date=2026-10-19');
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatchObject({
      code: 'NOT_FOUND',
      details: { path: 'Daily/2026-10-19.md' },
    });
    expect(notes()).toEqual(before);
  });

  it('POST creates the note once from the Daily template, in Vietnamese, with the caret offset', async () => {
    const res = await t.call('POST', '/api/daily', { date: '2026-10-19' });
    expect(res.statusCode, res.body).toBe(201);
    const { path: p, revision, cursor } = res.json();
    expect(p).toBe('Daily/2026-10-19.md');
    const content = read(p);
    expect(content).toContain('type: daily\ncreated: 2026-10-19\n');
    expect(content).toContain('# thứ hai, 19 tháng 10 2026\n');
    expect(content).toContain('[[2026-10-18]] · [[2026-10-20]]');
    expect(content.slice(0, cursor)).toMatch(/## Việc hôm nay\n\n$/);
    expect(content).not.toContain('{{');
    const again = await t.call('POST', '/api/daily', { date: '2026-10-19' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toMatchObject({ code: 'EXISTS', details: { path: p } });
    expect(read(p)).toBe(content);
    expect((await t.call('GET', '/api/daily?date=2026-10-19')).json()).toEqual({
      path: p,
      revision,
    });
  });

  it('uses the UI language of the settings', async () => {
    t.settings.ui.language = 'en';
    try {
      const res = await t.call('POST', '/api/daily', { date: '2026-10-20' });
      expect(read(res.json().path)).toContain('# Tuesday, 20 October 2026\n');
    } finally {
      t.settings.ui.language = 'vi';
    }
  });

  it('prev/next jump to the nearest existing daily notes', async () => {
    const around = async (date: string) =>
      (await t.call('GET', `/api/daily/neighbors?date=${date}`)).json();
    expect(await around('2026-10-19')).toEqual({
      previous: 'Daily/2026-10-12.md',
      next: 'Daily/2026-10-20.md',
    });
    expect(await around('2026-10-22')).toEqual({
      previous: 'Daily/2026-10-20.md',
      next: 'Daily/2026-10-25.md',
    });
    expect(await around('2026-10-12')).toEqual({ previous: null, next: 'Daily/2026-10-19.md' });
    expect(await around('2026-12-01')).toEqual({ previous: 'Daily/2026-10-25.md', next: null });
  });

  it('without the template a minimal daily note is written (no caret)', async () => {
    const template = (await t.call('GET', `/api/note?${q('Templates/Daily.md')}`)).json();
    await t.call('POST', '/api/note/trash', {
      paths: ['Templates/Daily.md'],
      expectedRevisions: [template.revision],
    });
    const res = await t.call('POST', '/api/daily', { date: '2026-10-21' });
    expect(res.json().cursor).toBeNull();
    expect(read('Daily/2026-10-21.md')).toBe('---\ntype: daily\ncreated: 2026-10-21\n---\n\n');
  });

  it('refuses dates that are not calendar dates', async () => {
    for (const [method, url, body] of [
      ['GET', '/api/daily?date=2026-02-30', undefined],
      ['GET', '/api/daily/neighbors?date=hôm-nay', undefined],
      ['POST', '/api/daily', { date: '2026-1-5' }],
    ] as const) {
      const res = await t.call(method, url, body);
      expect(res.statusCode, url).toBe(400);
      expect(res.json().error.details.reason).toBe('invalid-date');
    }
  });
});

describe('an unusable Daily template still gives the day its note (F13.1)', () => {
  let t: VaultTestApp;
  let outside: string;
  const warnings: string[] = [];
  const template = () => path.join(t.vaultRoot, 'Templates', 'Daily.md');
  const read = (p: string) => readFileSync(path.join(t.vaultRoot, ...p.split('/')), 'utf8');
  const minimal = (date: string) => `---\ntype: daily\ncreated: ${date}\n---\n\n`;

  beforeAll(async () => {
    outside = makeTempDir('sb ngoài vault');
    writeFileSync(path.join(outside, 'Mẫu bí mật.md'), '# Bí mật {{date}}\n');
    t = await createVaultTestApp(4846, {
      now: makeClock(new Date(2026, 9, 19, 7, 30)).now,
      logger: { file: null, info() {}, warn: (m) => warnings.push(m), error() {} },
    });
  });
  afterAll(async () => {
    await t?.close();
    removeDir(outside);
  });

  it.each([
    [
      'a symlink out of the vault',
      '2026-11-01',
      'INVALID_PATH outside-vault',
      () => symlinkSync(path.join(outside, 'Mẫu bí mật.md'), template()),
    ],
    [
      'a dangling symlink',
      '2026-11-02',
      'INVALID_PATH outside-vault',
      () => symlinkSync(path.join(outside, 'không có.md'), template()),
    ],
    [
      'not UTF-8',
      '2026-11-03',
      'not-utf8',
      () => writeFileSync(template(), Buffer.from('# M\xe9 {{date}}\n', 'latin1')),
    ],
    // Like a missing template: nothing to report.
    ['a folder', '2026-11-04', null, () => mkdirSync(template())],
  ])('%s: POST creates the minimal note', async (_label, day, warning, make) => {
    rmSync(template(), { recursive: true, force: true });
    make();
    warnings.length = 0;
    const res = await t.call('POST', '/api/daily', { date: day });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ path: `Daily/${day}.md`, cursor: null });
    expect(read(`Daily/${day}.md`)).toBe(minimal(day));
    expect(readFileSync(path.join(outside, 'Mẫu bí mật.md'), 'utf8')).toBe('# Bí mật {{date}}\n');
    expect(warnings).toEqual(
      warning ? [`Daily template not used (${warning}); minimal note created.`] : [],
    );
  });
});

describe('a template that is not UTF-8 is refused, not copied with U+FFFD (F14.2)', () => {
  let t: VaultTestApp;
  beforeAll(async () => {
    t = await createVaultTestApp(4847, {
      seed: (root) => {
        mkdirSync(path.join(root, 'Templates'));
        writeFileSync(
          path.join(root, 'Templates', 'Latin1.md'),
          Buffer.from('# M\xe9u \xe9t\xe9 {{title}}\n', 'latin1'),
        );
      },
    });
  });
  afterAll(async () => t?.close());

  it('answers 400 template-not-utf8 and creates nothing', async () => {
    const before = snapshotTree(t.vaultRoot, (p) => p.startsWith('.secondbrain'));
    const res = await t.call('POST', '/api/note', {
      path: '0 Inbox/Từ latin1.md',
      template: 'Templates/Latin1.md',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: 'VALIDATION',
      details: { path: 'Templates/Latin1.md', reason: 'template-not-utf8' },
    });
    expect(snapshotTree(t.vaultRoot, (p) => p.startsWith('.secondbrain'))).toEqual(before);
  });
});

describe('creating a note from a template places the caret (F14.2)', () => {
  let t: VaultTestApp;
  beforeAll(async () => {
    t = await createVaultTestApp(PORT + 1, { now: makeClock(new Date(2026, 9, 19, 7, 30)).now });
  });
  afterAll(async () => t?.close());

  it('substitutes the variables and returns the offset of {{cursor}}', async () => {
    const res = await t.call('POST', '/api/note', {
      path: '1 Projects/Đồ án Xác suất.md',
      template: 'Templates/Course project.md',
    });
    expect(res.statusCode, res.body).toBe(201);
    const { content } = (await t.call('GET', `/api/note?${q(res.json().path)}`)).json();
    expect(content).toContain('created: 2026-10-19\n');
    expect(content).toContain('# Đồ án Xác suất\n');
    expect(content).not.toContain('{{');
    expect(content.slice(0, res.json().cursor)).toMatch(/## Yêu cầu\n\n$/);
    expect(content.slice(res.json().cursor)).toMatch(/^\n\n## Ghi chú/);
  });

  it('a blank note or exact content has no caret position', async () => {
    const blank = await t.call('POST', '/api/note', { path: '0 Inbox/Trống.md' });
    expect(blank.json().cursor).toBeNull();
    const exact = await t.call('POST', '/api/note', {
      path: '0 Inbox/Đúng.md',
      content: '{{cursor}}',
    });
    expect(exact.json().cursor).toBeNull();
  });
});
