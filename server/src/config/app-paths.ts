import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Directory layout of an install:
 *   <home>/                 e.g. D:\SECONDBRAIN
 *   <home>/.secondbrain/    global settings, logs, runtime info
 *   <home>/app/             source code (this repository)
 *   <home>/app/web/dist/    built UI
 *
 * This file lives at app/server/src/config/ (tsx) or app/server/dist/config/ (built),
 * so the app directory is always three levels up.
 */
export function resolveAppDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', '..');
}

export interface AppPaths {
  appDir: string;
  homeDir: string;
  globalStateDir: string;
  settingsFile: string;
  serverInfoFile: string;
  logsDir: string;
  webDir: string;
  webDistDir: string;
}

export function resolveAppPaths(homeOverride?: string, appDir = resolveAppDir()): AppPaths {
  const homeDir = path.resolve(homeOverride ?? path.dirname(appDir));
  const globalStateDir = path.join(homeDir, '.secondbrain');
  const webDir = path.join(appDir, 'web');
  return {
    appDir,
    homeDir,
    globalStateDir,
    settingsFile: path.join(globalStateDir, 'settings.json'),
    serverInfoFile: path.join(globalStateDir, 'server.json'),
    logsDir: path.join(globalStateDir, 'logs'),
    webDir,
    webDistDir: path.join(webDir, 'dist'),
  };
}
