/**
 * The revisions this tab's own writes from the views produced, per note. A view keeps the
 * revision it was built from until its refetch arrives, so a second action on the same note in
 * that window would send that older revision and be refused (409) although only our own write
 * touched the file. When the caller's revision is the one our latest writes started from, the
 * revision the server gave back is sent instead, with the line text our last write left on that
 * line. The server still checks both, so nothing is guessed.
 *
 * Revisions are content hashes: an undo or an edit elsewhere can bring a note back to a revision
 * our writes once replaced. So the carry-over for a note ends as soon as anything but our own
 * write is seen there: a change event with another revision (or one seen while our write was on
 * its way that is not its answer), a refused write, an undo, a rename, a delete, a reconnect.
 *
 * Writes on one note also run one after the other, so a second tick sent while the first is in
 * flight already sees the first one's answer.
 */
import type { VaultPath } from '../../lib/api/vault-types';
import { useVaultStore } from '../../lib/vault-store';
import { subscribeServerEvent } from '../../lib/ws/server-event-bus';
import type { ClientEvent } from '../../lib/ws/server-event-types';

interface OwnWriteChain {
  /** Revisions our writes replaced, each leading through our writes only to `latest`. */
  replaced: Set<string>;
  latest: string;
  /** False once a write may have added or removed lines (a front-matter patch). */
  linesKept: boolean;
  /** 1-based line → the text our last write left there (absent: unknown, keep the caller's). */
  lineTexts: Map<number, string>;
}

export interface WriteBasis {
  revision: string;
  /** Only for line writes. */
  lineText?: string;
}

export interface OwnWrite {
  /** The revision the request carried. */
  sent: string;
  /** The revision the server answered with. */
  revision: string;
  /** Whether every other line kept its number (a task line patch does; front matter may not). */
  linesKept: boolean;
  /** The line written and its new text (null text: changed, but the answer does not say how). */
  line?: { number: number; text: string | null };
}

const chains = new Map<VaultPath, OwnWriteChain>();
const queues = new Map<VaultPath, Promise<unknown>>();
/** Revisions announced for a note while one of our writes on it is on its way. */
const seenWhileWriting = new Map<VaultPath, string[]>();
let chainsVault: string | null = null;
let unsubscribe: (() => void) | null = null;

/** Ends the carry-over for `path` (or every note): its next write sends what its caller saw. */
export function forgetOwnWrites(path?: VaultPath): void {
  if (path === undefined) chains.clear();
  else chains.delete(path);
}

function observe(path: VaultPath, revision: string): void {
  const seen = seenWhileWriting.get(path);
  if (seen) seen.push(revision);
  else if (chains.get(path)?.latest !== revision) forgetOwnWrites(path);
}

function onServerEvent(event: ClientEvent): void {
  switch (event.type) {
    case 'note:changed':
    case 'note:created':
      observe(event.path, event.revision);
      return;
    case 'note:renamed':
      forgetOwnWrites(event.oldPath);
      forgetOwnWrites(event.path);
      return;
    case 'note:deleted':
      forgetOwnWrites(event.path);
      return;
    // A folder move renames notes without one event each; after a reconnect events were missed.
    case 'folder:changed':
    case 'resync':
      forgetOwnWrites();
      return;
    default:
      return;
  }
}

/** Revisions are per vault: switching vaults forgets everything. */
function chainFor(path: VaultPath): OwnWriteChain | undefined {
  const vaultId = useVaultStore.getState().vaultId;
  if (vaultId !== chainsVault) {
    chains.clear();
    chainsVault = vaultId;
  }
  return chains.get(path);
}

/** What to send for a write on `path` that the caller based on `revision` (and `line`). */
export function writeBasis(
  path: VaultPath,
  revision: string,
  line?: { number: number; text: string },
): WriteBasis {
  const chain = chainFor(path);
  const known = chain !== undefined && chain.replaced.has(revision);
  // A line number from before a front-matter write may point elsewhere now: send what the caller
  // saw, and the server refuses it.
  if (!known || (line && !chain.linesKept)) return { revision, lineText: line?.text };
  if (!line) return { revision: chain.latest };
  return { revision: chain.latest, lineText: chain.lineTexts.get(line.number) ?? line.text };
}

/** Records a write the server accepted. */
export function recordOwnWrite(path: VaultPath, write: OwnWrite): void {
  unsubscribe ??= subscribeServerEvent('*', onServerEvent);
  const seen = seenWhileWriting.get(path) ?? [];
  if (seen.some((revision) => revision !== write.sent && revision !== write.revision)) {
    // Something else changed the note around our write: its revision says nothing about ours.
    forgetOwnWrites(path);
    return;
  }
  // Same revision back: the file already read as asked and nothing was written.
  if (write.revision === write.sent) return;
  let chain = chainFor(path);
  if (chain === undefined || chain.latest !== write.sent) {
    // Based on a revision our writes did not produce (a fresh view): a new chain starts there.
    chain = { replaced: new Set(), latest: write.sent, linesKept: true, lineTexts: new Map() };
    chains.set(path, chain);
  }
  chain.replaced.add(write.sent);
  chain.latest = write.revision;
  chain.linesKept &&= write.linesKept;
  if (write.line) {
    if (write.line.text === null) chain.lineTexts.delete(write.line.number);
    else chain.lineTexts.set(write.line.number, write.line.text);
  }
}

/**
 * Runs `write` after every earlier write on `path` has settled, noting the change events that
 * arrive meanwhile (the event of our own write usually comes before its answer).
 */
export function queueWrite<T>(path: VaultPath, write: () => Promise<T>): Promise<T> {
  unsubscribe ??= subscribeServerEvent('*', onServerEvent);
  const run = async () => {
    seenWhileWriting.set(path, []);
    try {
      return await write();
    } finally {
      seenWhileWriting.delete(path);
    }
  };
  const previous = queues.get(path) ?? Promise.resolve();
  const result = previous.then(run, run);
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  queues.set(path, settled);
  void settled.then(() => {
    if (queues.get(path) === settled) queues.delete(path);
  });
  return result;
}

/** Tests: forget every recorded write and the event subscription. */
export function resetOwnWriteRevisions(): void {
  chains.clear();
  queues.clear();
  seenWhileWriting.clear();
  chainsVault = null;
  unsubscribe?.();
  unsubscribe = null;
}
