import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fileRoute, noteRoute, type Navigator } from '../../lib/app-navigation';
import { setOpenVaultFileImplementation } from '../../lib/open-vault-file';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useToastStore } from '../../lib/toast-store';
import { startOpenVaultFile } from '../viewer/open-vault-file-in-app';
import { openGraphNode } from './open-graph-node';

describe('brain map: opening a node (F16, F15.3)', () => {
  let navigate: Mock<Navigator>;
  beforeEach(async () => {
    navigate = (await resetAppState('vault-a')) as Mock<Navigator>;
  });
  afterEach(() => setOpenVaultFileImplementation(null));

  it('notes open in the editor; source nodes go through openVaultFile', () => {
    const opened = vi.fn();
    setOpenVaultFileImplementation(opened);
    openGraphNode('2 Areas/Giải tích 1.md');
    expect(navigate).toHaveBeenLastCalledWith(noteRoute('2 Areas/Giải tích 1.md'), undefined);
    openGraphNode('3 Resources/papers/Newton 1687.pdf', { newTab: true });
    openGraphNode('3 Resources/web/Bài viết.html');
    expect(opened.mock.calls).toEqual([
      ['3 Resources/papers/Newton 1687.pdf', { newTab: true }],
      ['3 Resources/web/Bài viết.html', { newTab: false }],
    ]);
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('a PDF source node opens the viewer tab', () => {
    const stop = startOpenVaultFile();
    openGraphNode('3 Resources/papers/Newton 1687.pdf');
    expect(navigate).toHaveBeenLastCalledWith(
      fileRoute('3 Resources/papers/Newton 1687.pdf'),
      undefined,
    );
    stop();
  });
});
