import { describe, expect, it } from 'vitest';
import { buildVaultTree } from '../../src/api/build-vault-tree.js';
import type { ServerEvent } from '../../src/ws/server-events.js';
import { createWebSocketHub, type HubSocket } from '../../src/ws/websocket-hub.js';

function fakeSocket(bufferedAmount = 0) {
  const sent: string[] = [];
  let onClose: () => void = () => {};
  const socket = {
    readyState: 1,
    bufferedAmount,
    terminated: false,
    send: (data: string) => sent.push(data),
    terminate() {
      socket.terminated = true;
    },
    on: (_event: 'close', listener: () => void) => {
      onClose = listener;
    },
  };
  return { socket: socket as HubSocket & { terminated: boolean }, sent, close: () => onClose() };
}

describe('WebSocket hub', () => {
  const event: ServerEvent = { type: 'note:deleted', path: '0 Inbox/Ý tưởng.md' };

  it('broadcasts to every open socket and forgets closed ones', () => {
    const hub = createWebSocketHub();
    const a = fakeSocket();
    const b = fakeSocket();
    hub.add(a.socket);
    hub.add(b.socket);
    hub.broadcast(event);
    expect(a.sent).toEqual([JSON.stringify(event)]);
    expect(b.sent).toEqual([JSON.stringify(event)]);
    b.close();
    hub.broadcast(event);
    expect(b.sent).toHaveLength(1);
    expect(hub.size).toBe(1);
  });

  it('drops a client that stopped reading instead of buffering without limit', () => {
    const hub = createWebSocketHub();
    const slow = fakeSocket(10 * 1024 * 1024);
    hub.add(slow.socket);
    hub.broadcast(event);
    expect(slow.sent).toEqual([]);
    expect(slow.socket.terminated).toBe(true);
    expect(hub.size).toBe(0);
  });
});

describe('vault tree', () => {
  const file = (path: string) => ({ path, size: 1, mtimeMs: 1 });
  const tree = buildVaultTree(
    {
      folders: [
        '0 Inbox',
        '1 Projects',
        '10 Extra',
        '2 Areas',
        'Daily',
        'Attachments',
        'Attachments/2026-10',
      ],
      files: [
        file('0 Inbox/b.md'),
        file('0 Inbox/a.md'),
        file('0 Inbox/ảnh.png'),
        file('1 Projects/Đồ án Giải tích.md'),
        file('1 Projects/sub/Bài 2.md'),
        file('Daily/2026-10-16.md'),
        file('Daily/2026-10-18.md'),
        file('Daily/2026-10-17.md'),
        file('Attachments/2026-10/image.png'),
        file('CLAUDE.md'),
      ],
    },
    ['1 Projects/sub/Bài 2.md'],
  );
  const child = (name: string) => tree.root.folders.find((folder) => folder.name === name)!;

  it('counts only notes directly in 0 Inbox', () => {
    expect(tree.inboxCount).toBe(2);
  });

  it('sorts folders naturally, notes by title and Daily notes newest first', () => {
    expect(tree.root.folders.map((folder) => folder.name)).toEqual([
      '0 Inbox',
      '1 Projects',
      '2 Areas',
      '10 Extra',
      'Attachments',
      'Daily',
    ]);
    expect(child('0 Inbox').files.map((f) => f.name)).toEqual(['a.md', 'ảnh.png', 'b.md']);
    expect(child('Daily').files.map((f) => f.title)).toEqual([
      '2026-10-18',
      '2026-10-17',
      '2026-10-16',
    ]);
  });

  it('gives files their class and title, sums notes per subtree and flags urgent ancestors', () => {
    const projects = child('1 Projects');
    expect(projects.noteCount).toBe(2);
    expect(projects.urgent).toBe(true);
    expect(projects.folders[0]).toMatchObject({
      path: '1 Projects/sub',
      urgent: true,
      noteCount: 1,
    });
    expect(child('0 Inbox').urgent).toBe(false);
    expect(tree.root.files).toEqual([
      {
        path: 'CLAUDE.md',
        name: 'CLAUDE.md',
        title: 'CLAUDE',
        class: 'control',
        isNote: true,
        size: 1,
        mtime: 1,
      },
    ]);
    expect(child('Attachments').folders[0]!.files[0]).toMatchObject({
      class: 'attachment',
      isNote: false,
    });
    expect(tree.root.noteCount).toBe(8);
  });
});
