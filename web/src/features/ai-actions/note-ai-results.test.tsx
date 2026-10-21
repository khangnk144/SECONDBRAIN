import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installRangeLayoutShim } from '../../editor/__tests__/jsdom-layout';
import type { LinkTargetNote } from '../../lib/api/link-targets-types';
import { useLinkTargetsStore } from '../../lib/link-targets-store';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useToastStore } from '../../lib/toast-store';
import { closeDraftDatabase } from '../drafts/draft-database';
import { renderNoteScreen, settleUi } from '../note/note-screen-test-kit';
import { resetNoteSessions } from '../note-session/session-registry';
import {
  freshDraftDatabase,
  installFakeNoteServer,
  useSessionFakeTimers,
  type FakeNoteServer,
} from '../note-session/session-test-kit';
import { chooseAction, realEditor, selectText, undoInEditor } from './__tests__/note-ai-test-kit';
import { readyStatus, setAiStatus } from './ai-actions-test-kit';

const runAiAction = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api/ai-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/ai-api')>()),
  runAiAction,
}));

const PATH = '1 Projects/Đồ án Giải tích.md';
const CRLF = [
  '---',
  'type: project   # giữ nguyên',
  '---',
  '# Đồ án Giải tích',
  '',
  'Dùng phương pháp Newton để tìm nghiệm gần đúng.',
  '',
  '- [ ] Nộp bản nháp 📅 2026-11-01',
  '',
  '$$x^2$$',
  '',
  'Cuối _bài_.',
  '',
].join('\r\n');
const TAGGED = '---\ntype: project\ntags: [đồ-án]\n---\n# Đồ án\n\nNewton và tiếp tuyến.\n';

function note(path: string, unique: boolean): LinkTargetNote {
  const title = path.slice(path.lastIndexOf('/') + 1, -3);
  return { path, title, folder: path.split('/')[0]!, class: 'user', unique };
}

describe('AI results go into the note only on her click (R1)', () => {
  let server: FakeNoteServer;

  beforeAll(installRangeLayoutShim);
  beforeEach(async () => {
    await resetAppState('vault-a');
    await freshDraftDatabase();
    useSessionFakeTimers();
    runAiAction.mockReset();
    setAiStatus(readyStatus());
  });
  afterEach(async () => {
    resetNoteSessions();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await closeDraftDatabase();
  });

  async function open(content: string) {
    server = installFakeNoteServer(PATH, content);
    await renderNoteScreen(`path=${encodeURIComponent(PATH)}`);
  }

  it('summary: inserted as a labelled quote below the block; only that changes; Ctrl+Z restores', async () => {
    await open(CRLF);
    runAiAction.mockResolvedValue({ action: 'summarize', text: 'Tìm nghiệm bằng tiếp tuyến.' });
    selectText('phương pháp', 'nghiệm');
    chooseAction('Tóm tắt');
    await settleUi(3000);
    const dialog = screen.getByRole('dialog', { name: 'Tóm tắt' });
    expect(within(dialog).getByText('AI đề xuất')).toBeInTheDocument();
    expect(within(dialog).getByText('Tìm nghiệm bằng tiếp tuyến.')).toBeInTheDocument();
    // Nothing is written while she reads.
    expect(server.mock.callsTo('PUT /api/note')).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Chèn bên dưới' }));
    await settleUi(600);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(server.content).toBe(
      CRLF.replace(
        'gần đúng.\r\n\r\n',
        'gần đúng.\r\n\r\n> **Tóm tắt (AI):** Tìm nghiệm bằng tiếp tuyến.\r\n\r\n',
      ),
    );
    expect(undoInEditor()).toBe(true);
    await settleUi(600);
    expect(server.content).toBe(CRLF);
  });

  it('rewrite: a word diff, then "Thay đoạn đã chọn" replaces only the selected words', async () => {
    await open(CRLF);
    runAiAction.mockResolvedValue({
      action: 'improve',
      text: 'Dùng phương pháp Newton nhằm tìm nghiệm xấp xỉ.',
    });
    selectText('Dùng', 'gần đúng.');
    chooseAction('Viết lại cho rõ hơn');
    await settleUi();
    const diff = screen.getByLabelText('Chỗ khác so với đoạn đã chọn');
    expect(
      within(diff)
        .getAllByRole('deletion')
        .map((d) => d.textContent),
    ).toEqual(['bỏ: để ', 'bỏ: gần đúng.']);
    expect(
      within(diff)
        .getAllByRole('insertion')
        .map((d) => d.textContent),
    ).toEqual(['thêm: nhằm ', 'thêm: xấp xỉ.']);
    fireEvent.click(screen.getByRole('button', { name: 'Thay đoạn đã chọn' }));
    await settleUi(600);
    expect(server.content).toBe(CRLF.replace('để tìm nghiệm gần đúng.', 'nhằm tìm nghiệm xấp xỉ.'));
    expect(undoInEditor()).toBe(true);
    await settleUi(600);
    expect(server.content).toBe(CRLF);
  });

  it('a rewrite is not put over text she changed meanwhile', async () => {
    await open(CRLF);
    runAiAction.mockResolvedValue({ action: 'improve', text: 'Câu mới.' });
    selectText('Dùng', 'gần đúng.');
    chooseAction('Viết lại cho rõ hơn');
    await settleUi();
    const editor = realEditor();
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText('X', editor.state.selection.from + 2));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Thay đoạn đã chọn' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Đoạn đã chọn vừa thay đổi.');
    await settleUi(600);
    expect(server.content).not.toContain('Câu mới.');
  });

  it('links: checked notes become a "Liên quan:" paragraph, path form when a title is not unique', async () => {
    await open(CRLF);
    useLinkTargetsStore
      .getState()
      .setTargets(
        [
          note('2 Areas/Giải tích 1.md', true),
          note('2 Areas/Toán/Bài 1.md', false),
          note('2 Areas/Lý/Bài 1.md', false),
          note('1 Projects/Khác.md', true),
        ],
        [],
      );
    runAiAction.mockResolvedValue({
      links: [
        { path: '2 Areas/Giải tích 1.md', title: 'Giải tích 1', reason: 'Cùng môn học.' },
        { path: '2 Areas/Toán/Bài 1.md', title: 'Bài 1', reason: 'Có ví dụ Newton.' },
        { path: '1 Projects/Khác.md', title: 'Khác', reason: 'Ít liên quan.' },
      ],
    });
    selectText('Newton');
    chooseAction('Gợi ý liên kết');
    await settleUi();
    expect(runAiAction.mock.calls[0]?.[0]).toEqual({
      action: 'suggest-links',
      text: 'Newton',
      path: PATH,
    });
    const list = screen.getByRole('list', { name: 'Ghi chú nên liên kết' });
    expect(within(list).getByText('2 Areas/Toán')).toBeInTheDocument();
    expect(within(list).getByText('Cùng môn học.')).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('checkbox', { name: /Khác/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm liên kết' }));
    await settleUi(600);
    expect(server.content).toBe(
      CRLF.replace(
        'gần đúng.\r\n\r\n',
        'gần đúng.\r\n\r\nLiên quan: [[Giải tích 1]], [[2 Areas/Toán/Bài 1]]\r\n\r\n',
      ),
    );
  });

  it('tags: new ones are marked "mới"; added through a front-matter patch, never twice', async () => {
    await open(TAGGED);
    runAiAction.mockResolvedValue({
      tags: [
        { tag: 'Đồ-Án', existing: true },
        { tag: 'giải-tích', existing: true },
        { tag: 'newton', existing: false },
      ],
    });
    selectText('Newton');
    chooseAction('Gợi ý thẻ');
    await settleUi();
    const list = screen.getByRole('list', { name: 'Thẻ gợi ý' });
    expect(within(list).getAllByText('mới')).toHaveLength(1);
    expect(within(list).getByRole('checkbox', { name: '#newton mới' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm thẻ' }));
    await settleUi();
    const patches = server.mock.callsTo('PATCH /api/note/frontmatter');
    expect(patches).toHaveLength(1);
    expect(patches[0]?.body).toMatchObject({
      path: PATH,
      set: { tags: ['đồ-án', 'giải-tích', 'newton'] },
    });
    expect(server.content).toContain('tags: [đồ-án, giải-tích, newton]');
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toContain(
      'Đã thêm 2 thẻ.',
    );
    // Asking again with tags she already has writes nothing.
    runAiAction.mockResolvedValue({ tags: [{ tag: 'newton', existing: true }] });
    selectText('Newton');
    chooseAction('Gợi ý thẻ');
    await settleUi();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm thẻ' }));
    await settleUi();
    expect(screen.getByRole('alert')).toHaveTextContent('Ghi chú đã có các thẻ này.');
    expect(server.mock.callsTo('PATCH /api/note/frontmatter')).toHaveLength(1);
  });

  it('empty proposals say so and change nothing', async () => {
    await open(CRLF);
    runAiAction.mockResolvedValue({ links: [] });
    selectText('Newton');
    chooseAction('Gợi ý liên kết');
    await settleUi();
    expect(screen.getByText('AI không thấy ghi chú nào nên liên kết tới.')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Đóng' }).at(-1)!);
    await settleUi(1000);
    expect(server.mock.callsTo('PUT /api/note')).toHaveLength(0);
  });
});
