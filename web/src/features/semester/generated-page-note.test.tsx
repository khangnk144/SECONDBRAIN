import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { resetAppState } from '../../lib/testing/reset-app-state';
import type { Navigator } from '../../lib/app-navigation';
import { closeDraftDatabase } from '../drafts/draft-database';
import {
  editorStub,
  renderNoteScreen,
  resetEditorStub,
  settleUi,
} from '../note/note-screen-test-kit';
import { resetNoteSessions } from '../note-session/session-registry';
import {
  freshDraftDatabase,
  installFakeNoteServer,
  useSessionFakeTimers,
  type FakeNoteServer,
} from '../note-session/session-test-kit';
import type { SemesterPageStatus } from './semester-api';
import { resetSemesterPageStore } from './semester-page-store';
import { useTabsStore } from '../../lib/tabs-store';
import { startTabsSync } from '../../lib/tabs-sync';
import { emitServerEvent } from '../../lib/ws/server-event-bus';

vi.mock('../../editor/markdown-editor', async () => ({
  MarkdownEditor: (await import('../note/markdown-editor-stub')).StubMarkdownEditor,
}));

const PATH = 'Học kỳ này.md';
const CONTENT = '---\ntype: note\ngenerated: true\ncreated: 2026-03-02\n---\n## Môn học\n';
const SEARCH = `path=${encodeURIComponent(PATH)}`;
const status = (state: SemesterPageStatus['state'], enabled = true): SemesterPageStatus => ({
  available: true,
  enabled,
  path: PATH,
  state,
  exists: true,
  edited: state === 'edited',
  ours: state !== 'edited',
  lastGeneratedAt: '2026-03-02T09:00:00.000Z',
});

describe('the generated "Học kỳ này" page in the note screen (F25.2)', () => {
  let server: FakeNoteServer;
  let navigate: ReturnType<typeof vi.fn<Navigator>>;

  beforeEach(async () => {
    navigate = (await resetAppState('vault-a')) as ReturnType<typeof vi.fn<Navigator>>;
    resetSemesterPageStore();
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

  it('(F25.2) is read-only with the banner: editor, title, properties and source mode', async () => {
    server.mock.on('GET /api/semester-page', { body: status('ok') });
    await renderNoteScreen(SEARCH);
    await settleUi();
    expect(
      screen.getByText(
        'Trang này do app tạo tự động. Muốn đổi thì sửa các ghi chú môn học và đồ án.',
      ),
    ).toBeInTheDocument();
    // Not the "not UTF-8" notice: that one is about something else.
    expect(screen.queryByText(/không phải UTF-8/)).toBeNull();
    expect(editorStub.props?.editable).toBe(false);
    expect(screen.getByRole('textbox', { name: /Tiêu đề ghi chú/ })).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'Thêm thuộc tính' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Chế độ nguồn' }));
    await settleUi();
    expect(screen.getByRole('textbox', { name: /chế độ nguồn/ })).toHaveAttribute('readonly');

    fireEvent.click(screen.getByRole('link', { name: 'Cài đặt' }));
    expect(navigate).toHaveBeenLastCalledWith('/settings?focus=semester-page', undefined);
    await settleUi(2000);
    expect(server.mock.callsTo('PUT /api/note')).toHaveLength(0);
  });

  it('(F25.3) edited outside the app: the banner says so and "Tạo lại" asks before replacing', async () => {
    server.mock.on('GET /api/semester-page', { body: status('edited') });
    server.mock.on('POST /api/semester-page', { body: { status: status('ok') } });
    await renderNoteScreen(SEARCH);
    await settleUi();
    expect(
      screen.getByText(/đã được sửa bên ngoài app, nên app không cập nhật nó nữa/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo lại' }));
    await settleUi();
    const dialog = screen.getByRole('dialog', { name: 'Tạo lại trang Học kỳ này?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tạo lại' }));
    await settleUi();
    expect(server.mock.callsTo('POST /api/semester-page')[0]?.body).toEqual({
      action: 'regenerate',
    });
    expect(screen.getByText(/Trang này do app tạo tự động/)).toBeInTheDocument();
  });

  it('(D2) "Tạo lại" keeps the page open: the edited copy\'s deletion does not close its tab', async () => {
    server.mock.on('GET /api/semester-page', { body: status('edited') });
    server.mock.on('POST /api/semester-page', { body: { status: status('ok') } });
    const stop = startTabsSync();
    useTabsStore.getState().openNote(PATH);
    await renderNoteScreen(SEARCH);
    await settleUi();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo lại' }));
    await settleUi();
    const dialog = screen.getByRole('dialog', { name: 'Tạo lại trang Học kỳ này?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tạo lại' }));
    await settleUi();
    // The server trashed the edited copy and wrote the fresh page at the same path.
    emitServerEvent({ type: 'note:deleted', path: PATH });
    emitServerEvent({ type: 'note:created', path: PATH, revision: 'fresh' });
    await settleUi();
    expect(useTabsStore.getState().tabs.map((tab) => tab.path)).toEqual([PATH]);
    expect(navigate).not.toHaveBeenCalledWith('/', expect.anything());
    stop();
  });

  it('is an ordinary note when the page is off, and has English text', async () => {
    server.mock.on('GET /api/semester-page', { body: status('off', false) });
    await renderNoteScreen(SEARCH);
    await settleUi();
    expect(screen.queryByText(/Trang này do app tạo tự động/)).toBeNull();
    expect(editorStub.props?.editable).toBe(true);
    expect(i18n.t('semester.banner.generated', { lng: 'en' })).toBe(
      'The app makes this page by itself. To change it, edit your course and project notes.',
    );
  });
});
