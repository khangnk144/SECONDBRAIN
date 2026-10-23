// A crash in the middle of an append leaves `events.jsonl` without its last newline; the next
// event must still be readable (review L1, SPEC §4.15).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createEventLog, type IndexEvent } from '../../src/index/event-log.js';
import { createEventLogReader } from '../../src/index/event-log-reader.js';
import { makeTempDir, removeDir } from '../helpers/test-environment.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(removeDir));

function logFile(): string {
  const dir = makeTempDir('sb nhật ký sự kiện');
  dirs.push(dir);
  return path.join(dir, 'state', 'events.jsonl');
}

const ts = new Date(2026, 9, 22, 9, 0).toISOString();
const created = (p: string): IndexEvent => ({ ts, event: 'note_created', path: p });

describe('appending after a torn last line (review L1)', () => {
  it('the next event starts on its own line; the cut fragment alone is lost', async () => {
    const file = logFile();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(created('a.md'))}\n{"ts":"${ts}","event":"note_cre`);
    const log = createEventLog(file, (error) => {
      throw error;
    });
    log.append([
      created('0 Inbox/Ý tưởng.md'),
      { ts, event: 'link_added', path: '0 Inbox/Ý tưởng.md', target: 'a' },
    ]);
    log.append([created('0 Inbox/Thứ hai.md')]);
    const events = await createEventLogReader(file).read();
    expect(events.map((e) => `${e.event} ${e.path}`)).toEqual([
      'note_created a.md',
      'note_created 0 Inbox/Ý tưởng.md',
      'link_added 0 Inbox/Ý tưởng.md',
      'note_created 0 Inbox/Thứ hai.md',
    ]);
    // Exactly one newline was added, and only once.
    expect(readFileSync(file, 'utf8').split('\n')).toHaveLength(6);
  });

  it('a whole file gets no blank line; a new file starts at its first byte', async () => {
    const file = logFile();
    const log = createEventLog(file, () => undefined);
    log.append([created('a.md')]);
    const again = createEventLog(file, () => undefined); // a restart
    again.append([created('b.md')]);
    expect(readFileSync(file, 'utf8')).toBe(
      `${JSON.stringify(created('a.md'))}\n${JSON.stringify(created('b.md'))}\n`,
    );
  });

  it('after a failed append the tail is checked again', async () => {
    const file = logFile();
    const errors: unknown[] = [];
    const log = createEventLog(file, (error) => errors.push(error));
    log.append([created('a.md')]);
    // The append fails (here: a folder took the file's place), then the file is back, cut.
    rmSync(file);
    mkdirSync(file);
    log.append([created('b.md')]);
    expect(errors).toHaveLength(1);
    rmSync(file, { recursive: true });
    writeFileSync(file, `${JSON.stringify(created('a.md'))}\n{"cut`);
    log.append([created('c.md')]);
    const events = await createEventLogReader(file).read();
    expect(events.map((e) => e.path)).toEqual(['a.md', 'c.md']);
  });
});
