/** `GET /api/system`, mirrored by hand from `server/src/system/system-info-route.ts` (F29). */

export type TrayState = 'running' | 'off' | 'unsupported' | 'failed';

export interface SystemInfo {
  /** `exe` = the single executable, `source` = node / the launcher. */
  runtime: 'exe' | 'source';
  exePath: string | null;
  platform: 'windows' | 'other';
  tray: {
    state: TrayState;
    hotkey: string;
    /** null until the tray helper reported (or while it does not run). */
    hotkeyRegistered: boolean | null;
  };
  /** "Tạo lại lối tắt trên màn hình" can run (exe on Windows). */
  shortcuts: { supported: boolean };
}
