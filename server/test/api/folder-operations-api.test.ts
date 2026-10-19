import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HubSocket } from '../../src/ws/websocket-hub.js';
import { makeTempDir, removeDir } from '../helpers/test-environment.js';
import { createVaultTestApp, q, snapshotTree, type VaultTestApp } from './vault-test-app.js';

const PORT = 4822;
const SUB = '1 Projects/Giải tích/Bài tập cũ';
const MOVED = '1 Projects/Bài tập';
const SUMMARY = 'Tổng hợp.md';
const SEED: Record<string, string> = {
  [`${SUB}/Bài 1.md`]: '# Bài 1 (giải tích)\n',
  [`${SUB}/Ghi chú.md`]: 'Cùng thư mục: [[Bài 1]]\n',
  [`${SUB}/hình.png`]: 'PNG',
  '2 Areas/Đại số/Bài 1.md': '# Bài 1 (đại số)\n',
  [SUMMARY]: [
    'Gần nhất: [[Bài 1]]',
    `Đường dẫn: [[${SUB}/Bài 1|bài GT]]`,
    `Ảnh: ![[${SUB}/hình.png]]`,
    '`[[Bài 1]]` trong code',
    '',
  ].join('\n'),
  '0 Inbox/Không liên quan.md': 'Không có liên kết\n',
};
const RENAMED_SUMMARY = [
  // From the root, `[[Bài 1]]` meant the shorter path; after the move both are equally short,
  // so the link is pinned to the note it meant.
  'Gần nhất: [[2 Areas/Đại số/Bài 1]]',
  `Đường dẫn: [[${MOVED}/Bài 1|bài GT]]`,
  `Ảnh: ![[${MOVED}/hình.png]]`,
  '`[[Bài 1]]` trong code',
  '',
].join('\n');

interface TreeNode {
  path: string;
  folders: TreeNode[];
  files: { path: string }[];
}

function fakeSocket() {
  const events: { type: string; path?: string }[] = [];
  const socket: HubSocket = {
    readyState: 1,
    bufferedAmount: 0,
    send: (data) => events.push(JSON.parse(data)),
    terminate: () => undefined,
    on: () => undefined,
  };
  return { socket, events };
}

describe('folder rename, trash and undo through the API (F2.2)', () => {
  let t: VaultTestApp;
  const disk = (p: string) => readFileSync(path.join(t.vaultRoot, ...p.split('/')), 'utf8');
  const skipCache = (relative: string) => relative.startsWith('.secondbrain');
  const folderPaths = async () => {
    const tree = (await t.call('GET', '/api/tree')).json();
    const out: string[] = [];
    const walk = (node: TreeNode) => node.folders.forEach((f) => (out.push(f.path), walk(f)));
    walk(tree.root);
    return out;
  };

  beforeAll(async () => {
    t = await createVaultTestApp(PORT, {
      watcher: false,
      seed: (root) => {
        for (const [p, content] of Object.entries(SEED)) {
          mkdirSync(path.dirname(path.join(root, ...p.split('/'))), { recursive: true });
          writeFileSync(path.join(root, ...p.split('/')), content);
        }
      },
    });
  });
  afterAll(async () => t?.close());

  it('a dry run lists the notes whose links would change and touches nothing', async () => {
    const before = snapshotTree(t.vaultRoot, skipCache);
    const res = await t.call('POST', '/api/folder/rename', {
      path: SUB,
      newPath: MOVED,
      dryRun: true,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ dryRun: true, path: MOVED, affected: [SUMMARY] });
    expect(snapshotTree(t.vaultRoot, skipCache)).toEqual(before);
    expect((await t.call('GET', '/api/journal/pending')).json()).toEqual({ entries: [] });
  });

  it('renames with relink, refreshes tree and backlinks, and sends folder and note events', async () => {
    const client = fakeSocket();
    t.context.hub.add(client.socket);
    const res = await t.call('POST', '/api/folder/rename', { path: SUB, newPath: MOVED });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ journalId: expect.any(String), path: MOVED, affected: [SUMMARY] });
    expect(disk(SUMMARY)).toBe(RENAMED_SUMMARY);
    expect(disk(`${MOVED}/Ghi chú.md`)).toBe(SEED[`${SUB}/Ghi chú.md`]);
    expect(await folderPaths()).toContain(MOVED);
    expect(await folderPaths()).not.toContain(SUB);
    const moved = (await t.call('GET', `/api/note?${q(`${MOVED}/Bài 1.md`)}`)).json();
    expect(moved.backlinks.map((b: { fromPath: string }) => b.fromPath).sort()).toEqual(
      [`${MOVED}/Ghi chú.md`, SUMMARY].sort(),
    );
    expect((await t.call('GET', `/api/note?${q(`${SUB}/Bài 1.md`)}`)).statusCode).toBe(404);
    const seen = client.events.map((e) => `${e.type} ${e.path}`);
    expect(seen).toEqual(
      expect.arrayContaining([
        `folder:changed ${MOVED}`,
        `folder:changed ${SUB}`,
        `note:renamed ${MOVED}/Bài 1.md`,
        `note:renamed ${MOVED}/hình.png`,
        `note:changed ${SUMMARY}`,
      ]),
    );
    const undo = await t.call('POST', `/api/journal/${res.json().journalId}/undo`);
    expect(undo.statusCode, undo.body).toBe(200);
    for (const [p, content] of Object.entries(SEED)) expect(disk(p)).toBe(content);
    expect(await folderPaths()).toContain(SUB);
  });

  it('trashes the folder as one entry; undo brings it back', async () => {
    const res = await t.call('POST', '/api/folder/trash', { path: SUB });
    expect(res.statusCode, res.body).toBe(200);
    const { journalId, trashId, paths } = res.json();
    expect([...paths].sort()).toEqual(
      Object.keys(SEED)
        .filter((p) => p.startsWith(SUB))
        .sort(),
    );
    const meta = JSON.parse(
      readFileSync(path.join(t.vaultRoot, '.secondbrain', 'trash', trashId, 'meta.json'), 'utf8'),
    );
    expect(meta.reason).toBe('user');
    expect(await folderPaths()).not.toContain(SUB);
    expect((await t.call('GET', `/api/note?${q(`${SUB}/Bài 1.md`)}`)).statusCode).toBe(404);
    expect((await t.call('POST', `/api/journal/${journalId}/undo`)).statusCode).toBe(200);
    for (const [p, content] of Object.entries(SEED)) expect(disk(p)).toBe(content);
    expect((await t.call('GET', `/api/note?${q(`${SUB}/Bài 1.md`)}`)).statusCode).toBe(200);
  });

  it('refuses standard folders (403), an existing target (409), a target inside (400), a missing folder (404)', async () => {
    for (const standard of ['0 Inbox', '3 Resources/papers', 'wiki/research-gaps', 'Templates']) {
      for (const [url, body] of [
        ['/api/folder/rename', { path: standard, newPath: '1 Projects/Mới' }],
        ['/api/folder/trash', { path: standard }],
      ] as const) {
        const res = await t.call('POST', url, body);
        expect(res.statusCode, `${url} ${standard}`).toBe(403);
        expect(res.json().error).toMatchObject({
          code: 'FORBIDDEN',
          details: { reason: 'standard-folder' },
        });
      }
    }
    const exists = await t.call('POST', '/api/folder/rename', {
      path: SUB,
      newPath: '2 Areas/Đại số',
    });
    expect([exists.statusCode, exists.json().error.code]).toEqual([409, 'EXISTS']);
    const inside = await t.call('POST', '/api/folder/rename', {
      path: SUB,
      newPath: `${SUB}/Bên trong`,
    });
    expect([inside.statusCode, inside.json().error.details.reason]).toEqual([400, 'inside-source']);
    const missing = await t.call('POST', '/api/folder/trash', { path: '1 Projects/Không có' });
    expect(missing.statusCode).toBe(404);
    for (const [p, content] of Object.entries(SEED)) expect(disk(p)).toBe(content);
  });

  it('creates a folder, trashes it while still empty, and undo brings it back', async () => {
    expect((await t.call('POST', '/api/folder', { path: '2 Areas/Thư mục mới' })).statusCode).toBe(
      201,
    );
    expect(await folderPaths()).toContain('2 Areas/Thư mục mới');
    const res = await t.call('POST', '/api/folder/trash', { path: '2 Areas/Thư mục mới' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      journalId: expect.any(String),
      trashId: expect.any(String),
      paths: [],
    });
    expect(await folderPaths()).not.toContain('2 Areas/Thư mục mới');
    expect((await t.call('POST', `/api/journal/${res.json().journalId}/undo`)).statusCode).toBe(
      200,
    );
    expect(await folderPaths()).toContain('2 Areas/Thư mục mới');
  });
});

describe('a folder rename interrupted by a crash is finished after restart (F2.2, F1.7)', () => {
  const homes: string[] = [];
  afterAll(() => homes.splice(0).forEach(removeDir));

  it('restart lists it as pending; "complete" moves the rest and the index follows', async () => {
    const home = makeTempDir('sb folder Hoàn tất');
    homes.push(home);
    const seed = (root: string) => {
      for (const [p, content] of Object.entries(SEED)) {
        mkdirSync(path.dirname(path.join(root, ...p.split('/'))), { recursive: true });
        writeFileSync(path.join(root, ...p.split('/')), content);
      }
    };
    const first = await createVaultTestApp(PORT + 1, {
      home,
      seed,
      watcher: false,
      faults: { crashAfterJournalStep: (_id, applied) => applied === 1 },
    });
    const crashed = await first.call('POST', '/api/folder/rename', { path: SUB, newPath: MOVED });
    expect(crashed.statusCode).toBe(500);
    await first.close();
    const second = await createVaultTestApp(PORT + 1, { home, watcher: false });
    try {
      const { entries } = (await second.call('GET', '/api/journal/pending')).json();
      expect(entries).toEqual([
        expect.objectContaining({ op: 'folder-rename', appliedSteps: 1, totalSteps: 2 }),
      ]);
      expect(entries[0].paths).toEqual(expect.arrayContaining([SUB, MOVED, SUMMARY]));
      const done = await second.call('POST', `/api/journal/${entries[0].id}/complete`);
      expect(done.statusCode, done.body).toBe(200);
      expect(readFileSync(path.join(second.vaultRoot, SUMMARY), 'utf8')).toBe(RENAMED_SUMMARY);
      const note = (await second.call('GET', `/api/note?${q(`${MOVED}/Bài 1.md`)}`)).json();
      expect(note.backlinks.map((b: { fromPath: string }) => b.fromPath)).toContain(SUMMARY);
    } finally {
      await second.close();
    }
  });
});
