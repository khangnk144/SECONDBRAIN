import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVaultTestApp, q, type VaultTestApp } from './vault-test-app.js';

const PORT = 4820;
const NOW = new Date(2026, 9, 18, 9, 30);
const PROJECT = '1 Projects/Đồ án Giải tích.md';
const BROKEN = '0 Inbox/YAML hỏng.md';
const SOURCE = [
  '---',
  '# thuộc tính dự án',
  'type: project',
  "status: 'doing'",
  'tags:',
  '  - đồ-án',
  '---',
  '# Đồ án',
  '',
].join('\r\n');

interface Item {
  path: string;
  kind: string;
  date: string;
}

describe('PATCH /api/note/frontmatter (F7)', () => {
  let t: VaultTestApp;
  const disk = (p: string) => readFileSync(path.join(t.vaultRoot, ...p.split('/')));
  const revisionOf = async (p: string) =>
    (await t.call('GET', `/api/note?${q(p)}`)).json().revision as string;
  const patch = (body: object) => t.call('PATCH', '/api/note/frontmatter', body);

  beforeAll(async () => {
    t = await createVaultTestApp(PORT, { now: () => NOW, watcher: false });
    for (const [p, content] of [
      [PROJECT, SOURCE],
      [BROKEN, '---\ntitle: [chưa đóng\n---\nNội dung\n'],
    ] as const) {
      const created = (await t.call('POST', '/api/note', { path: p, content })).json();
      expect(created.path).toBe(p);
    }
  });
  afterAll(async () => t?.close());

  it('changes only the edited key and answers the new revision and content (F7.1)', async () => {
    const res = await patch({
      path: PROJECT,
      expectedRevision: await revisionOf(PROJECT),
      set: { status: 'done', priority: 2 },
      unset: ['tags'],
    });
    expect(res.statusCode, res.body).toBe(200);
    const expected = [
      '---',
      '# thuộc tính dự án',
      'type: project',
      'status: done',
      'priority: 2',
      '---',
      '# Đồ án',
      '',
    ].join('\r\n');
    expect(res.json()).toEqual({ revision: await revisionOf(PROJECT), content: expected });
    expect(disk(PROJECT).toString('utf8')).toBe(expected);
    const note = (await t.call('GET', `/api/note?${q(PROJECT)}`)).json();
    expect(note.frontmatter).toEqual({ type: 'project', status: 'done', priority: 2 });
  });

  it('refuses invalid YAML with reason "invalid-yaml" and leaves the file byte-identical (F7.2)', async () => {
    const file = path.join(t.vaultRoot, ...BROKEN.split('/'));
    const [bytes, mtime] = [readFileSync(file), statSync(file).mtimeMs];
    const res = await patch({
      path: BROKEN,
      expectedRevision: await revisionOf(BROKEN),
      set: { a: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'invalid-yaml' },
    });
    expect(readFileSync(file)).toEqual(bytes);
    expect(statSync(file).mtimeMs).toBe(mtime);
  });

  it('refuses bad keys, unsupported values, duplicate keys and non-mapping roots', async () => {
    const cases: [object, string, string?][] = [
      [{ set: { 'a b': 1 } }, 'invalid-key'],
      [{ set: { a: { b: 1 } } }, 'unsupported-value'],
      [{ set: { a: [[1]] } }, 'unsupported-value'],
      [{ set: { b: 1 } }, 'duplicate-key', '---\na: 1\na: 2\n---\n'],
      [{ set: { b: 1 } }, 'not-mapping', '---\n- a\n---\n'],
    ];
    for (const [edit, reason, content] of cases) {
      const target = content ? `0 Inbox/case ${reason}.md` : PROJECT;
      if (content) await t.call('POST', '/api/note', { path: target, content });
      const res = await patch({
        path: target,
        expectedRevision: await revisionOf(target),
        ...edit,
      });
      expect(res.statusCode, reason).toBe(400);
      expect(res.json().error.details.reason).toBe(reason);
    }
  });

  it('answers 409 with the current revision and content for a stale revision or a deleted note', async () => {
    const current = (await t.call('GET', `/api/note?${q(PROJECT)}`)).json();
    const stale = await patch({ path: PROJECT, expectedRevision: 'a'.repeat(64), set: { x: 1 } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.details).toMatchObject({
      currentRevision: current.revision,
      currentContent: current.content,
    });
    const gone = await patch({
      path: '0 Inbox/Không có.md',
      expectedRevision: 'a'.repeat(64),
      set: { x: 1 },
    });
    expect(gone.statusCode).toBe(409);
    expect(gone.json().error.details.currentRevision).toBeNull();
  });

  it('a new deadline is on Today and the calendar as soon as the answer arrives (F7.3)', async () => {
    const res = await patch({
      path: PROJECT,
      expectedRevision: await revisionOf(PROJECT),
      set: { deadline: '2026-10-21', status: 'doing' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const today = (await t.call('GET', '/api/today')).json();
    const stripItems: Item[] = today.strip.days.flatMap((day: { items: Item[] }) => day.items);
    expect(stripItems).toContainEqual(
      expect.objectContaining({ path: PROJECT, kind: 'note', date: '2026-10-21' }),
    );
    const calendar = (await t.call('GET', '/api/calendar?month=2026-10')).json();
    const day = calendar.days.find((d: { date: string }) => d.date === '2026-10-21');
    expect(day.items).toContainEqual(expect.objectContaining({ path: PROJECT }));
  });

  it('writes a new block into a note without front matter, keeping a BOM', async () => {
    const plain = '0 Inbox/Không thuộc tính.md';
    const created = (
      await t.call('POST', '/api/note', { path: plain, content: '\uFEFFchỉ chữ\n' })
    ).json();
    const res = await patch({
      path: plain,
      expectedRevision: created.revision,
      set: { course: '[[Giải tích 1]]' },
    });
    expect(res.json().content).toBe('\uFEFF---\ncourse: "[[Giải tích 1]]"\n---\nchỉ chữ\n');
  });
});
