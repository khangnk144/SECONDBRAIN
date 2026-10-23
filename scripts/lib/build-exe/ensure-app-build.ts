/**
 * The executable packs `server/dist` and `web/dist` (F29.1): they must exist and be newer than
 * every source they come from (same inputs as the launcher's build check), else `npm run build`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { listTree } from './runtime-entries.js';

const OUTPUTS = ['server/dist/index.js', 'server/dist/mcp-stdio.js', 'web/dist/index.html'];
const SOURCE_DIRS = ['server/src', 'web/src', 'web/public'];
const SOURCE_FILES = [
  'web/index.html',
  'web/vite.config.ts',
  'web/vite-plugin-service-worker.ts',
  'server/tsconfig.build.json',
  'package-lock.json',
];

/** Why a build is needed, or null when the built files are current. */
export function buildNeededReason(rootDir: string): string | null {
  const outputs = OUTPUTS.map((rel) => path.join(rootDir, rel));
  const missing = outputs.find((file) => !existsSync(file));
  if (missing) return `${path.relative(rootDir, missing)} is missing`;
  const builtAt = Math.min(...outputs.map((file) => statSync(file).mtimeMs));
  const sources = [
    ...SOURCE_DIRS.flatMap((dir) => {
      const full = path.join(rootDir, dir);
      return existsSync(full) ? listTree(full).map((rel) => path.join(full, rel)) : [];
    }),
    ...SOURCE_FILES.map((rel) => path.join(rootDir, rel)).filter((file) => existsSync(file)),
  ];
  const newer = sources.find((file) => statSync(file).mtimeMs > builtAt);
  return newer ? `${path.relative(rootDir, newer)} changed after the last build` : null;
}

/** Runs `npm run build` in the app folder with the npm that started this script, if known. */
export function runAppBuild(rootDir: string): void {
  // `npx tsx scripts/build-exe.ts` sets npx-cli.js; npm-cli.js sits next to it.
  const npmCli = process.env.npm_execpath?.replace(/npx-cli\.js$/, 'npm-cli.js');
  const result = npmCli?.endsWith('npm-cli.js')
    ? spawnSync(process.execPath, [npmCli, 'run', 'build'], { cwd: rootDir, stdio: 'inherit' })
    : // npm.cmd needs a shell on Windows (Node refuses to start .cmd files without one).
      spawnSync('npm', ['run', 'build'], {
        cwd: rootDir,
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
  if (result.status !== 0) throw new Error(`npm run build failed (exit ${result.status}).`);
}
