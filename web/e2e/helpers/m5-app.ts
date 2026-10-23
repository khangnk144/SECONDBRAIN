/// <reference lib="dom" />
// Helpers of the Bento and M5 specs (F35, F24–F31): notes written through the API of an own
// server, files read from its vault, the shell's landmarks, the "no sideways scroll" and
// "one primary button" checks, console errors and the intro classes of Bento Today.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { AppApi } from './app-api.js';
import type { OwnServer } from './own-server.js';

/** Creates a note through `POST /api/note` (the app's own write path). */
export async function createNote(api: AppApi, notePath: string, content: string): Promise<void> {
  await api.send('POST', '/api/note', { path: notePath, content });
}

/** Replaces a note's text through `PUT /api/note` with its current revision. */
export async function rewriteNote(api: AppApi, notePath: string, content: string): Promise<void> {
  const note = await api.get<{ revision: string }>(
    `/api/note?path=${encodeURIComponent(notePath)}`,
  );
  await api.send('PUT', '/api/note', { path: notePath, content, expectedRevision: note.revision });
}

export const vaultFile = (server: OwnServer, notePath: string) =>
  path.join(server.vaultDir, ...notePath.split('/'));

export function readVault(server: OwnServer, notePath: string): string | null {
  const file = vaultFile(server, notePath);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/** The rail (bento), the bottom tab bar (phones) and the calm sidebar share this name. */
export const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Điều hướng chính' });

/** How far the page and the body reach beyond the window sideways (0 = no horizontal scroll). */
export function sidewaysOverflow(page: Page): Promise<{ page: number; body: number }> {
  return page.evaluate(() => ({
    page: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    body: Math.max(0, document.body.scrollWidth - document.documentElement.clientWidth),
  }));
}

export async function expectNoSidewaysScroll(page: Page, where: string): Promise<void> {
  expect(await sidewaysOverflow(page), `no horizontal page scroll: ${where}`).toEqual({
    page: 0,
    body: 0,
  });
}

/** Visible primary buttons (`.button--primary`), by name. At most one per screen (F35.3). */
export function visiblePrimaries(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.button--primary')]
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden';
      })
      .map((el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim()),
  );
}

/** Errors the page logs or throws from now on (the list fills while the test runs). */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

/** Computed value of a CSS custom property on `<html>`, resolved to a colour by the browser. */
export function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}

/**
 * Records every element that carried one of Bento Today's intro classes (F35.8), from the very
 * first paint: `window.__intro` lists `strip`, `rings`, `bars` as they appear.
 */
export async function recordIntroClasses(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen = new Set<string>();
    (window as unknown as { __intro: Set<string> }).__intro = seen;
    const look = () => {
      if (document.querySelector('.today-strip--bento.is-intro')) seen.add('strip');
      if (document.querySelector('.today-rings.is-intro')) seen.add('rings');
      if (document.querySelector('.today-bars.is-intro')) seen.add('bars');
    };
    new MutationObserver(look).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  });
}

export const introSeen = (page: Page) =>
  page.evaluate(() => [...(window as unknown as { __intro: Set<string> }).__intro].sort());

export const isoNow = () => new Date().toISOString();
