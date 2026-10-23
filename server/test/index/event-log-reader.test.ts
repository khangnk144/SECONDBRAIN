import { appendFileSync, openSync, closeSync, writeSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IndexEvent } from '../../src/index/event-log.js';
import { createEventLogReader } from '../../src/index/event-log-reader.js';
import { makeTempDir, removeDir } from '../helpers/test-environment.js';

const ts = '2026-10-21T02:00:00.000Z';
const line = (path: string, event: IndexEvent['event'] = 'note_created') =>
  `${JSON.stringify({ ts, event, path })}\n`;

describe('event log reader (cached, incremental)', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = makeTempDir('sb đọc nhật ký');
    file = path.join(dir, 'events.jsonl');
  });
  afterEach(() => removeDir(dir));

  it('reads every readable line, skips garbled ones, and answers [] without a log', async () => {
    const reader = createEventLogReader(file);
    expect(await reader.read()).toEqual([]);
    writeFileSync(file, `${line('A.md')}{not json\n\n${JSON.stringify({ x: 1 })}\n${line('Đ.md')}`);
    expect((await reader.read()).map((e) => e.path)).toEqual(['A.md', 'Đ.md']);
  });

  it('an unchanged file is not parsed again; appended lines are parsed alone', async () => {
    // Long enough that a change in the middle is outside the first bytes the reader compares.
    writeFileSync(
      file,
      Array.from({ length: 40 }, (_, i) => line(`2 Areas/Ghi chú ${i}.md`)).join(''),
    );
    const reader = createEventLogReader(file);
    const first = await reader.read();
    expect(first).toHaveLength(40);
    expect(await reader.read()).toBe(first);
    // Break a line in the middle (same length): only a reader that parses it again notices.
    const fd = openSync(file, 'r+');
    writeSync(fd, '\u0001', 2000);
    closeSync(fd);
    appendFileSync(file, line('Mới.md'));
    const next = await reader.read();
    expect(next).toHaveLength(41);
    expect(next[40]?.path).toBe('Mới.md');
    expect((await createEventLogReader(file).read()).length).toBeLessThan(41);
  });

  it('a last line still being written waits for its newline', async () => {
    const full = line('Một.md');
    writeFileSync(file, `${line('A.md')}${full.slice(0, 12)}`);
    const reader = createEventLogReader(file);
    expect((await reader.read()).map((e) => e.path)).toEqual(['A.md']);
    appendFileSync(file, full.slice(12));
    expect((await reader.read()).map((e) => e.path)).toEqual(['A.md', 'Một.md']);
  });

  it('a rewritten log (compaction, restore) is read anew', async () => {
    writeFileSync(file, line('A.md') + line('B.md'));
    const reader = createEventLogReader(file);
    expect(await reader.read()).toHaveLength(2);
    writeFileSync(file, line('Khác.md') + line('B.md') + line('C.md'));
    expect((await reader.read()).map((e) => e.path)).toEqual(['Khác.md', 'B.md', 'C.md']);
    rmSync(file);
    expect(await reader.read()).toEqual([]);
  });

  it('decodes Vietnamese paths across read chunks and never duplicates on parallel reads', async () => {
    const lines = Array.from({ length: 3000 }, (_, i) =>
      line(`1 Projects/Đồ án Giải tích ${i}.md`),
    );
    writeFileSync(file, lines.join('')); // well over one 64 KB stream chunk
    const reader = createEventLogReader(file);
    const [a, b] = await Promise.all([reader.read(), reader.read()]);
    expect(a).toHaveLength(3000);
    expect(b).toHaveLength(3000);
    expect(a[2999]?.path).toBe('1 Projects/Đồ án Giải tích 2999.md');
    appendFileSync(file, line('Cuối.md'));
    const [c, d] = await Promise.all([reader.read(), reader.read()]);
    expect(c).toHaveLength(3001);
    expect(d).toHaveLength(3001);
  });
});
