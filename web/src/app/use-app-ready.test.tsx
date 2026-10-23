import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { usePanesStore } from '../lib/panes-store';
import { useTabsStore } from '../lib/tabs-store';
import { resetAppState } from '../lib/testing/reset-app-state';
import { makeTree } from '../lib/testing/tree-fixture';
import { useTreeStore } from '../lib/tree-store';
import { useAppReady } from './use-app-ready';

describe('useAppReady (e2e appReady() in both styles)', () => {
  beforeEach(async () => {
    await resetAppState('vault-a');
    usePanesStore.setState({ hydrated: false });
    useTabsStore.setState({ hydrated: false });
    useTreeStore.setState({ tree: null, status: 'loading' });
  });

  it('is ready once panes and tabs are hydrated and the tree has loaded', () => {
    const { result } = renderHook(() => useAppReady());
    expect(result.current).toBe(false);
    act(() => usePanesStore.getState().hydrate());
    act(() => useTabsStore.getState().hydrate());
    expect(result.current).toBe(false);
    act(() =>
      useTreeStore.setState({ tree: makeTree({ folders: [], notes: [] }), status: 'ready' }),
    );
    expect(result.current).toBe(true);
  });
});
