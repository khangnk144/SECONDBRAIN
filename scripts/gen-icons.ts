/**
 * Renders the PWA icons from web/public/favicon.svg with Playwright's Chromium.
 * Usage: tsx scripts/gen-icons.ts   (writes web/public/icons/*.png; commit the result)
 *
 * The favicon is the single source of the artwork and its colors: the "any" icons are the
 * favicon itself (rounded tile, transparent corners); the maskable and Apple icons fill the
 * whole square with the tile color, because the OS cuts its own shape out of them. The marks
 * already sit inside the maskable safe zone (a centered circle of 40 % of the size), so they
 * are not scaled.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import { appRoot, isMainModule } from './lib/script-utils.js';

export interface IconSpec {
  file: string;
  size: number;
  variant: 'any' | 'full-bleed';
}

export const ICONS: IconSpec[] = [
  { file: 'icon-192.png', size: 192, variant: 'any' },
  { file: 'icon-512.png', size: 512, variant: 'any' },
  { file: 'icon-maskable-512.png', size: 512, variant: 'full-bleed' },
  { file: 'apple-touch-icon.png', size: 180, variant: 'full-bleed' },
];

const TILE = /<rect\b[^>]*\brx="[^"]+"[^>]*\/>/;

/** Splits the favicon into its rounded background tile and the marks drawn on top of it. */
export function parseFavicon(svg: string): { viewBox: string; tileFill: string; marks: string } {
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
  const tile = TILE.exec(svg)?.[0];
  const tileFill = tile ? /\bfill="([^"]+)"/.exec(tile)?.[1] : undefined;
  if (!viewBox || !tile || !tileFill) {
    throw new Error('favicon.svg must have a viewBox and a rounded background <rect rx fill>.');
  }
  const inner = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>'));
  return { viewBox, tileFill, marks: inner.replace(tile, '').trim() };
}

/** The SVG for one icon variant, sized to `size` CSS pixels. */
export function iconSvg(favicon: string, variant: IconSpec['variant'], size: number): string {
  const { viewBox, tileFill, marks } = parseFavicon(favicon);
  const [x = '0', y = '0', w = '64', h = '64'] = viewBox.split(/\s+/);
  const background =
    variant === 'any'
      ? (TILE.exec(favicon)?.[0] ?? '')
      : `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${tileFill}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${size}" height="${size}">` +
    `${background}${marks}</svg>`
  );
}

/** Playwright finds its browsers itself; this fallback covers a browsers folder of another revision. */
function findChromiumExecutable(): string | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  const candidates = readdirSync(root)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort()
    .reverse()
    .flatMap((name) => [
      path.join(root, name, 'chrome-linux', 'chrome'),
      path.join(root, name, 'chrome-win', 'chrome.exe'),
      path.join(root, name, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    ]);
  return candidates.find((file) => existsSync(file));
}

async function launchChromium(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch (error) {
    const executablePath = findChromiumExecutable();
    if (!executablePath) throw error;
    return chromium.launch({ executablePath });
  }
}

export async function generateIcons(root = appRoot): Promise<string[]> {
  const publicDir = path.join(root, 'web', 'public');
  const favicon = await readFile(path.join(publicDir, 'favicon.svg'), 'utf8');
  const outDir = path.join(publicDir, 'icons');
  mkdirSync(outDir, { recursive: true });
  const browser = await launchChromium();
  const written: string[] = [];
  try {
    for (const icon of ICONS) {
      const page = await browser.newPage({
        viewport: { width: icon.size, height: icon.size },
        deviceScaleFactor: 1,
      });
      const svg = iconSvg(favicon, icon.variant, icon.size);
      await page.setContent(
        `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`,
      );
      const png = await page.screenshot({
        omitBackground: true,
        clip: { x: 0, y: 0, width: icon.size, height: icon.size },
      });
      await page.close();
      const file = path.join(outDir, icon.file);
      writeFileSync(file, png);
      written.push(file);
    }
  } finally {
    await browser.close();
  }
  return written;
}

if (isMainModule(import.meta.url)) {
  generateIcons()
    .then((files) => {
      for (const file of files) console.log(`wrote ${path.relative(appRoot, file)}`);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
