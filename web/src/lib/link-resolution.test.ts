import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLinkCatalog, resolveLinkTarget, type LinkKind } from './link-resolution';
import { useLinkTargetsStore } from './link-targets-store';
import { installFetchMock } from './testing/fetch-mock';
import { emitServerEvent, clearServerEventHandlers } from './ws/server-event-bus';
import { startLinkTargetsSync, LINK_TARGETS_REFRESH_DEBOUNCE_MS } from './link-targets-store';

// Same fixture and expectations as server/test/markdown/resolve-link.test.ts.
const catalog = buildLinkCatalog([
  '1 Projects/Toán/Bài 1.md',
  '2 Areas/Lý/Bài 1.md',
  '2 Areas/Giải tích 1.md',
  'Bài 2.md',
  '2 Areas/Sub/Bài 2.md',
  'a/x/Bài 4.md',
  'b/y/Bài 4.md',
  'Templates/Course project.md',
  '3 Resources/papers/bài giảng 3.pdf',
  'Attachments/2026-10/ảnh.png',
  'Attachments/2026-11/ảnh.png',
  'Attachments/2026-10/sơ đồ.png',
]);

function resolve(target: string, from = '0 Inbox/Note.md', kind: LinkKind = 'wikilink') {
  return resolveLinkTarget(catalog, target, from, kind);
}

describe('client link resolution, title form (F4.2)', () => {
  it('resolves a unique title case-insensitively, NFC = NFD', () => {
    expect(resolve('Giải tích 1')).toEqual({ status: 'resolved', path: '2 Areas/Giải tích 1.md' });
    expect(resolve('giải TÍCH 1')).toEqual({ status: 'resolved', path: '2 Areas/Giải tích 1.md' });
    expect(resolve('Giải tích 1.md')).toMatchObject({ status: 'resolved' });
    expect(resolve('Giải tích 1'.normalize('NFD'))).toEqual(resolve('Giải tích 1'));
  });

  it('prefers the same folder, then the fewest segments; a tie is ambiguous', () => {
    expect(resolve('Bài 1', '2 Areas/Lý/Tổng hợp.md')).toEqual({
      status: 'resolved',
      path: '2 Areas/Lý/Bài 1.md',
    });
    expect(resolve('Bài 2', '0 Inbox/Note.md')).toEqual({ status: 'resolved', path: 'Bài 2.md' });
    expect(resolve('Bài 2', '2 Areas/Sub/x.md')).toEqual({
      status: 'resolved',
      path: '2 Areas/Sub/Bài 2.md',
    });
    expect(resolve('Bài 1')).toEqual({
      status: 'ambiguous',
      candidates: ['1 Projects/Toán/Bài 1.md', '2 Areas/Lý/Bài 1.md'],
    });
    expect(resolve('Bài 4')).toMatchObject({ status: 'ambiguous' });
  });

  it('never finds templates by title; files by name; empty target = the note itself', () => {
    expect(resolve('Course project')).toEqual({ status: 'ghost' });
    expect(resolve('Templates/Course project')).toMatchObject({ status: 'resolved' });
    expect(resolve('BÀI GIẢNG 3.PDF')).toMatchObject({ status: 'resolved' });
    expect(resolve('sơ đồ.png', '0 Inbox/x.md', 'embed')).toEqual({
      status: 'resolved',
      path: 'Attachments/2026-10/sơ đồ.png',
    });
    expect(resolve('ảnh.png')).toMatchObject({ status: 'ambiguous' });
    expect(resolve('', '0 Inbox/Note.md')).toEqual({ status: 'resolved', path: '0 Inbox/Note.md' });
    expect(resolve('Không tồn tại')).toEqual({ status: 'ghost' });
  });
});

describe('client link resolution, path form and Markdown links (F4.2)', () => {
  it('resolves paths case-insensitively with or without .md, no title fallback', () => {
    expect(resolve('2 areas/giải tích 1.MD')).toMatchObject({ status: 'resolved' });
    expect(resolve('/2 Areas/Giải tích 1')).toMatchObject({ status: 'resolved' });
    expect(resolve('Sai/Giải tích 1')).toEqual({ status: 'ghost' });
    expect(resolve('3 Resources/papers/bài giảng 3')).toEqual({ status: 'ghost' });
  });

  it('prefers the exact spelling when paths differ only in case', () => {
    const cased = buildLinkCatalog(['a/Note.md', 'a/note.md']);
    expect(resolveLinkTarget(cased, 'a/note', 'x.md')).toEqual({
      status: 'resolved',
      path: 'a/note.md',
    });
    expect(resolveLinkTarget(cased, 'a/NOTE', 'x.md')).toMatchObject({ status: 'ambiguous' });
  });

  it('resolves Markdown links relative to the note, never above the vault root', () => {
    const md = (t: string) => resolve(t, '2 Areas/Lý/Ghi chú.md', 'markdown');
    expect(md('./bài 1')).toEqual({ status: 'resolved', path: '2 Areas/Lý/Bài 1.md' });
    expect(md('../../1 Projects/Toán/Bài 1.md')).toMatchObject({ status: 'resolved' });
    expect(md('/Bài 2.md')).toEqual({ status: 'resolved', path: 'Bài 2.md' });
    expect(md('../../../Bài 2.md')).toEqual({ status: 'ghost' });
    expect(md('Giải tích 1.md')).toEqual({ status: 'ghost' });
  });

  it('keeps đ and d apart', () => {
    const both = buildLinkCatalog(['2 Areas/Đông.md', '2 Areas/Dông.md']);
    expect(resolveLinkTarget(both, 'đông', 'x.md')).toEqual({
      status: 'resolved',
      path: '2 Areas/Đông.md',
    });
    expect(resolveLinkTarget(both, 'dông', 'x.md')).toEqual({
      status: 'resolved',
      path: '2 Areas/Dông.md',
    });
    const only = buildLinkCatalog(['2 Areas/Đông.md']);
    expect(resolveLinkTarget(only, 'Dông', 'x.md')).toEqual({ status: 'ghost' });
  });
});

describe('link targets store', () => {
  beforeEach(() => {
    clearServerEventHandlers();
    vi.unstubAllGlobals();
  });

  it('fetches targets, resolves with them and refetches once after a burst of events', async () => {
    const mock = installFetchMock();
    mock.on('GET /api/link-targets', {
      body: {
        notes: [
          {
            path: '2 Areas/Giải tích 1.md',
            title: 'Giải tích 1',
            folder: '2 Areas',
            class: 'user',
            unique: true,
          },
        ],
        files: [],
      },
    });
    await useLinkTargetsStore.getState().fetchTargets();
    const store = useLinkTargetsStore.getState();
    expect(store.titles.map((n) => n.title)).toEqual(['Giải tích 1']);
    expect(store.resolve('giải tích 1', '0 Inbox/a.md')).toMatchObject({ status: 'resolved' });
    expect(store.resolve('Đại số', '0 Inbox/a.md')).toEqual({ status: 'ghost' });

    vi.useFakeTimers();
    const stop = startLinkTargetsSync();
    emitServerEvent({ type: 'note:created', path: 'a.md', revision: 'r' });
    emitServerEvent({ type: 'note:changed', path: 'a.md', revision: 'r' });
    emitServerEvent({ type: 'note:renamed', path: 'b.md', oldPath: 'a.md', revision: 'r' });
    await vi.advanceTimersByTimeAsync(LINK_TARGETS_REFRESH_DEBOUNCE_MS + 10);
    expect(mock.callsTo('GET /api/link-targets')).toHaveLength(2);
    stop();
    vi.useRealTimers();
  });
});
