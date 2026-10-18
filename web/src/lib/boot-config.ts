import { DEFAULT_UI_PREFS, normalizeUiPrefs, type UiPrefs } from './ui-prefs';

/**
 * Boot data injected by the server into the UI shell (web/index.html placeholders):
 *   <meta name="sb-token" content="...">  session token for /api and /ws
 *   <meta name="sb-boot"  content="{json}"> settings.ui
 * When the shell is served without the server (tests, `vite preview`), the
 * placeholders stay as `__SB_*__`; we then fall back to defaults.
 */
export interface BootConfig {
  token: string | null;
  ui: UiPrefs;
}

const PLACEHOLDER = /^__SB_[A-Z_]+__$/;

function readMeta(doc: Document, name: string): string | null {
  const content = doc.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? null;
  if (content === null) return null;
  const trimmed = content.trim();
  if (trimmed === '' || PLACEHOLDER.test(trimmed)) return null;
  return trimmed;
}

function parseBoot(json: string | null): UiPrefs {
  if (json === null) return { ...DEFAULT_UI_PREFS };
  try {
    return normalizeUiPrefs(JSON.parse(json));
  } catch {
    return { ...DEFAULT_UI_PREFS };
  }
}

export function readBootConfig(doc: Document = document): BootConfig {
  return {
    token: readMeta(doc, 'sb-token'),
    ui: parseBoot(readMeta(doc, 'sb-boot')),
  };
}
