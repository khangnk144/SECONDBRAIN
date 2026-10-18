import { readFile, rm } from 'node:fs/promises';
import { atomicWriteFile } from '../fs/atomic-write-file.js';

/** `<home>/.secondbrain/server.json`: lets the launcher find and stop the running server. */
export interface ServerInfo {
  pid: number;
  port: number;
  startedAt: string;
  version: string;
}

export async function writeServerInfo(file: string, info: ServerInfo): Promise<void> {
  await atomicWriteFile(file, `${JSON.stringify(info, null, 2)}\n`);
}

export async function readServerInfo(file: string): Promise<ServerInfo | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as ServerInfo;
  } catch {
    return null;
  }
}

/** Removes the file only if it still describes this process (a newer server may own it). */
export async function removeServerInfoIfOwned(file: string, pid: number): Promise<void> {
  const info = await readServerInfo(file);
  if (info && info.pid !== pid) return;
  await rm(file, { force: true });
}
