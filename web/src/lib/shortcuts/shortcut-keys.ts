/** Parsing and matching of shortcut strings such as `Alt+W`, `Ctrl+K`, `Alt+[`. */
export interface ParsedKeys {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** Lowercase key (`w`, `1`, `[`, `f2`, `escape`). */
  key: string;
}

export function parseKeys(keys: string): ParsedKeys {
  // `Alt++` is not used; splitting on '+' keeps `[` `]` `,` `/` intact.
  const parts = keys.split('+').map((part) => part.trim());
  const key = (parts.pop() ?? '').toLowerCase();
  const mods = new Set(parts.map((part) => part.toLowerCase()));
  return { ctrl: mods.has('ctrl'), alt: mods.has('alt'), shift: mods.has('shift'), key };
}

const CODE_KEYS: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Slash: '/',
  Comma: ',',
  Period: '.',
  Backquote: '`',
};

/**
 * Key named by the physical position: with Alt held, macOS (and some layouts) turn `w` into `∑`,
 * so `event.key` alone would miss `Alt+W`.
 */
function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return CODE_KEYS[code] ?? null;
}

export function matchesKeys(event: KeyboardEvent, parsed: ParsedKeys): boolean {
  // Ctrl also matches ⌘ so the same registry works on a Mac.
  const ctrl = event.ctrlKey || event.metaKey;
  if (ctrl !== parsed.ctrl || event.altKey !== parsed.alt || event.shiftKey !== parsed.shift) {
    return false;
  }
  const key = (event.key ?? '').toLowerCase();
  return key === parsed.key || keyFromCode(event.code ?? '') === parsed.key;
}
