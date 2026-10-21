import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { cssRule, readWebSource } from '../../lib/testing/read-source-file';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useTreeStore } from '../../lib/tree-store';
import { readyStatus, setAiStatus } from '../ai-actions/ai-actions-test-kit';
import { closeDraftDatabase } from '../drafts/draft-database';
import { renderNoteScreen } from '../note/note-screen-test-kit';
import { resetNoteSessions } from '../note-session/session-registry';
import {
  freshDraftDatabase,
  installFakeNoteServer,
  useSessionFakeTimers,
} from '../note-session/session-test-kit';
import {
  item,
  renderApp,
  setupSidebarTest,
  teardownSidebarTest,
} from '../sidebar/sidebar-tree-test-kit';
import { inboxTreeMenuItems, NoteInboxAction } from './inbox-entry-points';
import { firstLine, isDirectlyInInbox } from './inbox-notes';
import { resetInboxTidy, useInboxTidy } from './inbox-tidy-store';

const t = i18n.t.bind(i18n);
const labels = (row: Parameters<typeof inboxTreeMenuItems>[0]) =>
  inboxTreeMenuItems(row, t).map((entry) => [entry.label, entry.disabledReason ?? null]);

describe('where Inbox tidying starts (R1)', () => {
  beforeEach(async () => {
    await resetAppState('vault-a');
    resetInboxTidy();
  });
  afterEach(teardownSidebarTest);

  it('tree menu: a quiet entry on Inbox notes and the Inbox folder, only once AI is known', () => {
    const note = { kind: 'note' as const, path: '0 Inbox/Ý tưởng.md' };
    const inbox = { kind: 'folder' as const, path: '0 Inbox' };
    expect(labels(note)).toEqual([]);
    setAiStatus(readyStatus());
    expect(labels(note)).toEqual([['Gợi ý chỗ để', null]]);
    expect(labels(inbox)).toEqual([['Dọn Inbox với AI', null]]);
    expect(labels({ kind: 'note', path: '0 Inbox/cũ/Ý tưởng.md' })).toEqual([]);
    expect(labels({ kind: 'note', path: '1 Projects/Ý tưởng.md' })).toEqual([]);
    setAiStatus(readyStatus({ ready: false, reason: 'no-key' }));
    expect(labels(note)).toEqual([['Gợi ý chỗ để', 'Thêm khóa API trong Cài đặt để dùng AI']]);
    setAiStatus(readyStatus({ ready: false, reason: 'no-consent' }));
    expect(labels(inbox)).toEqual([
      ['Dọn Inbox với AI', 'Bạn vừa đổi nhà cung cấp AI. Mở Cài đặt, mục AI, bấm Xem và đồng ý.'],
    ]);
    setAiStatus(readyStatus({ scope: ['1 Projects'] }));
    expect(labels(inbox)).toEqual([
      ['Dọn Inbox với AI', 'Ghi chú này nằm ngoài thư mục AI được đọc'],
    ]);
    setAiStatus(readyStatus());
    inboxTreeMenuItems(note, t)[0]?.onSelect();
    expect(useInboxTidy.getState().mode).toEqual({ kind: 'one', path: '0 Inbox/Ý tưởng.md' });
    inboxTreeMenuItems(inbox, t)[0]?.onSelect();
    expect(useInboxTidy.getState().mode).toEqual({ kind: 'all' });
  });

  it('the sidebar context menu of an Inbox note offers it by keyboard', async () => {
    await setupSidebarTest();
    useTreeStore.setState({ expanded: ['0 Inbox'] });
    setAiStatus(readyStatus());
    const user = userEvent.setup();
    renderApp();
    act(() => item('Ý tưởng').focus());
    await user.keyboard('{ContextMenu}');
    const entry = within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Gợi ý chỗ để' });
    await user.keyboard('{End}{Enter}');
    expect(entry).not.toBeInTheDocument();
    expect(useInboxTidy.getState().mode).toEqual({ kind: 'one', path: '0 Inbox/Ý tưởng.md' });
  });

  it('note header: "Gợi ý chỗ để" saves pending typing first, then opens; disabled says why', async () => {
    const beforeOpen = vi.fn(async () => true);
    const { rerender } = render(
      <NoteInboxAction path="0 Inbox/Ý tưởng.md" beforeOpen={beforeOpen} />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    act(() => setAiStatus(readyStatus()));
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý chỗ để' }));
    await act(async () => undefined);
    expect(beforeOpen).toHaveBeenCalledTimes(1);
    expect(useInboxTidy.getState().mode).toEqual({ kind: 'one', path: '0 Inbox/Ý tưởng.md' });
    resetInboxTidy();
    act(() => setAiStatus(readyStatus({ ready: false, reason: 'disabled' })));
    const button = screen.getByRole('button', { name: 'Gợi ý chỗ để' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('Bật AI trong Cài đặt để dùng');
    fireEvent.click(button);
    await act(async () => undefined);
    expect(useInboxTidy.getState().mode).toBeNull();
    rerender(<NoteInboxAction path="1 Projects/Ý tưởng.md" beforeOpen={beforeOpen} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('note screen: "Gợi ý chỗ để" sits under the title, so a long title keeps its row', async () => {
    const path = '0 Inbox/Hỏi thầy Hùng về lịch thi giữa kỳ Giải tích và bài tập lớn.md';
    await freshDraftDatabase();
    useSessionFakeTimers();
    installFakeNoteServer(path, 'Hỏi thầy Hùng về lịch thi.\n');
    try {
      await renderNoteScreen(`path=${encodeURIComponent(path)}`);
      act(() => setAiStatus(readyStatus()));
      const action = screen.getByRole('button', { name: 'Gợi ý chỗ để' });
      const header = document.querySelector('.note-screen__header') as HTMLElement;
      expect(header).not.toContainElement(action);
      expect(
        header.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // jsdom has no layout: the CSS contract says the rest (ellipsis, the action at the start).
      const noteCss = await readWebSource('features/note/note-screen.css');
      expect(cssRule(noteCss, '.note-title__input')).toMatch(/text-overflow:\s*ellipsis/);
      const inboxCss = await readWebSource('features/ai-inbox/ai-inbox.css');
      expect(cssRule(inboxCss, '.ai-inbox-action')).toMatch(/justify-self:\s*start/);
    } finally {
      resetNoteSessions();
      vi.useRealTimers();
      await closeDraftDatabase();
    }
  });

  it('Inbox rules: directly in the folder only; the first line skips front matter and the title', () => {
    expect(isDirectlyInInbox('0 inbox/a.md')).toBe(true);
    expect(isDirectlyInInbox('0 Inbox/sub/a.md')).toBe(false);
    expect(isDirectlyInInbox('0 Inbox/a.pdf')).toBe(false);
    expect(firstLine('---\ntype: note\n---\n# Bài 1\n\n- [ ] Đọc chương 3\n', 'Bài 1')).toBe(
      'Đọc chương 3',
    );
    expect(firstLine('﻿\n\n> trích dẫn\n')).toBe('trích dẫn');
    expect(firstLine('---\n---\n')).toBe('');
  });
});
