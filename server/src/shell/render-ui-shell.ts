import type { UiSettings } from '../config/global-settings.js';

/** Escapes a value for use inside a double- or single-quoted HTML attribute. */
export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export interface ShellValues {
  token: string;
  ui: UiSettings;
}

/**
 * Replaces the shell placeholders written by the web app's index.html:
 * __SB_TOKEN__, __SB_LANG__, __SB_THEME__, __SB_PALETTE__, __SB_FONT_SIZE__, __SB_BOOT__ (JSON of ui).
 * Every value is attribute-escaped; the template is never trusted to quote them for us.
 */
export function renderUiShell(template: string, { token, ui }: ShellValues): string {
  const values: Record<string, string> = {
    __SB_TOKEN__: token,
    __SB_LANG__: ui.language,
    __SB_THEME__: ui.theme,
    __SB_PALETTE__: ui.palette,
    __SB_FONT_SIZE__: String(ui.fontSize),
    __SB_BOOT__: JSON.stringify({
      name: ui.name,
      language: ui.language,
      theme: ui.theme,
      palette: ui.palette,
      fontSize: ui.fontSize,
    }),
  };
  let html = template;
  for (const [placeholder, value] of Object.entries(values)) {
    html = html.split(placeholder).join(escapeHtmlAttribute(value));
  }
  return html;
}
