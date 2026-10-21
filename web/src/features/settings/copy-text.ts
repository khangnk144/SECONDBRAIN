/**
 * Puts text on the clipboard: the Clipboard API first (the app runs on localhost, a secure
 * context), then the old hidden-textarea copy for browsers that refuse it. Resolves false when
 * neither worked, so the caller can say so instead of claiming "Đã sao chép".
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission refused or not focused: try the fallback.
  }
  return copyWithTextarea(text);
}

function copyWithTextarea(text: string): boolean {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.className = 'visually-hidden';
  document.body.append(area);
  area.select();
  let copied: boolean;
  try {
    copied = typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();
  active?.focus();
  return copied;
}

/**
 * The HTTP snippet as shown on screen: the bearer token reduced to its last 4 characters
 * (`Bearer ••••abcd`). The full text is only ever copied, never rendered.
 */
export function maskBearerTokens(text: string): string {
  return text.replace(/(Bearer\s+)([^\s"'\\]+)/g, (_match, prefix: string, token: string) => {
    return `${prefix}••••${token.slice(-4)}`;
  });
}
