import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkTargetNote } from '../../lib/api/link-targets-types';
import { useLinkTargetsStore } from '../../lib/link-targets-store';
import { installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useToastStore } from '../../lib/toast-store';
import { saveMarkdown } from '../markdown/markdown-document';
import { renderEditor } from '../__tests__/render-editor';
import { rankLinkCandidates } from './link-candidates';

function note(path: string, unique = true): LinkTargetNote {
  const title = path.slice(path.lastIndexOf('/') + 1, -3);
  return { path, title, folder: path.split('/')[0] ?? '', class: 'user', unique };
}

const NOTES = [
  note('2 Areas/Toán/Giải tích 1.md'),
  note('2 Areas/Toán/Đại số tuyến tính.md'),
  note('1 Projects/Đồ án Giải tích.md'),
  note('1 Projects/Toán/Bài 1.md', false),
  note('2 Areas/Lý/Bài 1.md', false),
  note('Templates/Bài giảng.md'),
];
NOTES[5] = { ...NOTES[5]!, class: 'template' };

function optionTexts() {
  const listbox = screen.getByRole('listbox', { name: 'Gợi ý ghi chú' });
  return within(listbox)
    .getAllByRole('option')
    .map((o) => o.textContent);
}

describe('[[ autocomplete (F4.1, F4.2)', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    await resetAppState();
    mock = installFetchMock();
    useLinkTargetsStore.getState().setTargets(NOTES, []);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['giai tich', 'Giải tích 1'],
    ['dai so', 'Đại số tuyến tính'],
    ['giải tích', 'Giải tích 1'],
    ['GIẢI TÍCH', 'Giải tích 1'],
    ['dstt', 'Đại số tuyến tính'],
  ])('"%s" finds %s first (diacritics ignored, NFD = NFC, fuzzy)', (query, title) => {
    expect(rankLinkCandidates(NOTES, [], query, false)[0]?.title).toBe(title);
  });

  it('templates are not offered; at most 8 candidates', () => {
    const many = Array.from({ length: 30 }, (_, i) => note(`0 Inbox/Ghi chú ${i}.md`));
    expect(rankLinkCandidates(many, [], 'ghi chu', false)).toHaveLength(8);
    expect(rankLinkCandidates(NOTES, [], 'bai giang', false)).toEqual([]);
  });

  it('opens within 100 ms of typing [[ with 5,000 titles', () => {
    const titles = Array.from({ length: 5_000 }, (_, i) =>
      note(`${i % 2 ? '2 Areas' : '1 Projects'}/Môn học số ${i} ôn tập.md`),
    );
    useLinkTargetsStore.getState().setTargets(titles, []);
    const t = renderEditor('Xem\n');
    t.caretAfter('Xem');
    t.type(' [');
    const started = performance.now();
    t.type('[');
    expect(screen.getByRole('listbox', { name: 'Gợi ý ghi chú' })).toBeInTheDocument();
    expect(performance.now() - started).toBeLessThan(100);
    expect(screen.getAllByRole('option')).toHaveLength(8);
  });

  it('shows the folder and ends with "Tạo …"; Enter inserts the title form', () => {
    const t = renderEditor('Xem\n');
    t.caretAfter('Xem');
    t.type(' [[giai tich');
    expect(optionTexts()).toEqual([
      'Giải tích 12 Areas/Toán',
      'Đồ án Giải tích1 Projects',
      "Tạo 'giai tich'",
    ]);
    t.press('Enter');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(saveMarkdown(t.editor.state.doc, t.loaded.snapshot)).toBe('Xem [[Giải tích 1]]\n');
  });

  it('a title that is not unique is inserted in the path form, with heading and alias', () => {
    const t = renderEditor('Xem\n');
    t.caretAfter('Xem');
    t.type(' [[bai 1#Đề bài|đề');
    expect(optionTexts().slice(0, 2)).toEqual(['Bài 11 Projects/Toán', 'Bài 12 Areas/Lý']);
    t.press('ArrowDown');
    t.press('Enter');
    expect(saveMarkdown(t.editor.state.doc, t.loaded.snapshot)).toBe(
      'Xem [[2 Areas/Lý/Bài 1#Đề bài|đề]]\n',
    );
  });

  it('"Tạo …" links to the new title and creates it in Inbox without leaving the note', async () => {
    mock.on('POST /api/note', (call) => ({
      body: { path: (call.body as { path: string }).path, revision: 'r1' },
    }));
    const t = renderEditor('Xem\n');
    t.caretAfter('Xem');
    t.type(' [[Phương pháp Newton');
    t.press('ArrowUp');
    t.press('Enter');
    expect(saveMarkdown(t.editor.state.doc, t.loaded.snapshot)).toBe(
      'Xem [[Phương pháp Newton]]\n',
    );
    await waitFor(() => expect(mock.callsTo('POST /api/note')).toHaveLength(1));
    expect(mock.callsTo('POST /api/note')[0]!.body).toMatchObject({
      path: '0 Inbox/Phương pháp Newton.md',
    });
    await waitFor(() =>
      expect(useToastStore.getState().toasts[0]?.message).toBe(
        'Đã tạo Phương pháp Newton trong Inbox.',
      ),
    );
    expect(useToastStore.getState().toasts[0]?.action?.label).toBe('Mở');
    await act(async () => undefined);
  });
});
