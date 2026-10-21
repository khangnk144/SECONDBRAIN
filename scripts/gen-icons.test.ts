// The PWA manifest, the generated icons and the shell links must agree (F21.3 "manifest valid").
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ICONS, iconSvg, parseFavicon } from './gen-icons.js';
import { appRoot } from './lib/script-utils.js';

const publicDir = path.join(appRoot, 'web', 'public');
const favicon = readFileSync(path.join(publicDir, 'favicon.svg'), 'utf8');

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

const manifest = JSON.parse(readFileSync(path.join(publicDir, 'manifest.webmanifest'), 'utf8')) as {
  icons: ManifestIcon[];
  [key: string]: unknown;
};

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** The dark theme's --bg from tokens.css (the first :root block). */
function darkBackgroundToken(): string {
  const css = readFileSync(path.join(appRoot, 'web', 'src', 'styles', 'tokens.css'), 'utf8');
  const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  return /--bg:\s*(#[0-9a-fA-F]{6})/.exec(root)?.[1] ?? '';
}

describe('web app manifest (F21.3)', () => {
  it('describes a standalone app scoped to the origin with relative URLs only', () => {
    expect(manifest).toMatchObject({
      id: '/',
      name: 'Second Brain',
      short_name: 'Second Brain',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      lang: 'vi',
      launch_handler: { client_mode: 'focus-existing' },
    });
    // A changed port keeps working: nothing names a host or port.
    expect(JSON.stringify(manifest)).not.toMatch(/https?:|localhost|4747/);
  });

  it('uses the dark background token as theme and background color', () => {
    const bg = darkBackgroundToken();
    expect(bg.toLowerCase()).toBe('#1c1622');
    expect(String(manifest.theme_color).toLowerCase()).toBe(bg.toLowerCase());
    expect(String(manifest.background_color).toLowerCase()).toBe(bg.toLowerCase());
  });

  it('lists 192 and 512 icons for any purpose plus a 512 maskable one, all present', () => {
    const summary = manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose}`);
    expect(summary).toEqual(['192x192 any', '512x512 any', '512x512 maskable']);
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png');
      expect(icon.src.startsWith('/icons/')).toBe(true);
      const file = path.join(publicDir, ...icon.src.split('/'));
      const [width, height] = icon.sizes.split('x').map(Number);
      expect(pngSize(file), icon.src).toEqual({ width, height });
    }
  });

  it('is linked from the shell with the theme color and the Apple icon', () => {
    const html = readFileSync(path.join(appRoot, 'web', 'index.html'), 'utf8');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain(`<meta name="theme-color" content="${String(manifest.theme_color)}" />`);
    const apple = /<link rel="apple-touch-icon" href="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(existsSync(path.join(publicDir, ...apple.split('/')))).toBe(true);
    expect(pngSize(path.join(publicDir, ...apple.split('/')))).toEqual({ width: 180, height: 180 });
  });
});

describe('icon generator', () => {
  it('generates every icon the manifest and the shell use', () => {
    const generated = ICONS.map((icon) => `/icons/${icon.file}`);
    for (const icon of manifest.icons) expect(generated).toContain(icon.src);
    expect(generated).toContain('/icons/apple-touch-icon.png');
  });

  it('keeps the favicon artwork; the full-bleed variant fills the square with the tile color', () => {
    const { viewBox, tileFill, marks } = parseFavicon(favicon);
    expect(viewBox).toBe('0 0 64 64');
    expect(marks).toContain('<circle');
    expect(marks).not.toContain('<rect');
    const any = iconSvg(favicon, 'any', 192);
    expect(any).toContain('rx="14"');
    expect(any).toContain('width="192" height="192"');
    const fullBleed = iconSvg(favicon, 'full-bleed', 512);
    expect(fullBleed).not.toContain('rx=');
    expect(fullBleed).toContain(`<rect x="0" y="0" width="64" height="64" fill="${tileFill}"/>`);
    expect(fullBleed).toContain(marks);
  });

  it('refuses a favicon without a rounded background tile', () => {
    expect(() => parseFavicon('<svg viewBox="0 0 1 1"><circle r="1"/></svg>')).toThrow(/rounded/);
  });
});
