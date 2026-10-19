import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIndexRelinkPlanner } from '../../src/index/index-relink-planner.js';
import type { VaultChange } from '../../src/vault/vault-types.js';
import { createIndexedVault, type IndexedVault } from './helpers/index-test-vault.js';

const A = '2 Areas/Giải tích 1/Bài 1.md';
const B = '2 Areas/Xác suất/Bài 1.md';
let v: IndexedVault;
let pending: Promise<void>[] = [];

beforeEach(async () => {
  v = await createIndexedVault({
    files: {
      [A]: 'Bài một giải tích. Tự tham chiếu [[Bài 1#Ý chính]].\n',
      [B]: 'Bài một xác suất.\n',
      '2 Areas/Giải tích 1/Tổng hợp.md':
        'Xem [[Bài 1]] và [[Bài 1|bài đầu]].\n```\n[[Bài 1]]\n```\n',
      '2 Areas/Xác suất/Tổng hợp.md': 'Xem [[Bài 1]].\n',
      '0 Inbox/Nháp.md':
        'Đường dẫn [[2 Areas/Giải tích 1/Bài 1]] và ![[2 Areas/Giải tích 1/Bài 1#Hình]].\n',
    },
  });
  v.vault.setRelinkPlanner(createIndexRelinkPlanner(v.index, v.vault));
  // What the app context does: every vault change goes to the index.
  v.vault.onChange((change: VaultChange) => {
    if (change.kind === 'renamed') pending.push(v.index.renameFile(change.oldPath, change.path));
    else if (change.kind === 'written' || change.kind === 'created')
      pending.push(v.index.updateFile(change.path));
    else if (change.kind === 'deleted') pending.push(v.index.removeFile(change.path));
  });
});
afterEach(async () => {
  await Promise.all(pending);
  pending = [];
  await v.cleanup();
});

const disk = (p: string) => readFileSync(path.join(v.root, ...p.split('/')), 'utf8');

describe('relink planner on top of the index', () => {
  it('rewrites only the links that resolved to the renamed note, then backlinks follow it', async () => {
    const before = v.index
      .backlinks(A)
      .map((b) => b.fromPath)
      .sort();
    expect(before).toEqual(['0 Inbox/Nháp.md', '2 Areas/Giải tích 1/Tổng hợp.md']);
    const { revision } = await v.vault.read(A);
    const to = '2 Areas/Giải tích 1/Bài mở đầu.md';
    const result = await v.vault.rename(A, to, { expectedRevision: revision, relink: true });
    await Promise.all(pending);

    expect(disk('2 Areas/Giải tích 1/Tổng hợp.md')).toBe(
      'Xem [[Bài mở đầu]] và [[Bài mở đầu|bài đầu]].\n```\n[[Bài 1]]\n```\n',
    );
    expect(disk('2 Areas/Xác suất/Tổng hợp.md')).toBe('Xem [[Bài 1]].\n');
    expect(disk('0 Inbox/Nháp.md')).toBe(
      'Đường dẫn [[2 Areas/Giải tích 1/Bài mở đầu]] và ![[2 Areas/Giải tích 1/Bài mở đầu#Hình]].\n',
    );
    expect(disk(to)).toBe('Bài một giải tích. Tự tham chiếu [[Bài mở đầu#Ý chính]].\n');
    expect(result.affected.sort()).toEqual(['0 Inbox/Nháp.md', '2 Areas/Giải tích 1/Tổng hợp.md']);

    expect(v.index.getNote(A)).toBeNull();
    expect(
      v.index
        .backlinks(to)
        .map((b) => b.fromPath)
        .sort(),
    ).toEqual(before);
    expect(v.index.linkingNotes(B)).toEqual(['2 Areas/Xác suất/Tổng hợp.md']);
  });

  it('plans from the index catalog and backlinks without touching anything', async () => {
    const planner = createIndexRelinkPlanner(v.index, v.vault);
    const archived = { kind: 'move' as const, from: B, to: '4 Archive/Bài 1.md' };
    // Still the best title match after this move (fewest segments): nothing to rewrite.
    expect(await planner.plan(archived)).toEqual({ edits: [], skipped: [] });
    const deeper = { kind: 'move' as const, from: B, to: '2 Areas/Xác suất/Cũ/Bài 1.md' };
    const { edits } = await planner.plan(deeper);
    expect(edits.map((e) => e.path)).toEqual(['2 Areas/Xác suất/Tổng hợp.md']);
    // After this move the title would resolve to the other course's note: the path form is used.
    expect(edits[0]?.newContent).toBe('Xem [[2 Areas/Xác suất/Cũ/Bài 1]].\n');
    expect(disk('2 Areas/Xác suất/Tổng hợp.md')).toBe('Xem [[Bài 1]].\n');
  });

  it('never rewrites a note that is not UTF-8 and reports it as skipped', async () => {
    const ansiPath = '2 Areas/Giải tích 1/Ghi chú cũ.md';
    // Windows-1258 style bytes: 0xFA and 0xE0 on their own are not valid UTF-8.
    const ansi = Buffer.concat([
      Buffer.from('Ghi ch'),
      Buffer.from([0xfa]),
      Buffer.from(' v'),
      Buffer.from([0xe0]),
      Buffer.from(' xem [[Bài 1]]\r\n'),
    ]);
    v.writeFile(ansiPath, ansi);
    await v.index.updateFile(ansiPath);
    const planner = createIndexRelinkPlanner(v.index, v.vault);
    const to = '2 Areas/Giải tích 1/Bài mở đầu.md';
    const plan = await planner.plan({ kind: 'rename', from: A, to });
    expect(plan.skipped).toEqual([ansiPath]);
    expect(plan.edits.map((e) => e.path)).not.toContain(ansiPath);

    const { revision } = await v.vault.read(A);
    const result = await v.vault.rename(A, to, { expectedRevision: revision, relink: true });
    await Promise.all(pending);
    expect(result.skipped).toEqual([ansiPath]);
    expect(result.affected).not.toContain(ansiPath);
    expect(readFileSync(path.join(v.root, ...ansiPath.split('/')))).toEqual(ansi);
  });
});

describe('relink through the index keeps what every link means', () => {
  let w: IndexedVault;
  let waits: Promise<void>[] = [];
  beforeEach(async () => {
    w = await createIndexedVault({
      files: {
        '0 Inbox/Foo.md': 'Ghi chú Foo.\n',
        '2 Areas/Bar.md': 'Ghi chú Bar gốc.\n',
        '1 Projects/Dự án.md': 'Xem [[Bar]] và [[Foo]].\n',
      },
    });
    w.vault.onChange((change: VaultChange) => {
      if (change.kind === 'renamed') waits.push(w.index.renameFile(change.oldPath, change.path));
      else if (change.kind === 'written' || change.kind === 'created')
        waits.push(w.index.updateFile(change.path));
    });
  });
  afterEach(async () => {
    await Promise.all(waits);
    waits = [];
    await w.cleanup();
  });

  it('renaming into an existing title pins the other note’s links to their old target', async () => {
    let flushed = 0;
    w.vault.setRelinkPlanner(
      createIndexRelinkPlanner(w.index, w.vault, { beforePlan: async () => void flushed++ }),
    );
    const { revision } = await w.vault.read('0 Inbox/Foo.md');
    await w.vault.rename('0 Inbox/Foo.md', '0 Inbox/Bar.md', {
      expectedRevision: revision,
      relink: true,
    });
    await Promise.all(waits);
    expect(flushed).toBe(1);
    const text = readFileSync(path.join(w.root, '1 Projects', 'Dự án.md'), 'utf8');
    // [[Bar]] still means 2 Areas/Bar.md; [[Foo]] follows the renamed note.
    expect(text).toBe('Xem [[2 Areas/Bar]] và [[0 Inbox/Bar]].\n');
    const out = w.index.outlinks('1 Projects/Dự án.md').map((l) => l.toPath);
    expect(out).toEqual(['2 Areas/Bar.md', '0 Inbox/Bar.md']);
  });

  it('reports links that cannot be written so that they still resolve', async () => {
    w.vault.setRelinkPlanner(createIndexRelinkPlanner(w.index, w.vault));
    const { revision } = await w.vault.read('0 Inbox/Foo.md');
    const result = await w.vault.rename('0 Inbox/Foo.md', '0 Inbox/Bài [1].md', {
      expectedRevision: revision,
      relink: true,
    });
    expect(result.unresolvable).toEqual([{ path: '1 Projects/Dự án.md', raw: '[[Foo]]', line: 1 }]);
  });
});
