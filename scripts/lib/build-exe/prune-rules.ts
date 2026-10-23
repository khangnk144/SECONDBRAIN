/**
 * What the executable leaves out of each package (F29.1: "skip docs/tests/maps where safe").
 * Only files nothing loads at run time: documentation, source maps, type declarations, test and
 * example folders, TypeScript sources next to the built JavaScript, and native binaries or
 * helper programs for other platforms. License files are always kept.
 */
import type { TargetPlatform } from './dependency-closure.js';

/** Top-level package folders that hold no run-time code. */
const SKIPPED_TOP_DIRS = new Set([
  '.github',
  '.vscode',
  '.idea',
  '__tests__',
  'benchmark',
  'benchmarks',
  'coverage',
  'doc',
  'docs',
  'example',
  'examples',
  'test',
  'tests',
]);

const LICENSE_NAME = /^(licen[cs]e|copying|notice)([.-].*)?$/i;
const SKIPPED_FILE =
  /\.(map|md|markdown|tsbuildinfo)$|\.d\.[cm]?ts$|^\.(npmignore|editorconfig)$|^\.(eslintrc|prettierrc)/i;
/** TypeScript sources (`.ts`, `.mts`, `.cts`); Node runs the built JavaScript beside them. */
const TS_SOURCE = /\.[cm]?ts$/i;

/** Generic rule for a file inside a package (`rel` = path inside the package, POSIX). */
export function keepPackageFile(rel: string): boolean {
  const parts = rel.split('/');
  const name = parts[parts.length - 1] ?? '';
  if (parts.includes('node_modules')) return false; // nested packages are closure entries
  if (LICENSE_NAME.test(name)) return true;
  if (parts.length > 1 && SKIPPED_TOP_DIRS.has(parts[0] ?? '')) return false;
  if (SKIPPED_FILE.test(name)) return false;
  if (TS_SOURCE.test(name)) return false;
  return true;
}

/** `prebuilds/<platform>-<arch>…` folders or files of other machines are dropped. */
function keepPrebuild(rel: string, target: TargetPlatform): boolean {
  const parts = rel.split('/');
  if (parts[0] !== 'prebuilds' || parts.length < 2) return true;
  const entry = parts[1] ?? '';
  const prefixes = [`${target.os}-${target.cpu}`];
  if (target.os === 'linux') prefixes.push(`linuxmusl-${target.cpu}`);
  return prefixes.some((prefix) => entry === prefix || entry.startsWith(`${prefix}.`));
}

type PackageRule = (rel: string, target: TargetPlatform) => boolean;

/** Package-specific rules (`true` = keep), checked after the generic ones. */
const PACKAGE_RULES: Record<string, PackageRule> = {
  // The addon ships as `prebuilds/<platform>-<arch>.node`; the SQLite sources and the build
  // folder (left by a source build) are not loaded. A `build/Release/*.node` from a local build
  // is kept so `bindings`-style lookups still find it.
  'better-sqlite3': (rel) =>
    !rel.startsWith('deps/') &&
    !rel.startsWith('src/') &&
    (!rel.startsWith('build/') || rel.endsWith('.node')),
  // The server only imports `legacy/build/pdf.mjs` (text extraction); the modern build, the
  // viewer and the declarations are for browsers and type checking.
  'pdfjs-dist': (rel) =>
    !rel.startsWith('build/') &&
    !rel.startsWith('web/') &&
    !rel.startsWith('legacy/web/') &&
    !rel.startsWith('types/') &&
    !rel.startsWith('image_decoders/'),
  // Toast helpers: SnoreToast and Notifu are Windows programs, terminal-notifier is macOS.
  'node-notifier': (rel, target) => {
    if (rel.startsWith('vendor/mac.noindex/')) return target.os === 'darwin';
    if (rel.startsWith('vendor/snoreToast/') || rel.startsWith('vendor/notifu/')) {
      return target.os === 'win32';
    }
    return true;
  },
};

/**
 * Packages the server never needs at run time although a dependency lists them: pdf.js loads
 * `@napi-rs/canvas` only to draw pages; text extraction works without it (pdf.js logs a warning
 * inside the extraction worker, whose console is discarded).
 */
export const RUNTIME_UNUSED_PACKAGES = ['@napi-rs/canvas'] as const;

export function keepFileOfPackage(name: string, rel: string, target: TargetPlatform): boolean {
  if (!keepPackageFile(rel)) return false;
  if (!keepPrebuild(rel, target)) return false;
  const rule = PACKAGE_RULES[name];
  return rule ? rule(rel, target) : true;
}
