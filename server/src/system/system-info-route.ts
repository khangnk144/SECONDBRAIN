/**
 * `GET /api/system` (F29.2, F29.4): how the app runs and the tray helper's state, for Settings
 * "Ứng dụng"; `POST /api/system/shortcuts` re-creates the Desktop and Start-menu shortcuts
 * ("Tạo lại lối tắt trên màn hình", exe on Windows only). The running server registers what it
 * owns (tray helper, shortcut writer) through `provideSystemStatus`; without it (API-only
 * tests, the first milliseconds after listen) the route answers from the environment alone.
 */
import type { FastifyInstance } from 'fastify';
import { errorCodeOf } from '../app-context/app-context-errors.js';
import { ApiError } from '../http/api-errors.js';
import { runtimeInfo, type RuntimeKind } from './runtime-info.js';
import { TRAY_HOTKEY, type TrayStatus } from './tray-helper.js';

export interface SystemStatusSource {
  tray(): TrayStatus;
  /** Exe on Windows only. */
  recreateShortcuts?: () => Promise<void>;
}

export interface SystemInfo {
  runtime: RuntimeKind;
  exePath: string | null;
  platform: 'windows' | 'other';
  tray: TrayStatus;
  /** "Tạo lại lối tắt" can run. */
  shortcuts: { supported: boolean };
}

let source: SystemStatusSource | null = null;

/** Registers the running server's parts; the returned function unregisters them. */
export function provideSystemStatus(next: SystemStatusSource): () => void {
  source = next;
  return () => {
    if (source === next) source = null;
  };
}

export interface SystemInfoOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

export function systemInfo(options: SystemInfoOptions = {}): SystemInfo {
  const platform = options.platform ?? process.platform;
  const { runtime, exePath } = runtimeInfo(options.env ?? process.env);
  const tray: TrayStatus = source?.tray() ?? {
    state: platform === 'win32' ? 'off' : 'unsupported',
    hotkey: TRAY_HOTKEY,
    hotkeyRegistered: null,
  };
  return {
    runtime,
    exePath,
    platform: platform === 'win32' ? 'windows' : 'other',
    tray,
    shortcuts: {
      supported: runtime === 'exe' && platform === 'win32' && !!source?.recreateShortcuts,
    },
  };
}

export function registerSystemInfoRoutes(app: FastifyInstance, options: SystemInfoOptions = {}) {
  app.get('/api/system', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return systemInfo(options);
  });

  app.post('/api/system/shortcuts', async (_request, reply) => {
    const recreate = systemInfo(options).shortcuts.supported ? source?.recreateShortcuts : null;
    if (!recreate) {
      throw new ApiError(409, 'VALIDATION', 'Shortcuts are only made by the Windows executable.', {
        reason: 'not-exe',
      });
    }
    try {
      await recreate();
    } catch (error) {
      throw new ApiError(500, 'WRITE_FAILED', 'Windows did not let the app create the shortcuts.', {
        reason: 'shortcut-failed',
        cause: errorCodeOf(error),
      });
    }
    return reply.code(204).send();
  });
}
