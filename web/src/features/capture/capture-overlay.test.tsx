import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { appRoutes } from '../../app/routes';
import { installRangeLayoutShim } from '../../editor/__tests__/jsdom-layout';
import type { Navigator } from '../../lib/app-navigation';
import { MAX_CAPTURE_LENGTH } from '../../lib/capture-flow';
import { useCaptureUi } from '../../lib/capture-ui-store';
import { useAppShortcuts } from '../../lib/shortcuts/use-app-shortcuts';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { ToastHost } from '../toasts/toast-host';
import { CaptureOverlay } from './capture-overlay';

const SAVED = 'Đã lưu vào Inbox.';

function Harness() {
  useAppShortcuts();
  return (
    <>
      <button type="button">Hôm nay</button>
      <div data-testid="editor-host" />
      <CaptureOverlay />
      <ToastHost />
    </>
  );
}

const captureBox = () => screen.getByRole('dialog', { name: 'Ghi nhanh vào Inbox' });
const captureField = () => within(captureBox()).getByRole('textbox', { name: 'Ghi nhanh' });

describe('quick capture overlay (F12.1)', () => {
  let mock: FetchMock;
  let navigate: ReturnType<typeof vi.fn<Navigator>>;
  beforeAll(installRangeLayoutShim);

  beforeEach(async () => {
    navigate = (await resetAppState()) as ReturnType<typeof vi.fn<Navigator>>;
    mock = installFetchMock();
    mock.on('POST /api/capture', {
      status: 201,
      body: { path: '0 Inbox/Ý tưởng.md', revision: 'r1' },
    });
    mock.on('GET /api/tree', {
      body: {
        root: { path: '', name: '', noteCount: 0, urgent: false, folders: [], files: [] },
        inboxCount: 1,
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('from a button: Alt+Q, type, Enter saves to Inbox, focus returns, toast offers "Mở"', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const button = screen.getByRole('button', { name: 'Hôm nay' });
    button.focus();
    await user.keyboard('{Alt>}q{/Alt}');
    expect(captureField()).toHaveFocus();
    expect(captureField()).toHaveAttribute('placeholder', 'Gõ gì đó, Enter để lưu vào Inbox');
    await user.keyboard('Ý tưởng: ôn chương 3{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mock.callsTo('POST /api/capture')[0]?.body).toEqual({ text: 'Ý tưởng: ôn chương 3' });
    expect(button).toHaveFocus();
    expect(await screen.findByText(SAVED)).toBeInTheDocument();
    // The Inbox count comes from the tree, which is fetched again (F12.3).
    await waitFor(() => expect(mock.callsTo('GET /api/tree')).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Mở' }));
    expect(navigate).toHaveBeenLastCalledWith(
      `/note?path=${encodeURIComponent('0 Inbox/Ý tưởng.md')}`,
      undefined,
    );
  });

  it('from the editor: focus goes back to it and its caret has not moved', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const editor = new Editor({
      element: screen.getByTestId('editor-host'),
      extensions: [StarterKit],
      content: '<p>Giải tích 1</p>',
    });
    try {
      act(() => {
        editor.commands.setTextSelection(5);
        editor.view.dom.focus();
      });
      expect(editor.view.dom).toHaveFocus();
      await user.keyboard('{Alt>}q{/Alt}');
      expect(useCaptureUi.getState().returnFocus).toBe(editor.view.dom);
      await user.keyboard('việc cần làm{Enter}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      // ProseMirror puts the DOM caret back from its state when it regains focus.
      expect(editor.view.dom).toHaveFocus();
      expect(editor.state.selection.from).toBe(5);
      expect(editor.getText()).toBe('Giải tích 1');
      expect(mock.callsTo('POST /api/capture')).toHaveLength(1);
    } finally {
      editor.destroy();
    }
  });

  it('Shift+Enter adds a line; Esc cancels without saving and restores focus', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const button = screen.getByRole('button', { name: 'Hôm nay' });
    button.focus();
    await user.keyboard('{Alt>}q{/Alt}dòng 1{Shift>}{Enter}{/Shift}dòng 2');
    expect(captureField()).toHaveValue('dòng 1\ndòng 2');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();
    expect(mock.callsTo('POST /api/capture')).toHaveLength(0);
  });

  it('suspends app shortcuts while open; an empty Enter saves nothing', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('{Alt>}q{/Alt}');
    await user.keyboard('{Alt>}g{/Alt}{Enter}');
    expect(navigate).not.toHaveBeenCalled();
    expect(captureBox()).toBeInTheDocument();
    expect(within(captureBox()).getByRole('button', { name: 'Lưu vào Inbox' })).toBeDisabled();
    expect(mock.callsTo('POST /api/capture')).toHaveLength(0);
  });

  it('a failed save keeps the text, says what to do, and Enter tries again', async () => {
    mock.on('POST /api/capture', apiError(500, 'WRITE_FAILED'));
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('{Alt>}q{/Alt}nhớ mua sách{Enter}');
    const alert = await within(captureBox()).findByRole('alert');
    expect(alert).toHaveTextContent('Chưa lưu được vào Inbox. Chữ bạn gõ vẫn còn đây');
    expect(captureField()).toHaveValue('nhớ mua sách');
    expect(captureField()).toHaveFocus();
    mock.on('POST /api/capture', { status: 201, body: { path: '0 Inbox/nhớ.md', revision: 'r' } });
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mock.callsTo('POST /api/capture')).toHaveLength(2);
  });

  it('refuses text over the limit before sending it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('{Alt>}q{/Alt}');
    fireEvent.change(captureField(), { target: { value: 'a'.repeat(MAX_CAPTURE_LENGTH + 1) } });
    await user.keyboard('{Enter}');
    expect(within(captureBox()).getByRole('alert')).toHaveTextContent('dài quá 20000 ký tự');
    expect(mock.callsTo('POST /api/capture')).toHaveLength(0);
  });

  it('after a save a hidden copy shrinks away; with reduced motion there is none', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    await user.keyboard('{Alt>}q{/Alt}một{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const ghost = container.querySelector('.capture-box--leaving');
    expect(ghost?.closest('[aria-hidden="true"]')).not.toBeNull();
    // Gone when the animation ends (or, as here in jsdom, a little after it should have).
    await waitFor(() => expect(container.querySelector('.capture-box--leaving')).toBeNull());

    window.matchMedia = ((query: string) => ({ matches: query.includes('reduce') })) as never;
    await user.keyboard('{Alt>}q{/Alt}hai{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(container.querySelector('.capture-box--leaving')).toBeNull();
  });
});

describe('quick capture from the Today screen (F12.1)', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    await resetAppState();
    mock = installFetchMock();
    mock.on('POST /api/capture', { status: 201, body: { path: '0 Inbox/a.md', revision: 'r1' } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Alt+Q, type, Enter creates the note and focus returns to where it was', async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/'] });
    render(<RouterProvider router={router} />);
    const link = screen.getByRole('link', { name: 'Việc cần làm' });
    act(() => link.focus());
    await user.keyboard('{Alt>}q{/Alt}');
    expect(captureField()).toHaveFocus();
    await user.keyboard('gọi cho nhóm{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mock.callsTo('POST /api/capture')[0]?.body).toEqual({ text: 'gọi cho nhóm' });
    expect(link).toHaveFocus();
    expect(await screen.findByText(SAVED)).toBeInTheDocument();
  });
});
