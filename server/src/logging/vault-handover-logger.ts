import {
  createFileLogger,
  type AppLogger,
  type FileLoggerOptions,
} from './rotating-file-logger.js';

/**
 * Logger that starts in the global log (`<home>/.secondbrain/logs/server.log`, the file the
 * launcher shows when startup fails) and moves into the vault (`.secondbrain/logs/app.log`)
 * once a vault is open, as SPEC §5 asks. Errors keep being copied to the global log so a
 * failure after the move (e.g. the port is busy) is still visible to the launcher.
 */
export interface VaultHandoverLogger extends AppLogger {
  /** Sends further lines to `<logsDir>/app.log`; leaves a pointer line in the global log. */
  moveToVault(logsDir: string): void;
}

export function isVaultHandoverLogger(logger: AppLogger): logger is VaultHandoverLogger {
  return typeof (logger as Partial<VaultHandoverLogger>).moveToVault === 'function';
}

export type HandoverLoggerOptions = Omit<FileLoggerOptions, 'fileName'>;

export function createVaultHandoverLogger(options: HandoverLoggerOptions): VaultHandoverLogger {
  const globalLog = createFileLogger({ ...options, fileName: 'server.log' });
  // Same file, never echoed: the vault logger already echoes the line in dev mode.
  const globalMirror = createFileLogger({ ...options, fileName: 'server.log', echo: false });
  let vaultLog: AppLogger | null = null;

  return {
    get file() {
      return (vaultLog ?? globalLog).file;
    },
    info: (message) => (vaultLog ?? globalLog).info(message),
    warn: (message) => (vaultLog ?? globalLog).warn(message),
    error: (message) => {
      if (!vaultLog) return globalLog.error(message);
      vaultLog.error(message);
      globalMirror.error(message);
    },
    moveToVault(logsDir) {
      const next = createFileLogger({ ...options, dir: logsDir, fileName: 'app.log' });
      globalMirror.info(`Vault opened; further log lines go to ${next.file ?? logsDir}.`);
      vaultLog = next;
    },
  };
}
