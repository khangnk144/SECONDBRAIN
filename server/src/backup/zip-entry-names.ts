import { segmentProblem } from '../security/path-guard.js';

/**
 * The relative path segments of a zip entry name, or null when the name could write outside the
 * restore folder or cannot exist on Windows: absolute, UNC or drive paths, backslashes, `..` or
 * `.` segments, NUL and control characters, reserved device names, trailing dots or spaces
 * (path-guard rules). Unlike vault paths, `.secondbrain/` is allowed: it is part of a backup.
 */
export function safeEntrySegments(name: string): string[] | null {
  const relative = name.endsWith('/') ? name.slice(0, -1) : name;
  if (relative === '' || relative.includes('\\')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(relative)) return null;
  if (relative.startsWith('/') || /^[a-zA-Z]:/.test(relative)) return null;
  const segments = relative.split('/');
  for (const segment of segments) if (segmentProblem(segment) !== null) return null;
  return segments;
}
