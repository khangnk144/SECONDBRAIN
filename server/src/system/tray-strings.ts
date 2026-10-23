/**
 * Texts of the tray helper (F29.2, F29.3) in the UI language. The helper is a PowerShell
 * script outside the web app, so the server hands them over as JSON in `SB_TRAY_STRINGS`;
 * a language change restarts the helper with the new texts. `{code}` is filled in by the script.
 */
export type TrayLanguage = 'vi' | 'en';

export interface TrayStrings {
  tooltip: string;
  open: string;
  capture: string;
  quit: string;
  captureTitle: string;
  captureHint: string;
  save: string;
  close: string;
  saved: string;
  empty: string;
  tooLong: string;
  offline: string;
  refused: string;
  quitConfirm: string;
  quitFailed: string;
}

export const TRAY_STRINGS: Record<TrayLanguage, TrayStrings> = {
  vi: {
    tooltip: 'Second Brain',
    open: 'Mở Second Brain',
    capture: 'Ghi nhanh',
    quit: 'Thoát Second Brain',
    captureTitle: 'Ghi nhanh vào Inbox',
    captureHint: 'Enter để lưu, Shift+Enter để xuống dòng, Esc để đóng.',
    save: 'Lưu vào Inbox',
    close: 'Đóng',
    saved: 'Đã lưu vào Inbox.',
    empty: 'Bạn chưa gõ gì. Gõ vài chữ rồi bấm Enter.',
    tooLong: 'Ghi chú dài quá (tối đa 20.000 ký tự). Bớt chữ rồi lưu lại.',
    offline: 'Chưa lưu được vì Second Brain không trả lời. Chữ vẫn còn đây, mở app rồi lưu lại.',
    refused: 'Chưa lưu được (mã {code}). Chữ vẫn còn đây, bạn thử lưu lại nhé.',
    quitConfirm: 'Thoát Second Brain? Cửa sổ app đang mở sẽ ngừng lưu cho tới khi bạn mở lại app.',
    quitFailed: 'Chưa thoát được vì Second Brain không trả lời. Thử lại sau ít phút.',
  },
  en: {
    tooltip: 'Second Brain',
    open: 'Open Second Brain',
    capture: 'Quick capture',
    quit: 'Quit Second Brain',
    captureTitle: 'Quick capture to Inbox',
    captureHint: 'Enter saves, Shift+Enter adds a line, Esc closes.',
    save: 'Save to Inbox',
    close: 'Close',
    saved: 'Saved to Inbox.',
    empty: 'There is nothing to save yet. Type a few words, then press Enter.',
    tooLong: 'The note is too long (20,000 characters at most). Shorten it, then save again.',
    offline:
      'Not saved: Second Brain is not answering. Your text is still here; open the app, then save again.',
    refused: 'Not saved (code {code}). Your text is still here; try saving again.',
    quitConfirm: 'Quit Second Brain? Open app windows stop saving until you open the app again.',
    quitFailed: 'Could not quit: Second Brain is not answering. Try again in a few minutes.',
  },
};

/**
 * The JSON the helper reads, with every non-ASCII character as `\uXXXX` so the environment
 * block carries plain ASCII whatever code page Windows uses.
 */
export function trayStringsJson(language: TrayLanguage): string {
  return JSON.stringify(TRAY_STRINGS[language]).replace(
    /[\u0080-￿]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}
