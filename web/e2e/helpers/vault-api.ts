/// <reference lib="dom" />
// Test helpers that talk to the running e2e server through its REST API (with the session token
// read from the served shell) and to its temporary vault on disk. Never used against a real vault.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

/** Vault folder of the e2e server (playwright.config.ts gives it a fresh temporary home). */
export function e2eVaultDir(): string {
  const home = process.env.SB_E2E_HOME;
  if (!home) throw new Error('SB_E2E_HOME is not set (run through playwright.config.ts)');
  return path.join(home, 'vault');
}

export async function sessionToken(page: Page): Promise<string> {
  if (page.url() === 'about:blank') await page.goto('/');
  const token = await page.locator('meta[name="sb-token"]').getAttribute('content');
  if (!token) throw new Error('no session token in the shell');
  return token;
}

/** Notes a test created (directly or through the UI); `cleanupNotes` trashes them afterwards. */
const createdNotes = new Set<string>();

export function trackNote(notePath: string): void {
  createdNotes.add(notePath);
}

/**
 * Moves every tracked note that still exists to the trash, so a repeated run of the same test
 * starts from the same vault (the e2e server keeps one vault for the whole run).
 */
export async function cleanupNotes(page: Page): Promise<void> {
  const paths = [...createdNotes];
  createdNotes.clear();
  if (paths.length === 0) return;
  const api = await vaultApi(page);
  const existing: { path: string; revision: string }[] = [];
  for (const notePath of paths) {
    const note = await api.tryRead(notePath);
    if (note) existing.push({ path: notePath, revision: note.revision });
  }
  if (existing.length === 0) return;
  const token = await sessionToken(page);
  const response = await page.request.post('/api/note/trash', {
    headers: { 'X-SB-Token': token, Origin: new URL(page.url()).origin },
    data: {
      paths: existing.map((note) => note.path),
      expectedRevisions: existing.map((note) => note.revision),
    },
  });
  expect(response.status(), await response.text()).toBe(200);
}

export interface VaultApi {
  createNote(notePath: string, content: string): Promise<{ path: string; revision: string }>;
  readNote(notePath: string): Promise<{ content: string; revision: string }>;
  writeNote(notePath: string, content: string, expectedRevision: string): Promise<string>;
  tryRead(notePath: string): Promise<{ content: string; revision: string } | null>;
}

export async function vaultApi(page: Page): Promise<VaultApi> {
  const token = await sessionToken(page);
  const request: APIRequestContext = page.request;
  const headers = { 'X-SB-Token': token, Origin: new URL(page.url()).origin };
  const read = async (notePath: string) => {
    const response = await request.get(`/api/note?path=${encodeURIComponent(notePath)}`, {
      headers,
    });
    return response;
  };
  return {
    async createNote(notePath, content) {
      const response = await request.post('/api/note', {
        headers,
        data: { path: notePath, content },
      });
      expect(response.status(), await response.text()).toBe(201);
      trackNote(notePath);
      return (await response.json()) as { path: string; revision: string };
    },
    async readNote(notePath) {
      const response = await read(notePath);
      expect(response.status(), await response.text()).toBe(200);
      return (await response.json()) as { content: string; revision: string };
    },
    async tryRead(notePath) {
      const response = await read(notePath);
      if (response.status() === 404) return null;
      expect(response.status(), await response.text()).toBe(200);
      return (await response.json()) as { content: string; revision: string };
    },
    async writeNote(notePath, content, expectedRevision) {
      const response = await request.put('/api/note', {
        headers,
        data: { path: notePath, content, expectedRevision },
      });
      expect(response.status(), await response.text()).toBe(200);
      return ((await response.json()) as { revision: string }).revision;
    },
  };
}

/** Trash entries (meta.json) of the e2e vault, newest last. */
export function trashEntries(): { reason: string; originalPaths: string[]; dir: string }[] {
  const trash = path.join(e2eVaultDir(), '.secondbrain', 'trash');
  let ids: string[];
  try {
    ids = readdirSync(trash).sort();
  } catch {
    return [];
  }
  return ids.map((id) => {
    const meta = JSON.parse(readFileSync(path.join(trash, id, 'meta.json'), 'utf8')) as {
      reason: string;
      originalPaths: string[];
    };
    return { ...meta, dir: path.join(trash, id) };
  });
}
