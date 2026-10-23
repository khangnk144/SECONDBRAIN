import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import vi_ from '../i18n/vi.json';
import { usePanesStore } from '../lib/panes-store';
import { withStyle } from '../lib/testing/ui-style-test-kit';
import { useVaultStore } from '../lib/vault-store';
import { hydrateVaultState } from './start-app-services';
import { noteUrl, renderShell, setupShell, teardownShell } from './__tests__/shell-test-kit';

const folderPane = () => screen.queryByRole('complementary', { name: 'Thư mục' });
const drawer = () => screen.queryByRole('dialog', { name: 'Thư mục' });
const railButton = () =>
  within(screen.getByRole('navigation', { name: vi_.nav.label })).getByRole('button', {
    name: 'Thư mục',
  });
const treeItem = (name: string) =>
  screen
    .getAllByRole('treeitem')
    .find((el) => el.querySelector('.tree-item__label')?.textContent === name) as HTMLElement;

describe('bento folder pane and drawer (F35.2)', () => {
  beforeEach(async () => {
    await setupShell('vault-a');
    withStyle('bento');
  });
  afterEach(() => teardownShell());

  it('(F35.2) note and file routes show the tree beside the rail, with the Inbox badge', async () => {
    const { router } = renderShell(noteUrl());
    const pane = folderPane();
    expect(pane).toBeInTheDocument();
    expect(within(pane as HTMLElement).getByRole('tree')).toBeInTheDocument();
    expect(treeItem('0 Inbox')).toHaveTextContent('1');
    expect(railButton()).toHaveAttribute('aria-expanded', 'true');
    expect(railButton()).toHaveAttribute('aria-controls', 'folder-pane');
    await act(() => router.navigate('/file?path=4%20Resources%2Fa.pdf'));
    expect(folderPane()).toBeInTheDocument();
    // Other routes: no pane.
    await act(() => router.navigate('/calendar'));
    expect(folderPane()).toBeNull();
    expect(railButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('(F35.2) Alt+1 hides and shows the pane, remembered per vault, apart from calm', async () => {
    const user = userEvent.setup();
    renderShell(noteUrl());
    await user.keyboard('{Alt>}1{/Alt}');
    expect(folderPane()).toBeNull();
    expect(JSON.parse(localStorage.getItem('sb:vault-a:folder-pane') ?? '{}')).toEqual({
      collapsed: true,
    });
    // The calm sidebar preference is a different one and stays as it was.
    expect(localStorage.getItem('sb:vault-a:panes')).toBeNull();
    expect(usePanesStore.getState().leftCollapsed).toBe(false);

    // Another vault has its own memory; coming back reads vault A's again.
    act(() => {
      useVaultStore.setState({ vaultId: 'vault-b' });
      hydrateVaultState();
    });
    expect(folderPane()).toBeInTheDocument();
    act(() => {
      useVaultStore.setState({ vaultId: 'vault-a' });
      hydrateVaultState();
    });
    expect(folderPane()).toBeNull();
    await user.click(railButton());
    expect(folderPane()).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('sb:vault-a:folder-pane') ?? '{}')).toEqual({
      collapsed: false,
    });
  });

  it('(F35.2) elsewhere "Thư mục" opens a drawer: focus moves in, Esc closes, focus returns', async () => {
    const user = userEvent.setup();
    renderShell('/');
    expect(folderPane()).toBeNull();
    await user.click(railButton());
    const panel = drawer() as HTMLElement;
    expect(panel).toHaveAttribute('aria-modal', 'true');
    expect(railButton()).toHaveAttribute('aria-expanded', 'true');
    // Focus is in the tree (the content), not on the close button.
    await waitFor(() =>
      expect(within(panel).getByRole('tree')).toContainElement(
        document.activeElement as HTMLElement,
      ),
    );
    await user.keyboard('{Escape}');
    expect(drawer()).toBeNull();
    expect(railButton()).toHaveFocus();
  });

  it('(F35.2) Tab stays inside the drawer; the close button and a click outside close it', async () => {
    const user = userEvent.setup();
    renderShell('/tasks');
    await user.click(railButton());
    const panel = drawer() as HTMLElement;
    const close = within(panel).getByRole('button', { name: 'Đóng' });
    close.focus();
    await user.tab({ shift: true });
    expect(panel).toContainElement(document.activeElement as HTMLElement);
    await user.click(close);
    expect(drawer()).toBeNull();
    expect(railButton()).toHaveFocus();

    await user.click(railButton());
    expect(drawer()).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('heading', { name: 'Màn hình Việc' }));
    expect(drawer()).toBeNull();
  });

  it('(F35.2) Alt+1 opens and closes the drawer off note routes; opening a note closes it', async () => {
    const user = userEvent.setup();
    const { router } = renderShell('/calendar');
    await user.keyboard('{Alt>}1{/Alt}');
    expect(drawer()).toBeInTheDocument();
    await user.keyboard('{Alt>}1{/Alt}');
    expect(drawer()).toBeNull();
    // The stored pane preference did not change.
    expect(localStorage.getItem('sb:vault-a:folder-pane')).toBeNull();

    await user.keyboard('{Alt>}1{/Alt}');
    await user.click(treeItem('Đồ án Giải tích'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/note'));
    expect(drawer()).toBeNull();
    // On the note route the pane is there instead.
    expect(folderPane()).toBeInTheDocument();
    await act(() => router.navigate('/'));
    expect(drawer()).toBeNull();
  });

  it('(F35.2) the brain map (immersive) has the rail; Thư mục opens the drawer there too', async () => {
    const user = userEvent.setup();
    renderShell('/graph');
    expect(
      within(screen.getByRole('navigation', { name: vi_.nav.label })).getByRole('link', {
        name: 'Bản đồ não',
      }),
    ).toHaveAttribute('aria-current', 'page');
    await user.click(railButton());
    expect(drawer()).toBeInTheDocument();
  });
});
