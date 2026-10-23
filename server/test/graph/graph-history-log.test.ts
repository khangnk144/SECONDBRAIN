import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { replayEventLog } from '../../src/graph/graph-history-log.js';
import { createEventLogReader } from '../../src/index/event-log-reader.js';
import { makeTempDir, removeDir } from '../helpers/test-environment.js';
import { at, FIXTURE_LOG, PROJECT } from './graph-history-fixture.js';

const created = (p: string, local: string) =>
  `${JSON.stringify({ ts: at(local), event: 'note_created', path: p })}\n`;

/** The graph history's reading path: the vault's shared event-log reader, replayed. */
function createGraphLogReader() {
  const readers = new Map<string, ReturnType<typeof createEventLogReader>>();
  return {
    async read(file: string) {
      let reader = readers.get(file);
      if (!reader) {
        reader = createEventLogReader(file);
        readers.set(file, reader);
      }
      return replayEventLog(await reader.read());
    },
  };
}

describe('graph history log reader (F24.1)', () => {
  const dirs: string[] = [];
  const logFile = () => {
    const dir = makeTempDir('sb graph log Nhật ký');
    dirs.push(dir);
    const file = path.join(dir, 'state', 'events.jsonl');
    mkdirSync(path.dirname(file), { recursive: true });
    return file;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) removeDir(dir);
  });

  it('(F24.1) a missing log is an empty history', async () => {
    const state = await createGraphLogReader().read(logFile());
    expect(state.identities).toEqual([]);
    expect(state.firstTs).toBeNull();
  });

  it('(F24.1) replays the fixture; an unchanged file is served from the cache', async () => {
    const file = logFile();
    writeFileSync(file, `${FIXTURE_LOG.join('\n')}\n`);
    const reader = createGraphLogReader();
    const first = await reader.read(file);
    expect(first.applied).toBe(FIXTURE_LOG.length - 5);
    expect(first.alive.has(PROJECT)).toBe(true);
    expect(await reader.read(file)).toBe(first);
  });

  it('(F24.1) appended lines replay only the tail; an unfinished last line waits', async () => {
    const file = logFile();
    writeFileSync(file, created('0 Inbox/A.md', '2026-10-01'));
    const reader = createGraphLogReader();
    const state = await reader.read(file);
    expect(state.applied).toBe(1);
    const half = created('0 Inbox/Ghi chú dài.md', '2026-10-02');
    appendFileSync(file, created('0 Inbox/B.md', '2026-10-02') + half.slice(0, 20));
    expect((await reader.read(file)).applied).toBe(2);
    appendFileSync(file, half.slice(20));
    const after = await reader.read(file);
    expect(after).toBe(state);
    expect(after.applied).toBe(3);
    expect([...after.alive.keys()]).toEqual([
      '0 Inbox/A.md',
      '0 Inbox/B.md',
      '0 Inbox/Ghi chú dài.md',
    ]);
  });

  it('(F24.1) a file that shrank or was replaced is replayed from the start', async () => {
    const file = logFile();
    writeFileSync(
      file,
      created('0 Inbox/A.md', '2026-10-01') + created('0 Inbox/B.md', '2026-10-02'),
    );
    const reader = createGraphLogReader();
    expect((await reader.read(file)).applied).toBe(2);
    writeFileSync(file, created('0 Inbox/C.md', '2026-10-03'));
    const shrunk = await reader.read(file);
    expect([...shrunk.alive.keys()]).toEqual(['0 Inbox/C.md']);
    writeFileSync(
      file,
      created('0 Inbox/D.md', '2026-10-03') + created('0 Inbox/E.md', '2026-10-04'),
    );
    const replaced = await reader.read(file);
    expect([...replaced.alive.keys()]).toEqual(['0 Inbox/D.md', '0 Inbox/E.md']);
  });

  it('(F24.1) lines across chunk borders and multi-byte letters are read whole', async () => {
    const file = logFile();
    const lines = Array.from({ length: 30_000 }, (_, i) =>
      created(`0 Inbox/Ghi chú ${i} Đồ án.md`, '2026-10-01'),
    );
    writeFileSync(file, lines.join(''));
    const state = await createGraphLogReader().read(file);
    expect(state.applied).toBe(30_000);
    expect(state.skipped).toBe(0);
    expect(state.alive.has('0 Inbox/Ghi chú 29999 Đồ án.md')).toBe(true);
  });
});
