import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLinkTargetsStore } from '../../lib/link-targets-store';
import { setOpenVaultFileImplementation } from '../../lib/open-vault-file';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useTabsStore } from '../../lib/tabs-store';
import { AnswerView } from './answer-view';

const NOTE = '1 Projects/Đồ án Giải tích.md';
const PDF = '3 Resources/papers/bài báo.pdf';
const openNote = vi.fn();
const openFile = vi.fn();

function renderAnswer(markdown: string, known: string[] = [NOTE, PDF], fromPath = '') {
  render(<AnswerView markdown={markdown} known={known} fromPath={fromPath} />);
}

describe('answer links open notes and PDFs (F33.2)', () => {
  beforeEach(async () => {
    await resetAppState();
    openNote.mockReset();
    openFile.mockReset();
    useTabsStore.setState({ openNote });
    setOpenVaultFileImplementation(openFile);
  });
  afterEach(() => setOpenVaultFileImplementation(null));

  it('a click opens the note in the current tab; Ctrl+click and middle click in a new one', async () => {
    renderAnswer('Xem [[1 Projects/Đồ án Giải tích|Đồ án Giải tích]].');
    const link = screen.getByRole('link', { name: 'Đồ án Giải tích' });
    expect(link).toHaveAttribute('href', `#/note?path=${encodeURIComponent(NOTE)}`);
    await userEvent.setup().click(link);
    expect(openNote).toHaveBeenLastCalledWith(NOTE, { newTab: false });
    fireEvent.click(link, { ctrlKey: true });
    expect(openNote).toHaveBeenLastCalledWith(NOTE, { newTab: true });
    fireEvent(link, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
    expect(openNote).toHaveBeenCalledTimes(3);
    expect(openNote).toHaveBeenLastCalledWith(NOTE, { newTab: true });
  });

  it('Enter opens, Ctrl+Enter opens in a new tab (keyboard)', async () => {
    renderAnswer('[[1 Projects/Đồ án Giải tích|Đồ án]]');
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Đồ án' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(openNote).toHaveBeenLastCalledWith(NOTE, { newTab: false });
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(openNote).toHaveBeenLastCalledWith(NOTE, { newTab: true });
    expect(openNote).toHaveBeenCalledTimes(2);
  });

  it('a PDF link opens the viewer at the page named after it', async () => {
    renderAnswer('Theo [[bài báo.pdf]] (tr. 4), kết quả tốt.');
    await userEvent.setup().click(screen.getByRole('link', { name: 'bài báo.pdf' }));
    expect(openFile).toHaveBeenCalledWith(PDF, { newTab: false, page: 4 });
    expect(openNote).not.toHaveBeenCalled();
  });

  it('a title-only link resolves from the note; unknown targets stay plain text', async () => {
    useLinkTargetsStore.getState().setTargets(
      [
        {
          path: '2 Areas/Xác suất.md',
          title: 'Xác suất',
          folder: '2 Areas',
          class: 'user',
          unique: true,
        },
      ],
      [],
    );
    renderAnswer('[[Đồ án Giải tích]], [[Xác suất]] và [[Không có]].', [NOTE], NOTE);
    expect(screen.getByRole('link', { name: 'Đồ án Giải tích' })).toBeInTheDocument();
    // Not in the answer's own set but in the vault: still a working link.
    expect(screen.getByRole('link', { name: 'Xác suất' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Không có' })).toBeNull();
    expect(screen.getByText(/và Không có\./)).toBeInTheDocument();
  });
});
