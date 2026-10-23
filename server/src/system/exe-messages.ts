/**
 * Texts the executable shows itself (F29.1): the Windows build has no console, so a start that
 * cannot go on says why in one message box, in the UI language of `settings.json`. Kept on the
 * server like the reminder toast texts: no app window may be open yet.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export type ExeLanguage = 'vi' | 'en';

export const EXE_MESSAGES = {
  vi: {
    portBusy: (port: number) =>
      `Cổng ${port} đang bị một chương trình khác dùng. Đóng chương trình đó, hoặc đổi cổng trong Cài đặt của Second Brain rồi mở lại.`,
    otherInstance: (port: number) =>
      `Cổng ${port} đang được một Second Brain khác dùng (của thư mục khác). Thoát bản đó rồi mở lại bản này.`,
    vaultUnusable: (log: string) =>
      `Chưa mở được thư mục ghi chú. Kiểm tra thư mục còn đó và bạn có quyền ghi vào nó, rồi mở lại. Chi tiết trong nhật ký: ${log}`,
    failed: (log: string) => `Second Brain chưa khởi động được. Chi tiết trong nhật ký: ${log}`,
  },
  en: {
    portBusy: (port: number) =>
      `Port ${port} is used by another program. Close that program, or change the port in Second Brain's Settings, then open the app again.`,
    otherInstance: (port: number) =>
      `Port ${port} is used by another Second Brain (from another folder). Quit that one, then open this one again.`,
    vaultUnusable: (log: string) =>
      `The notes folder could not be opened. Check that it still exists and that you can write to it, then open the app again. Details in the log: ${log}`,
    failed: (log: string) => `Second Brain could not start. Details in the log: ${log}`,
  },
} as const;

/** Where startup problems are logged (the launcher shows the same file). */
export const startupLogOf = (home: string) => path.join(home, '.secondbrain', 'logs', 'server.log');

/** `ui.language` of `<home>/.secondbrain/settings.json`; Vietnamese when unknown. */
export function readExeLanguage(home: string): ExeLanguage {
  try {
    const text = readFileSync(path.join(home, '.secondbrain', 'settings.json'), 'utf8');
    const ui = (JSON.parse(text.replace(/^\uFEFF/, '')) as { ui?: { language?: unknown } }).ui;
    return ui?.language === 'en' ? 'en' : 'vi';
  } catch {
    return 'vi';
  }
}
