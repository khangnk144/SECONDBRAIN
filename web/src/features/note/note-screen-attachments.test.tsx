import { act, fireEvent, screen } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dropEvent,
  file,
  filesTransfer,
  installObjectUrls,
  installUploadServer,
  type FakeObjectUrls,
} from '../../editor/attachments/attachment-test-kit';
import { resetDocumentTargetRequests } from '../../editor/attachments/document-target-store';
import { useLinkTargetsStore } from '../../lib/link-targets-store';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { resetVaultFileBlobs } from '../../lib/vault-file-blob';
import { closeDraftDatabase } from '../drafts/draft-database';
import { resetNoteSessions } from '../note-session/session-registry';
import {
  freshDraftDatabase,
  installFakeNoteServer,
  useSessionFakeTimers,
  type FakeNoteServer,
} from '../note-session/session-test-kit';
import { renderNoteScreen, settleUi } from './note-screen-test-kit';

const PATH = '2 Areas/Giải tích 1/Bài giảng 3.md';
const CONTENT = [
  '---',
  'type: lecture   # loại ghi chú',
  'course: "[[Giải tích 1]]"',
  '---',
  '# Bài giảng 3',
  '',
  'Sơ đồ: ![[sơ đồ.png]] và ![](../../Attachments/2026-10/bảng.svg)',
  '',
  '- [ ] Ôn _định lý_ 📅 2026-11-01',
  '',
].join('\r\n');

function realEditor(): Editor {
  const root = screen.getByRole('textbox', { name: /Nội dung ghi chú/ }) as HTMLElement & {
    editor?: Editor;
  };
  if (!root.editor) throw new Error('no Tiptap editor on the root');
  return root.editor;
}

describe('attachments on the note screen (F15.1, F15.2)', () => {
  let server: FakeNoteServer;
  let urls: FakeObjectUrls;

  beforeEach(async () => {
    await resetAppState('vault-a');
    resetVaultFileBlobs();
    await freshDraftDatabase();
    useSessionFakeTimers();
    server = installFakeNoteServer(PATH, CONTENT);
    server.mock.on('GET /api/files', { body: {} });
    installUploadServer(server.mock);
    urls = installObjectUrls();
    useLinkTargetsStore.getState().setTargets(
      [],
      ['Attachments/2026-10/sơ đồ.png', 'Attachments/2026-10/bảng.svg'].map((path) => ({
        path,
        name: path.slice(path.lastIndexOf('/') + 1),
      })),
    );
  });
  afterEach(async () => {
    resetDocumentTargetRequests();
    resetNoteSessions();
    resetVaultFileBlobs();
    urls.restore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await closeDraftDatabase();
  });

  it('shows the note images and writes nothing (P1)', async () => {
    await renderNoteScreen(`path=${encodeURIComponent(PATH)}`);
    await settleUi(50);
    const images = document.querySelectorAll('img.embed-image__img');
    expect([...images].map((img) => img.getAttribute('src'))).toEqual([
      'blob:test/1',
      'blob:test/2',
    ]);
    await settleUi(3000);
    expect(server.mock.callsTo('PUT /api/note')).toHaveLength(0);
  });

  it('a file dropped on the title goes to the end of the note instead of leaving the app', async () => {
    await renderNoteScreen(`path=${encodeURIComponent(PATH)}`);
    const title = screen.getByRole('textbox', { name: /Tiêu đề ghi chú/ });
    const kept = fireEvent.drop(title, { dataTransfer: filesTransfer([file('sơ đồ 2.png')]) });
    expect(kept).toBe(false);
    await settleUi(1500);
    expect(server.content).toBe(`${CONTENT}\r\n![[sơ đồ 2.png]]\r\n`);
  });

  it('a dropped image is saved as exactly one new line, every other byte kept', async () => {
    await renderNoteScreen(`path=${encodeURIComponent(PATH)}`);
    const editor = realEditor();
    // An empty line after the heading (Enter at its end), then the drop.
    act(() => {
      const pos = editor.state.doc.child(0).nodeSize;
      const tr = editor.state.tr.insert(pos, editor.state.schema.nodes['paragraph']!.create());
      editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 1)));
    });
    act(() => void editor.view.dom.dispatchEvent(dropEvent([file('ảnh chụp.png')])));
    await settleUi(1500);
    expect(server.content).toBe(
      CONTENT.replace('# Bài giảng 3\r\n', '# Bài giảng 3\r\n\r\n![[ảnh chụp.png]]\r\n'),
    );
  });
});
