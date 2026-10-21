import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Navigator } from '../app-navigation';
import { useCaptureUi } from '../capture-ui-store';
import { useShortcutSheetUi } from '../shortcut-sheet-store';
import { installFetchMock, type FetchMock } from '../testing/fetch-mock';
import { resetAppState } from '../testing/reset-app-state';
import { listShortcuts, suspendShortcuts } from './shortcut-registry';
import { shortcutKeys, useAppShortcuts } from './use-app-shortcuts';

function Shortcuts() {
  useAppShortcuts();
  return <input aria-label="field" />;
}

describe('app shortcuts (F22)', () => {
  let mock: FetchMock;
  let navigate: ReturnType<typeof vi.fn<Navigator>>;
  beforeEach(async () => {
    navigate = (await resetAppState()) as ReturnType<typeof vi.fn<Navigator>>;
    mock = installFetchMock();
    mock.on('GET /api/daily', { body: { path: 'Daily/2026-10-19.md', revision: 'r' } });
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists exactly the implemented shortcuts, one registry; no Alt+, before settings exist', () => {
    render(<Shortcuts />);
    expect(listShortcuts().map((s) => `${s.id} ${s.keys}`)).toEqual([
      'toggle-left-pane Alt+1',
      'toggle-right-pane Alt+2',
      'new-note Alt+N',
      'daily-note Alt+T',
      'quick-capture Alt+Q',
      'graph Alt+G',
      'close-tab Alt+W',
      'previous-tab Alt+[',
      'next-tab Alt+]',
      'search Ctrl+K',
      'shortcut-sheet Ctrl+/',
    ]);
    expect(listShortcuts().every((s) => s.labelKey.startsWith('shortcuts.'))).toBe(true);
    expect(shortcutKeys('quick-capture')).toBe('Alt+Q');
  });

  it('Alt+T opens the daily note, Alt+G the graph, Ctrl+/ the sheet', async () => {
    const user = userEvent.setup();
    render(<Shortcuts />);
    await user.keyboard('{Alt>}t{/Alt}');
    await vi.waitFor(() => expect(mock.callsTo('GET /api/daily')).toHaveLength(1));
    await user.keyboard('{Alt>}g{/Alt}');
    expect(navigate).toHaveBeenLastCalledWith('/graph', undefined);
    await user.keyboard('{Control>}/{/Control}');
    expect(useShortcutSheetUi.getState().isOpen).toBe(true);
  });

  it('Alt+Q and Ctrl+/ also work inside a form field; Alt+T and Alt+G do not', async () => {
    const user = userEvent.setup();
    const { getByRole } = render(<Shortcuts />);
    getByRole('textbox').focus();
    await user.keyboard('{Alt>}t{/Alt}{Alt>}g{/Alt}');
    expect(mock.calls).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
    await user.keyboard('{Alt>}q{/Alt}');
    expect(useCaptureUi.getState().isOpen).toBe(true);
    expect(useCaptureUi.getState().returnFocus).toBe(getByRole('textbox'));
    await user.keyboard('{Control>}/{/Control}');
    expect(useShortcutSheetUi.getState().isOpen).toBe(true);
  });

  it('nothing fires while an overlay is open', async () => {
    const user = userEvent.setup();
    render(<Shortcuts />);
    const resume = suspendShortcuts();
    await user.keyboard('{Alt>}q{/Alt}{Control>}/{/Control}{Alt>}g{/Alt}');
    resume();
    expect(useCaptureUi.getState().isOpen).toBe(false);
    expect(useShortcutSheetUi.getState().isOpen).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
