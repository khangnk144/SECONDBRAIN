import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { watch } from 'chokidar';
import { isVaultTempFileName } from './vault-layout.js';
import type { VaultChange, VaultPath } from './vault-types.js';

/** Swap, lock and safe-write files editors create next to the real file; never user notes. */
const EDITOR_TEMP_FILES: readonly RegExp[] = [
  /^\..*\.sw[a-p]$/i, // vim swap files
  /^4913$/, // vim's write-permission probe
  /~$/, // backup copies (vim, gedit, nano)
  /^\.#/, // emacs lock links
  /^#.*#$/, // emacs auto-save
  /^~\$/, // Microsoft Office owner files
  /^\.~lock\..*#$/, // LibreOffice locks
  /___jb_(tmp|old)___$/, // JetBrains safe write
  /^\.goutputstream-/, // GTK atomic save
  /\.crdownload$/i, // browser downloads still in progress
  /^\..*\.tmp$/i, // generic dot-temp files
];

/** True for entries the app never reports: its own state, git internals and editor temp files. */
export function isIgnoredVaultEntry(relativePath: string): boolean {
  const segments = relativePath.split(/[\\/]/).filter((segment) => segment !== '');
  const first = segments[0]?.toLowerCase();
  if (first === undefined) return false;
  if (first === '.secondbrain' || first === '.git') return true;
  const name = segments[segments.length - 1] ?? '';
  return isVaultTempFileName(name) || EDITOR_TEMP_FILES.some((pattern) => pattern.test(name));
}

export interface VaultWatcherOptions {
  /** Absolute path of the vault root. */
  root: string;
  onChange: (change: VaultChange) => void;
  /** Watcher failures (e.g. too many watched files); the caller re-scans the vault. */
  onError: (error: Error) => void;
  /** Last revision the app knew for a path that just vanished (used to pair renames). */
  knownRevision?: (path: VaultPath) => string | null;
  /** How long a deletion waits for a matching creation before it is reported. */
  renameWindowMs?: number;
  /** A file must keep its size this long before it is read (saves arrive whole). */
  stabilityMs?: number;
}

export interface VaultWatcher {
  /** Resolves once the initial scan is finished and changes are being reported. */
  readonly ready: Promise<void>;
  close(): Promise<void>;
}

const BUSY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

const hashFile = (file: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(file).on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });

/** Windows editors may hold a file locked for a moment after saving; retry briefly. */
async function hashWhenReadable(file: string): Promise<string | null> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await hashFile(file);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (code === 'ENOENT' || code === 'EISDIR') return null;
      if (!BUSY_CODES.has(code) || attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

/**
 * Reports changes made to the vault by other programs (Notepad, Explorer, git, sync tools) as
 * `VaultChange` events with origin `external`. A rename shows up on disk as a deletion plus a
 * creation; a deletion is therefore held briefly and paired with a creation of the same bytes.
 */
export function startVaultWatcher(options: VaultWatcherOptions): VaultWatcher {
  const renameWindowMs = options.renameWindowMs ?? 300;
  const stabilityMs = options.stabilityMs ?? 150;
  const pendingDeletes = new Map<VaultPath, { revision: string; timer: NodeJS.Timeout }>();
  const chains = new Map<VaultPath, Promise<void>>();
  let closed = false;

  /** Vault path of an absolute path, or null for the root itself and anything outside it. */
  const toVaultPath = (absolute: string): VaultPath | null => {
    const relative = path.relative(options.root, absolute);
    // `..Lưu trữ` is a legal name inside the vault; only a whole `..` segment leaves it.
    const outside =
      relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
    if (relative === '' || outside) return null;
    return relative.split(path.sep).join('/').normalize('NFC');
  };
  const emit = (change: VaultChange): void => {
    if (!closed) options.onChange(change);
  };

  // Events of one path are handled in order (hashing is async); different paths run in parallel.
  function enqueue(vaultPath: VaultPath, task: () => Promise<void>): void {
    const previous = chains.get(vaultPath) ?? Promise.resolve();
    const next = previous.then(task).catch((error: unknown) => {
      if (!closed) options.onError(error instanceof Error ? error : new Error(String(error)));
    });
    chains.set(vaultPath, next);
    void next.then(() => {
      if (chains.get(vaultPath) === next) chains.delete(vaultPath);
    });
  }

  function reportDelete(vaultPath: VaultPath): void {
    const pending = pendingDeletes.get(vaultPath);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingDeletes.delete(vaultPath);
    emit({ kind: 'deleted', path: vaultPath, origin: 'external' });
  }

  function onFileGone(vaultPath: VaultPath): void {
    const revision = options.knownRevision?.(vaultPath) ?? null;
    if (revision === null) {
      emit({ kind: 'deleted', path: vaultPath, origin: 'external' });
      return;
    }
    const previous = pendingDeletes.get(vaultPath);
    if (previous) clearTimeout(previous.timer);
    const timer = setTimeout(() => reportDelete(vaultPath), renameWindowMs);
    pendingDeletes.set(vaultPath, { revision, timer });
  }

  /** The vanished file with the same bytes; same file name first (a move between folders). */
  function takeRenameSource(vaultPath: VaultPath, revision: string): VaultPath | null {
    let match: VaultPath | null = null;
    for (const [oldPath, pending] of pendingDeletes) {
      if (pending.revision !== revision) continue;
      if (match === null || path.posix.basename(oldPath) === path.posix.basename(vaultPath)) {
        match = oldPath;
      }
    }
    if (match === null) return null;
    clearTimeout(pendingDeletes.get(match)!.timer);
    pendingDeletes.delete(match);
    return match;
  }

  async function onFileAppeared(absolute: string, vaultPath: VaultPath, created: boolean) {
    const revision = await hashWhenReadable(absolute);
    if (revision === null) return; // gone again; its deletion event follows
    const recreated = pendingDeletes.get(vaultPath);
    if (recreated) {
      // Deleted and written again under the same name (some editors save this way).
      clearTimeout(recreated.timer);
      pendingDeletes.delete(vaultPath);
      emit({ kind: 'written', path: vaultPath, revision, origin: 'external' });
      return;
    }
    const oldPath = created ? takeRenameSource(vaultPath, revision) : null;
    if (oldPath !== null) {
      emit({ kind: 'renamed', path: vaultPath, oldPath, revision, origin: 'external' });
      return;
    }
    emit({ kind: created ? 'created' : 'written', path: vaultPath, revision, origin: 'external' });
  }

  const watcher = watch(options.root, {
    ignoreInitial: true,
    // A link pointing outside the vault must not make the app watch (or report) outside files.
    followSymlinks: false,
    ignored: (absolute: string) => isIgnoredVaultEntry(path.relative(options.root, absolute)),
    awaitWriteFinish: { stabilityThreshold: stabilityMs, pollInterval: 50 },
  });

  watcher.on('all', (event, absolute) => {
    const vaultPath = toVaultPath(absolute);
    if (vaultPath === null) return;
    if (event === 'add' || event === 'change') {
      enqueue(vaultPath, () => onFileAppeared(absolute, vaultPath, event === 'add'));
    } else if (event === 'unlink') {
      enqueue(vaultPath, async () => onFileGone(vaultPath));
    } else if (event === 'addDir' || event === 'unlinkDir') {
      const kind = event === 'addDir' ? 'folder-created' : 'folder-deleted';
      enqueue(vaultPath, async () => emit({ kind, path: vaultPath, origin: 'external' }));
    }
  });
  watcher.on('error', (error) => {
    if (!closed) options.onError(error instanceof Error ? error : new Error(String(error)));
  });

  const ready = new Promise<void>((resolve) => watcher.once('ready', () => resolve()));

  return {
    ready,
    async close() {
      closed = true;
      for (const pending of pendingDeletes.values()) clearTimeout(pending.timer);
      pendingDeletes.clear();
      await watcher.close();
      await Promise.all([...chains.values()]);
    },
  };
}
