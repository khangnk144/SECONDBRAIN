import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVaultTestApp, q, type VaultTestApp } from '../api/vault-test-app.js';
import { buildSampleDataSet } from '../../src/sample-data/sample-data-set.js';
import { inspectPdf } from './pdf-structure.js';

const PORT = 4795;
const NOW = new Date(2026, 9, 18, 8, 0);

interface Item {
  urgency: string;
  title: string;
  daysLeft: number;
}

describe('sample data endpoints (SPEC §10)', () => {
  let t: VaultTestApp;
  let created: string[];
  const disk = (vaultPath: string) => path.join(t.vaultRoot, ...vaultPath.split('/'));
  const sampleFile = () => path.join(t.vaultRoot, '.secondbrain', 'state', 'sample.json');

  beforeAll(async () => {
    t = await createVaultTestApp(PORT, { now: () => NOW, watcher: false });
  });
  afterAll(async () => t?.close());

  it('is offered on an empty vault and created on request, recorded in state/sample.json', async () => {
    expect((await t.call('GET', '/api/sample-data')).json()).toEqual({
      offered: true,
      present: false,
    });
    const res = await t.call('POST', '/api/sample-data');
    expect(res.statusCode, res.body).toBe(201);
    created = res.json().created;
    expect(created).toEqual(buildSampleDataSet('2026-10-18').map((file) => file.path));
    const manifest = JSON.parse(readFileSync(sampleFile(), 'utf8'));
    expect(manifest.files.map((f: { path: string }) => f.path)).toEqual(created);
    for (const entry of manifest.files) expect(entry.revision).toMatch(/^[0-9a-f]{64}$/);
    expect((await t.call('GET', '/api/sample-data')).json()).toEqual({
      offered: false,
      present: true,
    });
    const again = await t.call('POST', '/api/sample-data');
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('EXISTS');
  });

  it('writes three valid one-page PDFs into 3 Resources/papers', () => {
    const pdfs = created.filter((p) => p.startsWith('3 Resources/papers/') && p.endsWith('.pdf'));
    expect(pdfs).toHaveLength(3);
    for (const pdf of pdfs) expect(inspectPdf(readFileSync(disk(pdf))).objects).toBe(7);
  });

  it('shows every urgency colour on Today, an overdue task and the project progress', async () => {
    const today = (await t.call('GET', '/api/today')).json();
    const stripItems: Item[] = today.strip.days.flatMap((day: { items: Item[] }) => day.items);
    expect(new Set(stripItems.map((item) => item.urgency))).toEqual(
      new Set(['urgent', 'soon', 'ok']),
    );
    expect(today.strip.overdue.map((item: Item) => item.title)).toEqual([
      'Gửi email hỏi thầy về đồ án',
    ]);
    expect(today.todayTasks.map((task: { title: string }) => task.title)).toEqual(
      expect.arrayContaining(['Nộp bài tập Xác suất thống kê', 'Ôn lại công thức Bayes']),
    );
    expect(today.projects).toEqual([
      expect.objectContaining({
        title: 'Đồ án Giải tích',
        daysLeft: 12,
        progress: { done: 3, total: 5 },
      }),
    ]);
  });

  it('includes an ambiguous title pair linked from a Daily note', async () => {
    const daily = (await t.call('GET', `/api/note?${q('Daily/2026-10-16.md')}`)).json();
    expect(daily.outlinks).toEqual([
      expect.objectContaining({ target: 'Ghi chú', toPath: null, ambiguous: true }),
    ]);
    const search = (await t.call('GET', '/api/search?q=giai%20tich')).json();
    expect(search.results.map((r: { title: string }) => r.title)).toContain('Giải tích 1');
  });

  it('removes exactly the unchanged files, keeps an edited one and reports it', async () => {
    const edited = '0 Inbox/Sách cần mượn.md';
    const note = (await t.call('GET', `/api/note?${q(edited)}`)).json();
    await t.call('PUT', '/api/note', {
      path: edited,
      content: `${note.content}- thêm\n`,
      expectedRevision: note.revision,
    });

    const res = await t.call('DELETE', '/api/sample-data');
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.kept).toEqual([edited]);
    expect(body.removed.sort()).toEqual(created.filter((p) => p !== edited).sort());
    for (const removed of body.removed) expect(existsSync(disk(removed))).toBe(false);
    expect(existsSync(disk(edited))).toBe(true);
    const meta = JSON.parse(
      readFileSync(
        path.join(t.vaultRoot, '.secondbrain', 'trash', body.trashId, 'meta.json'),
        'utf8',
      ),
    );
    expect(meta.reason).toBe('sample-data');

    // The kept file is the user's now: the offer does not come back and nothing is left to remove.
    expect((await t.call('GET', '/api/sample-data')).json()).toEqual({
      offered: false,
      present: false,
    });
    expect(JSON.parse(readFileSync(sampleFile(), 'utf8'))).toMatchObject({
      files: [],
      removedAt: expect.any(String),
    });
    expect((await t.call('DELETE', '/api/sample-data')).statusCode).toBe(404);
    expect((await t.call('GET', '/api/today')).json().projects).toEqual([]);
  });
});
