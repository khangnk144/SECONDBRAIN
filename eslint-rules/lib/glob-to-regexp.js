// Minimal glob matcher (`**`, `*`, `?`, `{a,b}`) for repo-relative POSIX paths.
// Kept dependency-free so lint rules and scripts share one implementation.

/**
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  let re = '';
  let i = 0;
  let inGroup = false;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // `**/` matches zero or more directories; a trailing `**` matches everything.
        const followedBySlash = glob[i + 2] === '/';
        re += followedBySlash ? '(?:.*/)?' : '.*';
        i += followedBySlash ? 3 : 2;
        continue;
      }
      re += '[^/]*';
    } else if (ch === '?') {
      re += '[^/]';
    } else if (ch === '{') {
      inGroup = true;
      re += '(?:';
    } else if (ch === '}' && inGroup) {
      inGroup = false;
      re += ')';
    } else if (ch === ',' && inGroup) {
      re += '|';
    } else {
      re += ch.replace(/[.+^$()|[\]\\]/g, '\\$&');
    }
    i += 1;
  }
  return new RegExp(`^${re}$`);
}

/**
 * @param {string} relPath repo-relative path (any separator)
 * @param {string[]} globs
 */
export function matchesAnyGlob(relPath, globs) {
  const posix = relPath.split('\\').join('/');
  return globs.some((g) => globToRegExp(g).test(posix));
}
