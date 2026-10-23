import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVaultTestApp, type VaultTestApp } from './vault-test-app.js';

/** Every time the server opens or streams `events.jsonl` (writes go through other calls). */
const opened = vi.hoisted(() => [] as string[]);
const isLog = (file: unknown) => String(file).endsWith('events.jsonl');

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  const open = ((file: Parameters<typeof fs.open>[0], ...rest: unknown[]) => {
    if (isLog(file)) opened.push(`open ${String(file)}`);
    return (fs.open as (...args: unknown[]) => ReturnType<typeof fs.open>)(file, ...rest);
  }) as typeof fs.open;
  return { ...fs, default: { ...fs, open }, open };
});
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  const createReadStream = ((file: Parameters<typeof fs.createReadStream>[0], options?: object) => {
    if (isLog(file)) opened.push(`stream ${String(file)}`);
    return fs.createReadStream(file, options as never);
  }) as typeof fs.createReadStream;
  return { ...fs, default: { ...fs, createReadStream }, createReadStream };
});

let t: VaultTestApp | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});

const NOTE = '1 Projects/Đồ án Giải tích.md';

describe('one cached reader of events.jsonl per vault (Today, activity, graph history)', () => {
  it('(F24.1)(F35.9) a change is read once, from where the last read ended, for every view', async () => {
    t = await createVaultTestApp(47872, { watcher: false });
    const app = t;
    const views = async () => {
      for (const url of ['/api/today', '/api/graph/history', '/api/graph', '/api/review/week']) {
        expect((await app.call('GET', url)).statusCode, url).toBe(200);
      }
    };
    await views();
    const events = await app.context.activity.events();

    opened.length = 0;
    const created = await app.call('POST', '/api/note', { path: NOTE });
    expect(created.statusCode).toBe(201);
    await app.context.settled();
    await views();
    // One head check and one tail read for all four views (each used to keep its own reader).
    expect(opened.map((line) => line.split(' ')[0])).toEqual(['open', 'stream']);

    // The same array grew in place; the history and Today see the new note.
    expect(await app.context.activity.events()).toBe(events);
    expect(events.some((e) => e.event === 'note_created' && e.path === NOTE)).toBe(true);
    const history = (await app.call('GET', '/api/graph/history')).json();
    expect(history.nodes.some((n: { id: string }) => n.id === NOTE)).toBe(true);
    const today = (await app.call('GET', '/api/today')).json();
    expect(today.activity.brain.notesNew).toBe(1);

    // Nothing changed since: no read at all.
    opened.length = 0;
    await views();
    expect(opened).toEqual([]);
  });
});
