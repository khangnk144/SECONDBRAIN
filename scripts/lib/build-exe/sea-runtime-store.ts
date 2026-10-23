/**
 * The executable's runtime folder (F29.1), used by the SEA bootstrap: where it lives, how the
 * payload is unpacked and checked, how a damaged folder is replaced, which folders are in use and
 * which can go. Node built-ins only: the build inlines this file into the one CommonJS bootstrap
 * (see `transpileBootstrap`); the payload packer and the tests import it directly.
 *
 * Integrity at every start (review L5): the marker names the payload hash and every file with its
 * size, and the code the server runs (`app/server/dist/**`, the `app/*.cjs` entry, the manifests
 * and every native `*.node` addon, about 7 MB) also with its SHA-256, which is checked too – a
 * damaged file of the same size there (disk error, a half-done antivirus repair) means a fresh
 * extraction, not an obscure failure. The rest (dependencies' JavaScript, the built UI) is
 * checked by size, which keeps a warm start cheap. Cleanup never throws (review L4): it runs in
 * the server's own process, where an uncaught error would stop the app.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const PAYLOAD_ASSET = 'payload.bin';
export const HASH_ASSET = 'payload.sha256';
export const PAYLOAD_MAGIC = 'SBRT1\n';
export const MARKER_FILE = '.sb-runtime.json';
export const USERS_DIR = '.users';
export const SHORT_HASH = 16;
/** A temp folder younger than this may belong to a start that is extracting right now. */
export const TMP_GRACE_MS = 60 * 60 * 1000;

/** `[path, size, executable]` per file, in payload order. */
export type PayloadIndex = Array<[string, number, 0 | 1]>;

/** Marker entry: `[path, size]`, plus the SHA-256 for the files checked by content. */
type MarkerEntry = [string, number] | [string, number, string];

/** Files whose content is checked at every start: the code the server itself runs. */
export function isCheckedByContent(rel: string): boolean {
  return (
    rel.startsWith('app/server/dist/') ||
    rel.endsWith('.node') ||
    /^app\/[^/]+\.cjs$/.test(rel) ||
    rel === 'app/package.json' ||
    rel === 'app/server/package.json'
  );
}

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function runtimeRoot(platform: string, env: NodeJS.ProcessEnv, home: string): string {
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local');
    return path.win32.join(base, 'SecondBrain', 'runtime');
  }
  // XDG: an unset, empty or relative value means the default.
  const xdg = env.XDG_DATA_HOME;
  const base = xdg && path.posix.isAbsolute(xdg) ? xdg : path.posix.join(home, '.local', 'share');
  return path.posix.join(base, 'second-brain', 'runtime');
}

function safeRelative(rel: string): string {
  const parts = rel.split('/');
  if (rel.includes('\\') || rel.includes(':') || rel.startsWith('/') || parts.includes('..')) {
    throw new Error(`PAYLOAD_PATH ${rel}`);
  }
  return path.join(...parts);
}

/** Checks the hash, writes every file below `dir` and the marker last; returns the index. */
export function unpackPayload(payload: Uint8Array, hash: string, dir: string): PayloadIndex {
  if (sha256(payload) !== hash) throw new Error('PAYLOAD_HASH');
  const raw = zlib.gunzipSync(payload);
  if (raw.subarray(0, PAYLOAD_MAGIC.length).toString('latin1') !== PAYLOAD_MAGIC) {
    throw new Error('PAYLOAD_FORMAT');
  }
  const headerLength = raw.readUInt32LE(PAYLOAD_MAGIC.length);
  let offset = PAYLOAD_MAGIC.length + 4;
  const index = JSON.parse(raw.subarray(offset, offset + headerLength).toString('utf8')) as {
    files: PayloadIndex;
  };
  offset += headerLength;
  const files: MarkerEntry[] = [];
  for (const [rel, size, executable] of index.files) {
    const target = path.join(dir, safeRelative(rel));
    const bytes = raw.subarray(offset, offset + size);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes, { mode: executable ? 0o755 : 0o644 });
    files.push(isCheckedByContent(rel) ? [rel, size, sha256(bytes)] : [rel, size]);
    offset += size;
  }
  if (offset !== raw.length) throw new Error('PAYLOAD_LENGTH');
  fs.writeFileSync(path.join(dir, MARKER_FILE), JSON.stringify({ hash, files }));
  return index.files;
}

/**
 * The marker names this hash, every listed file has its size, and the files checked by content
 * have their SHA-256 (a marker without those hashes, from an older build, is not trusted).
 */
export function isRuntimeValid(dir: string, hash: string): boolean {
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(dir, MARKER_FILE), 'utf8')) as {
      hash?: unknown;
      files?: MarkerEntry[];
    };
    if (marker.hash !== hash || !Array.isArray(marker.files)) return false;
    return marker.files.every(([rel, size, digest]) => {
      const file = path.join(dir, safeRelative(rel));
      if (fs.statSync(file).size !== size) return false;
      if (!isCheckedByContent(rel)) return true;
      return typeof digest === 'string' && sha256(fs.readFileSync(file)) === digest;
    });
  } catch {
    return false;
  }
}

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const suffix = () => `${process.pid}-${randomBytes(4).toString('hex')}`;

/**
 * The folder to run from: the valid `<root>/<hash>`, else a fresh extraction renamed into place.
 * Another start may win the rename (its copy is used) and Windows may hold a folder briefly
 * (virus scan): rename is retried; a damaged folder that cannot be replaced (a running server
 * uses it) leaves this start on its own fresh copy.
 */
export function ensureRuntime(root: string, hash: string, read: () => Uint8Array): string {
  const final = path.join(root, hash.slice(0, SHORT_HASH));
  if (isRuntimeValid(final, hash)) return final;
  fs.mkdirSync(root, { recursive: true });
  const temp = `${final}.tmp-${suffix()}`;
  unpackPayload(read(), hash, temp);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.renameSync(temp, final);
      return final;
    } catch {
      if (isRuntimeValid(final, hash)) {
        fs.rmSync(temp, { recursive: true, force: true });
        return final;
      }
      // A damaged folder is moved aside (removed later by the cleanup).
      if (fs.existsSync(final)) {
        try {
          fs.renameSync(final, `${final}.old-${suffix()}`);
          continue;
        } catch {
          // in use: retry, then run from the fresh copy
        }
      }
      sleep(200);
    }
  }
  return temp;
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Records this process in `<dir>/.users/<pid>` until it exits. */
export function markInUse(dir: string, pid = process.pid): string {
  const file = path.join(dir, USERS_DIR, String(pid));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
  return file;
}

export function isInUse(dir: string, alive: (pid: number) => boolean = processAlive): boolean {
  let names: string[];
  try {
    names = fs.readdirSync(path.join(dir, USERS_DIR));
  } catch {
    return false;
  }
  for (const name of names) {
    if (/^\d+$/.test(name) && alive(Number(name))) return true;
    try {
      fs.rmSync(path.join(dir, USERS_DIR, name), { force: true }); // left by a crashed process
    } catch {
      return true; // cannot tell (locked, or not a plain file): treat the folder as in use
    }
  }
  return false;
}

/** Removes runtime folders of other hashes (and stale temp folders) that nobody uses. */
export function cleanupRuntimes(
  root: string,
  keep: string,
  alive: (pid: number) => boolean = processAlive,
  now = Date.now(),
): string[] {
  const removed: string[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch {
    return removed; // the runtime root is gone or locked: nothing to do this time
  }
  for (const name of names) {
    const dir = path.join(root, name);
    try {
      if (dir === keep || isInUse(dir, alive)) continue;
      if (name.includes('.tmp-') && now - fs.statSync(dir).mtimeMs < TMP_GRACE_MS) continue;
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 2 });
      removed.push(name);
    } catch {
      // still locked by something: next start tries again
    }
  }
  return removed;
}

/** `cleanupRuntimes` for the bootstrap's timer: whatever happens, it never throws. */
export function cleanupRuntimesSafely(root: string, keep: string): string[] {
  try {
    return cleanupRuntimes(root, keep);
  } catch {
    return [];
  }
}
