import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { saveMarkdown } from '../markdown/markdown-document';
import { renderEditor } from '../__tests__/render-editor';

function options() {
  const listbox = screen.getByRole('listbox', { name: 'Chèn khối' });
  return within(listbox)
    .getAllByRole('option')
    .map((o) => o.textContent);
}

describe('slash menu (F3.3)', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    await resetAppState();
    mock = installFetchMock();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('lists the implemented blocks from the registry', () => {
    const t = renderEditor('Mở đầu.\n');
    t.newLine();
    t.type('/');
    expect(options()).toEqual([
      'Tiêu đề 1',
      'Tiêu đề 2',
      'Tiêu đề 3',
      'Danh sách việc',
      'Danh sách chấm',
      'Danh sách số',
      'Trích dẫn',
      'Code',
      'Bảng',
      'Ảnh',
      'Ngày',
      'Đường kẻ',
      'Mẫu',
    ]);
    const listbox = screen.getByRole('listbox');
    expect(t.root).toHaveAttribute('aria-controls', listbox.id);
    expect(t.root.getAttribute('aria-activedescendant')).toBe(
      within(listbox).getAllByRole('option')[0]!.id,
    );
  });

  it('does not open in the middle of a line', () => {
    const t = renderEditor('Một dòng\n');
    t.caretAfter('Một');
    t.type('/');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('arrows + Enter pick an item; the "/" text is gone', () => {
    const t = renderEditor('Mở đầu.\n');
    t.newLine();
    t.type('/');
    t.press('ArrowDown');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    t.press('Enter');
    expect(screen.queryByRole('listbox')).toBeNull();
    t.type('Phần hai');
    expect(saveMarkdown(t.editor.state.doc, t.loaded.snapshot)).toBe('Mở đầu.\n\n## Phần hai\n');
  });

  it('typing filters (diacritics ignored) and Esc closes', () => {
    const t = renderEditor('x\n');
    t.newLine();
    t.type('/bang');
    expect(options()).toEqual(['Bảng']);
    t.type('xyz');
    expect(screen.getByRole('status')).toHaveTextContent('Không có lệnh nào khớp.');
    t.press('Escape');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(t.editor.state.doc.lastChild!.textContent).toBe('/bangxyz');
  });

  it('Bảng inserts a 3 × 2 table with a header row; mouse works too', () => {
    const t = renderEditor('x\n');
    t.newLine();
    t.type('/');
    fireEvent.click(screen.getByRole('option', { name: 'Bảng' }));
    const table = t.editor.state.doc.child(1);
    expect(table.type.name).toBe('table');
    expect(table.childCount).toBe(3);
    expect(table.firstChild!.childCount).toBe(2);
    expect(table.firstChild!.firstChild!.type.name).toBe('tableHeader');
  });

  it('Ngày switches to the date popup', () => {
    const t = renderEditor('x\n');
    t.newLine();
    t.type('/ngay');
    t.press('Enter');
    expect(screen.getByRole('group', { name: 'Chọn ngày' })).toBeInTheDocument();
  });

  it('Mẫu lists templates and inserts the body with variables filled, front matter dropped', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 19, 8, 5));
    mock.on('GET /api/templates', {
      body: {
        templates: [{ path: 'Templates/Bài giảng.md', title: 'Bài giảng', bundled: true }],
        missingBundled: [],
      },
    });
    mock.on('GET /api/note', {
      body: {
        path: 'Templates/Bài giảng.md',
        content:
          '---\ntype: lecture\n---\n\n# {{title}}\n\nNgày {{date}} lúc {{time}}\n\n{{cursor}}\n',
        revision: 'r',
      },
    });
    const t = renderEditor('Mở đầu.\n');
    t.newLine();
    t.type('/mau');
    t.press('Enter');
    const item = await screen.findByRole('option', { name: 'Bài giảng' });
    expect(screen.getByRole('listbox', { name: 'Chọn mẫu' })).toContainElement(item);
    t.press('Enter');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    await act(async () => undefined);
    expect(saveMarkdown(t.editor.state.doc, t.loaded.snapshot)).toBe(
      'Mở đầu.\n\n# Đồ án\n\nNgày 2026-10-19 lúc 08:05\n',
    );
  });
});
