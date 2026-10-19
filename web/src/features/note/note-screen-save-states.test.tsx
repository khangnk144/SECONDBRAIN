import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useToastStore } from '../../lib/toast-store';
import { closeDraftDatabase } from '../drafts/draft-database';
import { indexedDbDrafts, listKeptVersions } from '../drafts/draft-store';
import { resetNoteSessions } from '../note-session/session-registry';
import {
  freshDraftDatabase,
  installFakeNoteServer,
  useSessionFakeTimers,
  type FakeNoteServer,
} from '../note-session/session-test-kit';
import {
  editorStub,
  renderNoteScreen,
  resetEditorStub,
  settleUi,
  typeInEditor,
} from './note-screen-test-kit';

vi.mock('../../editor/markdown-editor', async () => ({
  MarkdownEditor: (await import('./markdown-editor-stub')).StubMarkdownEditor,
}));

const PATH = '1 Projects/Đồ án Giải tích.md';
const CONTENT = '# Đồ án Giải tích\n\nThân bài.\n';
const ELSEWHERE = '# Đồ án Giải tích\n\nSửa ở cửa sổ khác.\n';
const SEARCH = `path=${encodeURIComponent(PATH)}`;

const indicator = () => document.querySelector('.save-indicator__state')?.textContent ?? '';

describe('note screen save indicator (F20.1, F3.4)', () => {
  let server: FakeNoteServer;

  beforeEach(async () => {
    await resetAppState('vault-a');
    await freshDraftDatabase();
    useSessionFakeTimers();
    resetEditorStub();
    server = installFakeNoteServer(PATH, CONTENT);
  });
  afterEach(async () => {
    resetNoteSessions();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await closeDraftDatabase();
  });

  it('shows the draft, then saving, then saved only once the server confirmed', async () => {
    await renderNoteScreen(SEARCH);
    expect(screen.getByRole('textbox', { name: /Tiêu đề ghi chú/ })).toHaveValue('Đồ án Giải tích');
    expect(document.querySelector('.save-indicator')).toHaveAttribute('data-status', 'clean');
    expect(document.querySelector('.save-indicator__state')).toHaveAttribute('aria-live', 'polite');
    typeInEditor('Mới ');
    expect(indicator()).toBe('Bản nháp');
    const release = server.hold();
    await settleUi(500);
    expect(indicator()).toBe('Đang lưu…');
    release();
    await settleUi();
    expect(indicator()).toBe('Đã lưu');
    expect(server.content).toBe(CONTENT.replace('# Đồ', '# Mới Đồ'));
  });

  it('shows the error with "Thử lại" while the server is down; the draft stays; retry saves', async () => {
    await renderNoteScreen(SEARCH);
    server.offline = true;
    typeInEditor('Xa ');
    await settleUi(500);
    expect(indicator()).toBe('Lỗi lưu');
    expect(screen.getByText(/Chưa kết nối được với máy chủ/)).toBeInTheDocument();
    expect((await indexedDbDrafts.read('vault-a', PATH))?.text).toContain('Xa Đồ án');
    server.offline = false;
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await settleUi();
    expect(indicator()).toBe('Đã lưu');
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
  });

  it('shows the conflict with three versions and three actions; keep mine sends conflictCopy (F3.6)', async () => {
    await renderNoteScreen(SEARCH);
    server.writeElsewhere(ELSEWHERE);
    const diskRevision = server.revision;
    typeInEditor('Của tôi ');
    await settleUi(500);
    expect(indicator()).toBe('Xung đột');
    const region = screen.getByRole('region', { name: 'Ghi chú này vừa được sửa ở chỗ khác' });
    expect(editorStub.props?.editable).toBe(false);
    const tabs = within(region)
      .getAllByRole('tab')
      .map((tab) => tab.textContent);
    expect(tabs).toEqual(['Bản gốc', 'Bản trên đĩa', 'Bản của bạn']);
    fireEvent.click(within(region).getByRole('tab', { name: 'Bản gốc' }));
    expect(within(region).getByRole('tabpanel')).toHaveTextContent('Thân bài.');
    fireEvent.click(within(region).getByRole('tab', { name: 'Bản trên đĩa' }));
    expect(within(region).getByRole('tabpanel')).toHaveTextContent('Sửa ở cửa sổ khác.');

    fireEvent.click(within(region).getByRole('button', { name: 'So sánh' }));
    const diff = within(region).getByRole('region', { name: /So sánh bản trên đĩa/ });
    const added = diff.querySelector('[data-kind="added"]');
    expect(added).toHaveTextContent('+Chỉ có ở bản của bạn:# Của tôi Đồ án Giải tích');
    expect(diff.querySelector('[data-kind="removed"]')).toHaveTextContent('−');

    fireEvent.click(within(region).getByRole('button', { name: 'Giữ bản của tôi' }));
    await settleUi();
    expect(server.mock.callsTo('PUT /api/note').at(-1)?.body).toEqual({
      path: PATH,
      content: CONTENT.replace('# Đồ', '# Của tôi Đồ'),
      expectedRevision: diskRevision,
      conflictCopy: true,
    });
    expect(indicator()).toBe('Đã lưu');
    expect(screen.queryByRole('region', { name: /vừa được sửa ở chỗ khác/ })).toBeNull();
    expect(editorStub.props?.editable).toBe(true);
  });

  it('"Tải lại" sets mine aside, then puts the disk version into the editor', async () => {
    await renderNoteScreen(SEARCH);
    server.writeElsewhere(ELSEWHERE);
    typeInEditor('Của tôi ');
    await settleUi(500);
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại' }));
    await settleUi();
    expect((await listKeptVersions('vault-a', PATH)).map((v) => v.text)).toEqual([
      CONTENT.replace('# Đồ', '# Của tôi Đồ'),
    ]);
    const replaced = editorStub.handle.replaceDoc.mock.calls.at(-1)?.[0];
    expect(replaced?.textContent).toContain('Sửa ở cửa sổ khác.');
    expect(indicator()).toBe('');
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toContain(
      'Đã tải lại bản trên đĩa. Bản của bạn được cất trong bản nháp của trình duyệt.',
    );
  });

  it('offers the set-aside version again: "Xem" opens the comparison, restoring it keeps mine', async () => {
    await renderNoteScreen(SEARCH);
    server.writeElsewhere(ELSEWHERE);
    typeInEditor('Của tôi ');
    await settleUi(500);
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại' }));
    await settleUi();
    expect(screen.getByText('Có 1 bản đã cất khi tải lại.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xem' }));
    await settleUi();
    const region = screen.getByRole('region', { name: 'Bản đã cất khi tải lại' });
    expect(within(region).getByRole('button', { name: 'So sánh' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(region.querySelector('[data-kind="added"]')).toHaveTextContent('Của tôi');
    const diskRevision = server.revision;
    fireEvent.click(within(region).getByRole('button', { name: 'Khôi phục bản này' }));
    await settleUi();
    expect(server.mock.callsTo('PUT /api/note').at(-1)?.body).toMatchObject({
      content: CONTENT.replace('# Đồ', '# Của tôi Đồ'),
      expectedRevision: diskRevision,
      conflictCopy: true,
    });
    expect(screen.queryByText(/bản đã cất khi tải lại/)).toBeNull();
  });
});
