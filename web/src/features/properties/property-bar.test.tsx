import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLinkTargetsStore } from '../../lib/link-targets-store';
import { useSearchUi } from '../../lib/search-ui-store';
import { installFetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useToastStore } from '../../lib/toast-store';
import type { FrontmatterChange } from '../note-session/note-session-types';
import { PropertyBar } from './property-bar';

const RAW = [
  '---',
  'type: project   # loại',
  'status: doing',
  'deadline: 2026-11-05',
  'course: "[[Giải tích 1]]"',
  'tags: [đồ-án, giải-tích]',
  'nguồn: sách',
  '---',
  '',
].join('\n');

function renderBar(raw: string | null, disabled = false) {
  const onPatch = vi.fn<(change: FrontmatterChange) => Promise<boolean>>(async () => true);
  render(<PropertyBar frontmatterRaw={raw} disabled={disabled} onPatch={onPatch} />);
  return onPatch;
}

const chip = (name: RegExp) => screen.getByRole('button', { name });

describe('property bar (F7.1, F7.2 UI side)', () => {
  beforeEach(async () => {
    await resetAppState('vault-a');
    installFetchMock().on('GET /api/tags', {
      body: {
        tags: [
          { tag: 'đồ-án', norm: 'do-an', count: 3 },
          { tag: 'ôn-thi', norm: 'on-thi', count: 1 },
        ],
      },
    });
  });

  it('shows one chip per key: localized label, space, value (dd/mm/yyyy in Vietnamese)', () => {
    renderBar(RAW);
    const bar = screen.getByRole('group', { name: 'Thuộc tính' });
    const mains = within(bar)
      .getAllByRole('button')
      .filter((button) => button.classList.contains('property-chip__main'))
      .map((button) => button.textContent);
    expect(mains).toEqual([
      'Loại Dự án',
      'Trạng thái Đang làm',
      'Hạn chót 05/11/2026',
      'Môn Giải tích 1',
      'Thẻ',
      'nguồn sách',
    ]);
  });

  it('picks a status in one click and patches only that key', async () => {
    const onPatch = renderBar(RAW);
    fireEvent.click(chip(/^Trạng thái/));
    const popover = screen.getByRole('dialog', { name: 'Sửa Trạng thái' });
    expect(within(popover).getByRole('button', { name: 'Đang làm' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(popover).getByRole('button', { name: 'Xong' }));
    expect(onPatch).toHaveBeenCalledWith({ set: { status: 'done' } });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(chip(/^Trạng thái/));
  });

  it('edits a date with a date field and writes ISO', () => {
    const onPatch = renderBar(RAW);
    fireEvent.click(chip(/^Hạn chót/));
    const field = screen.getByLabelText('Hạn chót');
    expect(field).toHaveAttribute('type', 'date');
    fireEvent.change(field, { target: { value: '2026-12-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(onPatch).toHaveBeenCalledWith({ set: { deadline: '2026-12-01' } });
  });

  it('picks the course from the notes, writing "[[Title]]" or the path form when not unique', () => {
    useLinkTargetsStore.getState().setTargets(
      [
        {
          path: '2 Areas/Đại số tuyến tính.md',
          title: 'Đại số tuyến tính',
          folder: '2 Areas',
          class: 'user',
          unique: true,
        },
        {
          path: '2 Areas/A/Bài 1.md',
          title: 'Bài 1',
          folder: '2 Areas/A',
          class: 'user',
          unique: false,
        },
      ],
      [],
    );
    const onPatch = renderBar(RAW);
    fireEvent.click(chip(/^Môn/));
    const field = screen.getByLabelText('Môn');
    fireEvent.change(field, { target: { value: 'dai so' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onPatch).toHaveBeenLastCalledWith({ set: { course: '[[Đại số tuyến tính]]' } });
    fireEvent.click(chip(/^Môn/));
    fireEvent.click(screen.getByRole('button', { name: /Bài 1/ }));
    expect(onPatch).toHaveBeenLastCalledWith({ set: { course: '[[2 Areas/A/Bài 1]]' } });
  });

  it('edits tags with autocomplete; tag pills open the tag search', async () => {
    const onPatch = renderBar(RAW);
    fireEvent.click(screen.getByRole('button', { name: 'Tìm ghi chú có thẻ #đồ-án' }));
    expect(useSearchUi.getState()).toMatchObject({ open: true, query: 'tag:đồ-án' });
    fireEvent.click(chip(/^Thẻ$/));
    await act(async () => undefined);
    fireEvent.change(screen.getByLabelText('Thêm thẻ'), { target: { value: 'on' } });
    fireEvent.click(screen.getByRole('button', { name: '#ôn-thi' }));
    expect(onPatch).toHaveBeenLastCalledWith({ set: { tags: ['đồ-án', 'giải-tích', 'ôn-thi'] } });
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ thẻ #giải-tích' }));
    expect(onPatch).toHaveBeenLastCalledWith({ set: { tags: ['đồ-án', 'ôn-thi'] } });
  });

  it('removes a key and offers undo for 10 s; adds a new key', async () => {
    const onPatch = renderBar(RAW);
    fireEvent.click(screen.getByRole('button', { name: 'Xóa thuộc tính nguồn' }));
    await act(async () => undefined);
    expect(onPatch).toHaveBeenCalledWith({ unset: ['nguồn'] });
    const toast = useToastStore.getState().toasts.at(-1);
    expect(toast).toMatchObject({ message: 'Đã xóa thuộc tính nguồn.', durationMs: 10_000 });
    await act(async () => toast?.action?.run());
    expect(onPatch).toHaveBeenLastCalledWith({ set: { nguồn: 'sách' } });

    fireEvent.click(screen.getByRole('button', { name: 'Thêm thuộc tính' }));
    fireEvent.change(screen.getByLabelText('Tên thuộc tính'), { target: { value: 'type' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Ghi chú đã có thuộc tính này.');
    fireEvent.change(screen.getByLabelText('Tên thuộc tính'), { target: { value: 'pages' } });
    fireEvent.change(screen.getByLabelText('Giá trị'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
    expect(onPatch).toHaveBeenLastCalledWith({ set: { pages: '12' } });
  });

  it('shows invalid YAML raw with a warning and no way to edit it (F7.2)', () => {
    const onPatch = renderBar('---\ntitle: [chưa đóng\n---\n');
    expect(screen.getByText(/đang có lỗi nên chỉ xem được/)).toBeInTheDocument();
    expect(screen.getByText(/title: \[chưa đóng/)).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(onPatch).not.toHaveBeenCalled();
  });
});
