import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createVaultStorage, vaultStorage } from './vault-storage';
import { useVaultStore } from './vault-store';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

function throwingStorage(): Storage {
  const fail = () => {
    throw new DOMException('blocked', 'SecurityError');
  };
  return {
    length: 0,
    clear: fail,
    getItem: fail,
    key: fail,
    removeItem: fail,
    setItem: fail,
  };
}

describe('vault storage (SPEC §4.13 browser state keyed by vault id)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores JSON under sb:<vaultId>:<key> and keeps vaults apart', () => {
    const storage = memoryStorage();
    let vaultId: string | null = 'vault-a';
    const store = createVaultStorage(
      () => vaultId,
      () => storage,
    );
    store.set('tabs', { activeId: 't1' });
    expect(storage.getItem('sb:vault-a:tabs')).toBe('{"activeId":"t1"}');
    vaultId = 'vault-b';
    expect(store.get('tabs', 'none')).toBe('none');
    vaultId = 'vault-a';
    expect(store.get('tabs', null)).toEqual({ activeId: 't1' });
    store.remove('tabs');
    expect(store.get('tabs', 'gone')).toBe('gone');
  });

  it('works with defaults when storage throws or is missing', () => {
    const store = createVaultStorage(() => 'v', throwingStorage);
    expect(() => store.set('x', 1)).not.toThrow();
    expect(store.get('x', 42)).toBe(42);
    expect(() => store.remove('x')).not.toThrow();
    const getterThrows = createVaultStorage(
      () => 'v',
      () => {
        throw new DOMException('denied', 'SecurityError');
      },
    );
    expect(getterThrows.get('x', 'fallback')).toBe('fallback');
    expect(() => getterThrows.set('x', 1)).not.toThrow();
  });

  it('ignores corrupt JSON and reads nothing without a vault id', () => {
    const storage = memoryStorage();
    storage.setItem('sb:v:x', '{broken');
    const store = createVaultStorage(
      () => 'v',
      () => storage,
    );
    expect(store.get('x', 'fallback')).toBe('fallback');
    const noVault = createVaultStorage(
      () => null,
      () => storage,
    );
    const setItem = vi.spyOn(storage, 'setItem');
    noVault.set('x', 1);
    expect(setItem).not.toHaveBeenCalled();
    expect(noVault.get('x', 7)).toBe(7);
  });

  it('the app instance follows the vault store', () => {
    useVaultStore.setState({ vaultId: 'vault-z', ready: true });
    vaultStorage.set('panes', { leftCollapsed: true });
    expect(localStorage.getItem('sb:vault-z:panes')).toBe('{"leftCollapsed":true}');
  });
});
