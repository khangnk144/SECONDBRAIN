/**
 * Turns the payload into one executable with Node's single-executable support (F29.1):
 * bootstrap → CommonJS, SEA config (no snapshot, no code cache, payload + hash as assets),
 * `node --experimental-sea-config`, a copy of the node binary, (Windows) icon and version info,
 * `postject` with the SEA fuse, (Windows) GUI subsystem so no console window opens.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { setGuiSubsystem } from './pe-subsystem.js';
import { HASH_ASSET, PAYLOAD_ASSET } from './sea-runtime-store.js';
import { applyWindowsResources, type ExeIdentity } from './windows-resources.js';

export const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
export const SEA_RESOURCE = 'NODE_SEA_BLOB';

type PostjectInject = (
  file: string,
  resource: string,
  data: Buffer,
  options: { sentinelFuse: string; overwrite?: boolean },
) => Promise<void>;

export interface SeaInput {
  /** Work folder for the generated files (bootstrap, config, blob, payload). */
  stageDir: string;
  payload: Buffer;
  hash: string;
  /** Node binary to copy (default: the one running this build, same version as the blob). */
  nodeBinary: string;
  output: string;
  targetOs: NodeJS.Platform;
  /** Windows only. */
  identity?: ExeIdentity;
}

const STORE_REQUIRE = 'require("./sea-runtime-store.js")';

function toCommonJs(file: string): string {
  return ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: path.basename(file),
  }).outputText;
}

/**
 * The bootstrap as one CommonJS file: `sea-bootstrap.ts` with `sea-runtime-store.ts` inlined
 * as a module function. The result may only `require` Node built-ins (checked here).
 */
export function transpileBootstrap(bootstrapFile: string): string {
  const store = toCommonJs(path.join(path.dirname(bootstrapFile), 'sea-runtime-store.ts'));
  const main = toCommonJs(bootstrapFile);
  if (!main.includes(STORE_REQUIRE))
    throw new Error('The bootstrap must import sea-runtime-store.');
  const output = [
    '"use strict";',
    'const __seaRuntimeStore = (() => {',
    '  const module = { exports: {} };',
    '  const exports = module.exports;',
    store,
    '  return module.exports;',
    '})();',
    main.replace(STORE_REQUIRE, '__seaRuntimeStore'),
  ].join('\n');
  const requires = [...output.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]);
  const foreign = requires.filter((name) => !name?.startsWith('node:'));
  if (foreign.length > 0) throw new Error(`The bootstrap requires ${foreign.join(', ')}.`);
  return output;
}

export function seaConfig(stageDir: string): Record<string, unknown> {
  return {
    main: path.join(stageDir, 'sea-main.cjs'),
    output: path.join(stageDir, 'sea-prep.blob'),
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    assets: {
      [PAYLOAD_ASSET]: path.join(stageDir, PAYLOAD_ASSET),
      [HASH_ASSET]: path.join(stageDir, HASH_ASSET),
    },
  };
}

export async function makeSea(input: SeaInput): Promise<void> {
  const { stageDir } = input;
  const bootstrap = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sea-bootstrap.ts');
  writeFileSync(path.join(stageDir, 'sea-main.cjs'), transpileBootstrap(bootstrap));
  writeFileSync(path.join(stageDir, PAYLOAD_ASSET), input.payload);
  writeFileSync(path.join(stageDir, HASH_ASSET), `${input.hash}\n`);
  const configFile = path.join(stageDir, 'sea-config.json');
  writeFileSync(configFile, `${JSON.stringify(seaConfig(stageDir), null, 2)}\n`);

  const blob = spawnSync(process.execPath, ['--experimental-sea-config', configFile], {
    cwd: stageDir,
    encoding: 'utf8',
  });
  if (blob.status !== 0) {
    throw new Error(`node --experimental-sea-config failed: ${blob.stderr || blob.stdout}`);
  }

  rmSync(input.output, { force: true });
  copyFileSync(input.nodeBinary, input.output);
  if (input.targetOs === 'win32') {
    if (!input.identity) throw new Error('The Windows build needs the icon and version.');
    writeFileSync(input.output, applyWindowsResources(readFileSync(input.output), input.identity));
  }
  const { inject } = createRequire(import.meta.url)('postject') as { inject: PostjectInject };
  await inject(input.output, SEA_RESOURCE, readFileSync(path.join(stageDir, 'sea-prep.blob')), {
    sentinelFuse: SEA_FUSE,
  });
  if (input.targetOs === 'win32') {
    const image = readFileSync(input.output);
    setGuiSubsystem(image);
    writeFileSync(input.output, image);
  } else {
    chmodSync(input.output, 0o755);
  }
}
