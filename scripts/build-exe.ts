/**
 * `npm run build:exe` (SPEC F29.1): one executable with the server, the built UI, the
 * production packages and the native SQLite addon, made from the `node` running this script.
 *   tsx scripts/build-exe.ts [--skip-build] [--out <dir>]
 *   (testing the Windows steps elsewhere: --target win32 --node <node.exe of the same version>)
 * Output: dist-exe/Second Brain.exe (Windows) or dist-exe/second-brain (Linux).
 */
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { currentTarget, type TargetPlatform } from './lib/build-exe/dependency-closure.js';
import { buildNeededReason, runAppBuild } from './lib/build-exe/ensure-app-build.js';
import { makeSea } from './lib/build-exe/make-sea.js';
import { packPayload } from './lib/build-exe/payload-pack.js';
import { collectRuntimeEntries } from './lib/build-exe/runtime-entries.js';
import { buildIco } from './lib/build-exe/windows-resources.js';
import { appRoot, isMainModule } from './lib/script-utils.js';

export function exeFileName(os: NodeJS.Platform): string {
  return os === 'win32' ? 'Second Brain.exe' : 'second-brain';
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export async function buildExe(argv: string[]): Promise<string> {
  const { values } = parseArgs({
    args: argv,
    options: {
      'skip-build': { type: 'boolean', default: false },
      out: { type: 'string' },
      target: { type: 'string' },
      node: { type: 'string' },
    },
  });
  const started = Date.now();
  const lap = (label: string) =>
    console.log(`  ${label} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  const target: TargetPlatform =
    values.target === 'win32'
      ? { os: 'win32', cpu: 'x64' }
      : values.target === undefined
        ? currentTarget()
        : (() => {
            throw new Error(`Unsupported --target ${values.target} (only win32).`);
          })();
  if (target.os !== 'win32' && target.os !== 'linux') {
    throw new Error(`Building the executable on ${target.os} is not supported (Windows, Linux).`);
  }

  if (!values['skip-build']) {
    const reason = buildNeededReason(appRoot);
    if (reason) {
      console.log(`Building the app first: ${reason}.`);
      runAppBuild(appRoot);
    }
  } else if (buildNeededReason(appRoot)?.endsWith('missing')) {
    throw new Error('Run npm run build first (--skip-build was given).');
  }

  const { entries, closure } = collectRuntimeEntries(appRoot, target);
  console.log(`Production packages (${closure.packages.length}):`);
  for (const pkg of closure.packages) console.log(`  ${pkg.name}@${pkg.version}  ${pkg.rel}`);
  if (closure.skipped.length > 0) console.log(`  skipped: ${closure.skipped.join(', ')}`);
  const packed = packPayload(entries);
  lap(`payload: ${packed.files} files, ${mb(packed.bytes)} → ${mb(packed.payload.length)}`);

  const outDir = path.resolve(values.out ?? path.join(appRoot, 'dist-exe'));
  const stageDir = path.join(outDir, 'stage');
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });
  const output = path.join(outDir, exeFileName(target.os));
  const version = (
    JSON.parse(readFileSync(path.join(appRoot, 'server/package.json'), 'utf8')) as {
      version: string;
    }
  ).version;
  await makeSea({
    stageDir,
    payload: packed.payload,
    hash: packed.hash,
    nodeBinary: path.resolve(values.node ?? process.execPath),
    output,
    targetOs: target.os,
    identity: {
      version,
      fileName: exeFileName('win32'),
      ico: buildIco([readFileSync(path.join(appRoot, 'web/public/icons/icon-192.png'))]),
    },
  });
  rmSync(stageDir, { recursive: true, force: true });
  lap(`executable: ${output} (${mb(statSync(output).size)}), payload ${packed.hash.slice(0, 16)}`);
  return output;
}

if (isMainModule(import.meta.url)) {
  buildExe(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
