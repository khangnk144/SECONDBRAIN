/// <reference lib="dom" />
// REST helpers for the M3 scenarios: a token-carrying client (from a page or standalone, for
// beforeAll hooks), local calendar dates, the opt-in sample data of SPEC §10 and a reset that puts
// the e2e vault back to "fresh" (no user notes, no sample manifest) so S1 can run again.
// Only ever used against the temporary e2e vault of playwright.config.ts.
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { expect, request as apiRequest, type APIRequestContext, type Page } from '@playwright/test';
import { e2eVaultDir } from './vault-api.js';

export const E2E_ORIGIN = 'http://localhost:4799';

/** Local calendar date `YYYY-MM-DD` (server, browser and tests share the machine's time zone). */
export function localIso(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isoAddDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return localIso(new Date(y, m - 1, d + days));
}

export interface AppApi {
  readonly token: string;
  get<T>(url: string, status?: number): Promise<T>;
  send<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, data?: unknown): Promise<T>;
  /** Raw status of a GET (for 404 checks). */
  status(url: string): Promise<number>;
}

function clientFor(request: APIRequestContext, token: string, origin: string): AppApi {
  const headers = { 'X-SB-Token': token, Origin: origin };
  return {
    token,
    async get<T>(url: string, status = 200) {
      const response = await request.get(url, { headers });
      expect(response.status(), `${url}: ${await response.text()}`).toBe(status);
      return (await response.json()) as T;
    },
    async send<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, data?: unknown) {
      const response = await request.fetch(url, { method, headers, data });
      expect(response.status(), `${method} ${url}: ${await response.text()}`).toBeLessThan(300);
      const text = await response.text();
      return (text === '' ? undefined : JSON.parse(text)) as T;
    },
    async status(url: string) {
      return (await request.get(url, { headers })).status();
    },
  };
}

async function shellToken(request: APIRequestContext): Promise<string> {
  const html = await (await request.get('/')).text();
  const token = /<meta name="sb-token" content="([^"]+)"/.exec(html)?.[1];
  if (!token) throw new Error('no session token in the served shell');
  return token;
}

/** Client sharing the page's cookies/storage (the token comes from the served shell). */
export async function appApi(page: Page): Promise<AppApi> {
  return clientFor(page.request, await shellToken(page.request), E2E_ORIGIN);
}

/** Client for hooks without a page (beforeAll/afterAll). Dispose it when done. */
export async function standaloneApi(): Promise<AppApi & { dispose: () => Promise<void> }> {
  const request = await apiRequest.newContext({ baseURL: E2E_ORIGIN });
  const api = clientFor(request, await shellToken(request), E2E_ORIGIN);
  return { ...api, dispose: () => request.dispose() };
}

interface TreeFile {
  path: string;
  class: string;
  isNote: boolean;
}
interface TreeFolder {
  folders: TreeFolder[];
  files: TreeFile[];
}
export interface VaultTree {
  root: TreeFolder;
  inboxCount: number;
}

export function treeFiles(tree: VaultTree): TreeFile[] {
  const out: TreeFile[] = [];
  const walk = (folder: TreeFolder) => {
    out.push(...folder.files);
    folder.folders.forEach(walk);
  };
  walk(tree.root);
  return out;
}

export async function trashPaths(api: AppApi, paths: string[]): Promise<void> {
  const existing: { path: string; revision: string }[] = [];
  for (const notePath of paths) {
    if ((await api.status(`/api/note?path=${encodeURIComponent(notePath)}`)) !== 200) continue;
    const note = await api.get<{ revision: string }>(
      `/api/note?path=${encodeURIComponent(notePath)}`,
    );
    existing.push({ path: notePath, revision: note.revision });
  }
  if (existing.length === 0) return;
  await api.send('POST', '/api/note/trash', {
    paths: existing.map((note) => note.path),
    expectedRevisions: existing.map((note) => note.revision),
  });
}

/** Creates the sample set through the API (same call the "Tạo dữ liệu mẫu" button makes). */
export async function createSampleData(api: AppApi): Promise<string[]> {
  const result = await api.send<{ created: string[] }>('POST', '/api/sample-data');
  return result.created;
}

/**
 * Back to a fresh vault: removes the sample set (unchanged files), trashes every other user note
 * still there (edited sample files, captures, daily notes, notes made from templates) and deletes
 * the sample manifest, so the first-run offer is made again.
 */
export async function resetVault(api: AppApi): Promise<void> {
  const status = await api.get<{ present: boolean }>('/api/sample-data');
  if (status.present) await api.send('DELETE', '/api/sample-data');
  const tree = await api.get<VaultTree>('/api/tree');
  const leftovers = treeFiles(tree)
    .filter((file) => file.isNote && file.class !== 'template' && file.class !== 'control')
    .map((file) => file.path);
  await trashPaths(api, leftovers);
  const manifest = path.join(e2eVaultDir(), '.secondbrain', 'state', 'sample.json');
  if (existsSync(manifest)) rmSync(manifest);
  await expect
    .poll(async () => (await api.get<{ offered: boolean }>('/api/sample-data')).offered)
    .toBe(true);
}
