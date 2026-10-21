import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureNoteName } from '../../src/capture/capture-note-name.js';
import { makeClock } from '../index/helpers/index-test-vault.js';
import { createVaultTestApp, type VaultTestApp } from './vault-test-app.js';

const PORT = 4842;
const NOW = new Date(2026, 9, 20, 9, 5);
const STAMP = 'Ghi nhanh 2026-10-20 09-05';

describe('quick capture file names (F12.2)', () => {
  it.each([
    ['Mua sữa cho mẹ', 'Mua sữa cho mẹ'],
    ['\n\n  Dòng đầu trống\nDòng hai', 'Dòng đầu trống'],
    ['# Ý tưởng đồ án', 'Ý tưởng đồ án'],
    ['> trích dẫn hay', 'trích dẫn hay'],
    ['- [ ] Nộp bài giải tích', 'Nộp bài giải tích'],
    ['- [x] Đã xong', 'Đã xong'],
    ['- gạch đầu dòng', 'gạch đầu dòng'],
    ['1. Bước một', 'Bước một'],
    ['> - [ ] lồng nhau', 'lồng nhau'],
    ['a\\b/c:d*e?f"g<h>i|j', 'a b c d e f g h i j'],
    ['[[Liên kết]] #thẻ ^khối', 'Liên kết thẻ khối'],
    ['Tab\tvà   nhiều    khoảng', 'Tab và nhiều khoảng'],
    ['Kết thúc bằng dấu chấm...', 'Kết thúc bằng dấu chấm'],
    ['...bắt đầu bằng chấm', 'bắt đầu bằng chấm'],
    [
      'Một hai ba bốn năm sáu bảy tám chín mười mười một',
      'Một hai ba bốn năm sáu bảy tám chín mười',
    ],
    ['Giải tích'.normalize('NFD'), 'Giải tích'],
    [`${'a'.repeat(39)}😀😀`, `${'a'.repeat(39)}😀`],
    ['CON', STAMP],
    ['nul.txt', STAMP],
    ['com1', STAMP],
    ['   ', STAMP],
    ['###', STAMP],
    ['- [ ]', STAMP],
    ['|||', STAMP],
    ['', STAMP],
    // Invisible and reordering characters never make it into a name.
    ['\u200b\u200b', STAMP],
    ['\u202eexe.gpj', 'exe.gpj'],
    ['Báo\u200b cáo\u2066 tuần\u2069', 'Báo cáo tuần'],
    ['\ufeffDòng có BOM', 'Dòng có BOM'],
    ['\u200b\u200f\nDòng thật', 'Dòng thật'],
    ['\u0301\u0301', STAMP],
    ['\u3164', STAMP],
    ['\ud800Lẻ\udc00 cặp', 'Lẻ cặp'],
    ['COM0', STAMP],
    ['lpt0.txt', STAMP],
    ['COM¹', STAMP],
  ])('%j → %j', (text, name) => {
    expect(captureNoteName(text, NOW)).toBe(name);
  });

  it('keeps 40 characters as people see them, never cutting an emoji sequence', () => {
    expect(captureNoteName('😀'.repeat(50), NOW)).toBe('😀'.repeat(40));
    const family = '👩\u200d👩\u200d👧\u200d👦';
    expect(captureNoteName(`${'a'.repeat(39)}${family}${family}`, NOW)).toBe(
      `${'a'.repeat(39)}${family}`,
    );
    const flag = '🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}';
    expect(captureNoteName(`${flag} cờ`, NOW)).toBe(`${flag} cờ`);
    const name = captureNoteName(`emoji ${family} `.repeat(5), NOW);
    expect(name).toBe(`emoji ${family} `.repeat(5).trimEnd());
    // A letter with a mark that has no precomposed form is one character of two code points.
    expect(captureNoteName('x\u0301'.repeat(45), NOW)).toBe('x\u0301'.repeat(40));
  });
});

describe('POST /api/capture (F12.1–F12.3)', () => {
  let t: VaultTestApp;
  beforeAll(async () => {
    t = await createVaultTestApp(PORT, { now: makeClock(NOW).now });
  });
  afterAll(async () => t?.close());

  const capture = (text: string) => t.call('POST', '/api/capture', { text });
  const inboxCount = async () => (await t.call('GET', '/api/tree')).json().inboxCount as number;

  it('writes the note to the Inbox with type, created and the text as typed', async () => {
    const before = await inboxCount();
    const res = await capture('Ý tưởng: đồ án *giải tích*\r\nDòng hai  \n\n');
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toEqual({
      path: '0 Inbox/Ý tưởng đồ án giải tích.md',
      revision: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const file = readFileSync(path.join(t.vaultRoot, '0 Inbox', 'Ý tưởng đồ án giải tích.md'));
    expect(file.toString('utf8')).toBe(
      '---\ntype: note\ncreated: 2026-10-20\n---\n\nÝ tưởng: đồ án *giải tích*\nDòng hai\n',
    );
    expect(await inboxCount()).toBe(before + 1);
    const note = (
      await t.call('GET', `/api/note?path=${encodeURIComponent(res.json().path)}`)
    ).json();
    expect(note.frontmatter).toEqual({ type: 'note', created: '2026-10-20' });
    expect(note.revision).toBe(res.json().revision);
  });

  it('makes names unique with " 2", " 3"', async () => {
    const paths = [];
    for (let i = 0; i < 3; i += 1) paths.push((await capture('Họp nhóm')).json().path);
    expect(paths).toEqual([
      '0 Inbox/Họp nhóm.md',
      '0 Inbox/Họp nhóm 2.md',
      '0 Inbox/Họp nhóm 3.md',
    ]);
    const stamped = [(await capture('CON')).json().path, (await capture('???')).json().path];
    expect(stamped).toEqual([`0 Inbox/${STAMP}.md`, `0 Inbox/${STAMP} 2.md`]);
  });

  it('a name with broken UTF-16 or invisible characters is the name on disk', async () => {
    const res = await capture('\ud800Ghi\u200b chú\u202e lạ\nthân');
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().path).toBe('0 Inbox/Ghi chú lạ.md');
    expect(readFileSync(path.join(t.vaultRoot, '0 Inbox', 'Ghi chú lạ.md'), 'utf8')).toContain(
      'thân',
    );
    const opened = await t.call('GET', `/api/note?path=${encodeURIComponent(res.json().path)}`);
    expect(opened.statusCode).toBe(200);
  });

  it('refuses empty and overlong text', async () => {
    for (const [text, reason] of [
      ['  \n\t ', 'empty'],
      ['x'.repeat(20_001), 'too-long'],
    ] as const) {
      const res = await capture(text);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.details.reason).toBe(reason);
    }
    expect((await capture('é'.repeat(20_000))).statusCode).toBe(201);
  });
});
