import path from 'node:path';

/**
 * How this process runs (F29.4): `exe` when started by the single executable's bootstrap
 * (`scripts/lib/build-exe/sea-bootstrap.ts` sets `SB_RUNTIME=exe` and `SB_EXE_PATH`), else
 * `source` (`node server/dist/index.js`, the launcher, `npm run dev`).
 */
export type RuntimeKind = 'exe' | 'source';

export interface RuntimeInfo {
  runtime: RuntimeKind;
  /** Absolute path of the executable in exe mode, else null. */
  exePath: string | null;
}

export function runtimeInfo(env: NodeJS.ProcessEnv = process.env): RuntimeInfo {
  const exePath = env.SB_EXE_PATH;
  if (
    env.SB_RUNTIME === 'exe' &&
    exePath &&
    (path.isAbsolute(exePath) || path.win32.isAbsolute(exePath))
  ) {
    return { runtime: 'exe', exePath };
  }
  return { runtime: 'source', exePath: null };
}
