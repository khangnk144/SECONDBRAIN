/**
 * Turns the destination of an inline Markdown link into a vault target (SPEC §4.4: ordinary
 * links are resolved for navigation and backlinks). Only relative URLs count: no scheme, not
 * protocol-relative, not a bare `#fragment`.
 */

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const URL_SAFE_ASCII = /[!#$&-;=?-Z_a-z~]/;

export interface MarkdownLinkTarget {
  /** Percent-decoded path without the `?query` and `#fragment`. */
  target: string;
  heading: string | null;
}

export function markdownLinkTarget(url: string): MarkdownLinkTarget | null {
  if (url === '' || url.startsWith('#') || url.startsWith('//') || SCHEME.test(url)) return null;
  const normalized = normalizeUri(url);
  const hash = normalized.indexOf('#');
  const beforeHash = hash === -1 ? normalized : normalized.slice(0, hash);
  // A `?query` is not part of a vault path (`?` cannot appear in Windows file names).
  const query = beforeHash.indexOf('?');
  const target = percentDecode(query === -1 ? beforeHash : beforeHash.slice(0, query)).trim();
  if (target === '') return null;
  const heading = hash === -1 ? null : percentDecode(normalized.slice(hash + 1)) || null;
  return { target, heading };
}

/**
 * Same encoding as the CommonMark reference parser applies to link destinations (keeps valid
 * `%XX`, encodes everything else that is not URL-safe), so a destination decodes identically
 * whichever parser produced it.
 */
function normalizeUri(value: string): string {
  let out = '';
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    let replace = '';
    let skip = 0;
    if (code === 37 && isAlnum(value.charCodeAt(i + 1)) && isAlnum(value.charCodeAt(i + 2))) {
      skip = 2;
    } else if (code < 128) {
      if (!URL_SAFE_ASCII.test(value[i] as string)) replace = value[i] as string;
    } else if (code > 0xd7ff && code < 0xe000) {
      const next = value.charCodeAt(i + 1);
      if (code < 0xdc00 && next > 0xdbff && next < 0xe000) {
        replace = value.slice(i, i + 2);
        skip = 1;
      } else replace = '�';
    } else replace = value[i] as string;
    if (replace) {
      out += value.slice(start, i) + encodeURIComponent(replace);
      start = i + skip + 1;
    }
    i += skip;
  }
  return out + value.slice(start);
}

function isAlnum(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/** Decodes runs of `%XX`; a run that is not valid UTF-8 is kept as written. */
function percentDecode(value: string): string {
  if (!value.includes('%')) return value;
  return value.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}
