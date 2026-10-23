// The layout style an e2e server starts with (F35.1). The product default is Bento, but every spec
// written before M5 expects the calm layout, so a fresh e2e home is seeded with `ui.style: 'calm'`
// unless a spec asks for Bento (`ownServer(port, { style: 'bento' })`) or the whole run does
// (`SB_E2E_STYLE=bento npm run test:e2e`, for the "full suite in both styles" pass).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type E2eStyle = 'bento' | 'calm';

/** The style of this run: `SB_E2E_STYLE` (`bento` | `calm`), else calm. */
export function runStyle(env: NodeJS.ProcessEnv = process.env): E2eStyle {
  return env.SB_E2E_STYLE === 'bento' ? 'bento' : 'calm';
}

/**
 * Writes `ui.style` into `<home>/.secondbrain/settings.json` before the server starts. An explicit
 * `style` always wins; without one, a style already stored (a restart of the same home, a change
 * a spec made through the UI) is kept and only a missing one gets the run's style. Other keys the
 * file already has (a spec's port, the token of an earlier start) are kept as they are.
 */
export function seedStyle(home: string, style?: E2eStyle): void {
  const file = path.join(home, '.secondbrain', 'settings.json');
  let settings: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as Record<
        string,
        unknown
      >;
    } catch {
      return; // not ours to repair: the server keeps a copy and writes defaults
    }
  }
  const ui = (settings.ui && typeof settings.ui === 'object' ? settings.ui : {}) as Record<
    string,
    unknown
  >;
  if (style === undefined && (ui.style === 'bento' || ui.style === 'calm')) return;
  settings.ui = { ...ui, style: style ?? runStyle() };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}
