/** Test helpers for the note screen: a router around it and a settle step inside `act`. */
import { act, render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { DialogHost } from '../dialogs/dialog-host';
import { settle } from '../note-session/session-test-kit';
import { NoteScreen } from './note-screen';

export { editorStub, resetEditorStub, typeInEditor } from './markdown-editor-stub';

export async function settleUi(ms = 0): Promise<void> {
  await act(async () => {
    await settle(ms);
  });
}

export async function renderNoteScreen(search: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/note',
        element: (
          <>
            <NoteScreen />
            <DialogHost />
          </>
        ),
      },
    ],
    { initialEntries: [`/note?${search}`] },
  );
  render(<RouterProvider router={router} />);
  await settleUi();
  return router;
}
