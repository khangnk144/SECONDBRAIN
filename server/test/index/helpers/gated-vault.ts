/**
 * A VaultService whose `read` can be held, so a test can act while a rebuild is in flight.
 */
import type { VaultService } from '../../../src/vault/vault-types.js';

export interface GatedVault {
  vault: VaultService;
  /** Reads issued from now on wait until `open()`. */
  close: () => void;
  open: () => void;
  /** Resolves once at least one read is waiting at the gate. */
  waiting: () => Promise<void>;
}

export function gateVaultReads(inner: VaultService): GatedVault {
  let gate: Promise<void> | null = null;
  let release: () => void = () => undefined;
  let notifyWaiting: (() => void) | null = null;
  const vault = new Proxy(inner, {
    get(target, key, receiver) {
      if (key === 'read') {
        return async (p: string) => {
          if (gate) {
            notifyWaiting?.();
            await gate;
          }
          return target.read(p);
        };
      }
      const value = Reflect.get(target, key, receiver) as unknown;
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  return {
    vault,
    close: () => {
      gate = new Promise((resolve) => (release = resolve));
    },
    open: () => {
      gate = null;
      release();
    },
    waiting: () => new Promise((resolve) => (notifyWaiting = resolve)),
  };
}
