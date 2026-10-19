import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { closeDraftDatabase } from '../drafts/draft-database';
import { indexedDbDrafts } from '../drafts/draft-store';
import { resetNoteSessions } from '../note-session/session-registry';
import {
  freshDraftDatabase,
  installFakeNoteServer,
  useSessionFakeTimers,
  type FakeNoteServer,
} from '../note-session/session-test-kit';
import { editorStub, renderNoteScreen, resetEditorStub, settleUi } from './note-screen-test-kit';

vi.mock('../../editor/markdown-editor', async () => ({
  MarkdownEditor: (await import('./markdown-editor-stub')).StubMarkdownEditor,
}));

const PATH = '0 Inbox/Ghi chú nhanh.md';
const CONTENT = '---\ntags: [đồ-án]\n---\n# Ghi chú nhanh\n';
const SEARCH = `path=${encodeURIComponent(PATH)}`;

describe('note screen banners (F3.5)', () => {
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

  it('shows a restored draft with "Bỏ bản nháp", which asks first and then goes back to the disk', async () => {
    await indexedDbDrafts.write({
      vaultId: 'vault-a',
      windowId: 'window-earlier',
      path: PATH,
      baseRevision: server.revision ?? '',
      text: `${CONTENT}\nViết dở.\n`,
      ts: 1,
    });
    await renderNoteScreen(SEARCH);
    expect(screen.getByText('Đã khôi phục bản nháp chưa lưu.')).toBeInTheDocument();
    expect(editorStub.props?.initialDoc.textContent).toContain('Viết dở.');
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ bản nháp' }));
    await settleUi();
    const dialog = screen.getByRole('alertdialog', { name: 'Bỏ bản nháp đã khôi phục?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bỏ bản nháp' }));
    await settleUi();
    expect(screen.queryByText('Đã khôi phục bản nháp chưa lưu.')).toBeNull();
    expect(editorStub.handle.replaceDoc.mock.calls.at(-1)?.[0].textContent).not.toContain(
      'Viết dở.',
    );
    await settleUi(2000);
    expect(server.mock.callsTo('PUT /api/note')).toHaveLength(0);
    expect(await indexedDbDrafts.read('vault-a', PATH)).toBeNull();
  });

  it('a note that is not UTF-8 is read-only, with the banner and the properties disabled', async () => {
    server.utf8 = false;
    await renderNoteScreen(SEARCH);
    expect(screen.getByText('Ghi chú này không phải UTF-8 nên chỉ xem được.')).toBeInTheDocument();
    expect(editorStub.props?.editable).toBe(false);
    expect(screen.getByRole('button', { name: /Thẻ/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Thêm thuộc tính' })).toBeNull();
  });

  it('marks wiki pages as maintained by the AI', async () => {
    server.noteClass = 'wiki';
    await renderNoteScreen(SEARCH);
    expect(screen.getByText('AI duy trì trang này.')).toBeInTheDocument();
  });

  it('warns on control documents', async () => {
    server.noteClass = 'control';
    await renderNoteScreen(SEARCH);
    expect(screen.getByText(/tài liệu hướng dẫn AI/)).toBeInTheDocument();
  });
});
