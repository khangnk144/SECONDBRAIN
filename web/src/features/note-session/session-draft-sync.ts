/**
 * Writes a session's drafts to storage in order (a removal never overtakes an older write), for
 * this window's draft and for a draft taken over from another window on open (SPEC §5).
 */
import type { VaultPath } from '../../lib/api/vault-types';
import type { SessionDeps } from './note-session-types';

export class DraftSync {
  /** Another window's draft this session restored or showed on open: it goes with ours. */
  adoptedWindow: string | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly deps: SessionDeps,
    private readonly vaultId: string,
  ) {}

  /** Resolves true when the draft was written. */
  store(path: VaultPath, baseRevision: string, text: string): Promise<boolean> {
    const { windowId } = this.deps;
    const draft = {
      vaultId: this.vaultId,
      path,
      baseRevision,
      text,
      ts: this.deps.now(),
      windowId,
    };
    return this.then(() => this.deps.drafts.write(draft));
  }

  /** Removes this window's draft and the one taken over, if any. */
  remove(path: VaultPath): void {
    const windows = this.windows();
    this.adoptedWindow = null;
    for (const windowId of windows) {
      void this.then(() => this.deps.drafts.remove(this.vaultId, path, windowId));
    }
  }

  move(from: VaultPath, to: VaultPath): void {
    for (const windowId of this.windows()) {
      void this.then(() => this.deps.drafts.move(this.vaultId, from, to, windowId));
    }
  }

  private windows(): string[] {
    const own = this.deps.windowId;
    const adopted = this.adoptedWindow;
    return adopted !== null && adopted !== own ? [own, adopted] : [own];
  }

  private then<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.chain.then(operation, operation);
    this.chain = next.catch(() => undefined);
    return next;
  }
}
