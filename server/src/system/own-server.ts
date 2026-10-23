/**
 * Single-instance check of the executable (F29.1): is a Second Brain server of THIS home already
 * running? `server.json` (written by the server of this home once it listens, pid alive) is the
 * first proof; otherwise the configured port must answer `/api/health` with the vault id this
 * home's vault folder has. A Second Brain of another folder on the same port is reported, never
 * opened as if it were this one. Reads files only, never writes.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveVaultRoot } from '../config/vault-location.js';
import { processAlive, readBridgeTarget, readLiveServerPort } from '../mcp/bridge-server.js';
import { APP_ID } from '../version.js';

export type OwnServer =
  | { kind: 'none' }
  | { kind: 'ours'; port: number }
  /** Another Second Brain (another home or vault) answers on the port. */
  | { kind: 'other'; port: number };

export interface FindOwnServerOptions {
  home: string;
  /** `--port` / `SB_PORT`; else the port in settings.json. */
  portOverride?: number;
  fetch?: typeof fetch;
  alive?: (pid: number) => boolean;
}

interface Health {
  app?: unknown;
  vaultId?: unknown;
}

export async function healthOf(port: number, fetchImpl: typeof fetch): Promise<Health | null> {
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Health;
    return body.app === APP_ID ? body : null;
  } catch {
    return null;
  }
}

/** The id in `<vault>/.secondbrain/vault.json` of this home's vault, or null. */
export async function readHomeVaultId(home: string): Promise<string | null> {
  let vaultPath: string | null = null;
  try {
    const text = await readFile(path.join(home, '.secondbrain', 'settings.json'), 'utf8');
    const value = (JSON.parse(text.replace(/^\uFEFF/, '')) as { vaultPath?: unknown }).vaultPath;
    vaultPath = typeof value === 'string' && value !== '' ? value : null;
  } catch {
    // no settings yet: the default vault folder
  }
  try {
    const file = path.join(resolveVaultRoot({ vaultPath }, home), '.secondbrain', 'vault.json');
    const id = (JSON.parse(await readFile(file, 'utf8')) as { id?: unknown }).id;
    return typeof id === 'string' && id !== '' ? id : null;
  } catch {
    return null;
  }
}

export async function findOwnServer(options: FindOwnServerOptions): Promise<OwnServer> {
  const fetchImpl = options.fetch ?? fetch;
  const live = await readLiveServerPort(options.home, options.alive ?? processAlive);
  if (live !== null && (await healthOf(live, fetchImpl))) return { kind: 'ours', port: live };
  const port = options.portOverride ?? (await readBridgeTarget(options.home)).port;
  const health = await healthOf(port, fetchImpl);
  if (!health) return { kind: 'none' };
  const vaultId = await readHomeVaultId(options.home);
  return vaultId !== null && health.vaultId === vaultId
    ? { kind: 'ours', port }
    : { kind: 'other', port };
}
