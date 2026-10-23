/**
 * Which file is the app's "Học kỳ này" page, and where the page goes when its name is taken
 * (SPEC F25.1–F25.3, review M1). The app never takes over a note it did not write:
 * - a file at the page's path is the app's page when its revision is one the app wrote, or when
 *   the app wrote a page at that path before and the file still carries `generated: true` (the
 *   page edited outside the app: "edited", never overwritten, "Tạo lại" offered);
 * - anything else there is a note of hers: never guarded, never called "edited", never moved
 *   to the trash; the page is created under the first free name instead
 *   (`Học kỳ này 2.md`, `Học kỳ này 3.md`, …; `This semester 2.md` in English).
 */
import { splitFrontmatter } from '../markdown/frontmatter.js';
import { VaultError, type VaultPath } from '../vault/vault-types.js';

/** Names tried after the first one before giving up (`name-taken`). */
export const MAX_PAGE_NAMES = 50;

/** The front matter says `generated: true` (the mark every page the app writes carries). */
export function hasGeneratedMark(content: string): boolean {
  const { data } = splitFrontmatter(content).frontmatter;
  return data !== null && typeof data === 'object' && data.generated === true;
}

/** `Học kỳ này.md` → `Học kỳ này <n>.md` (n ≥ 2); a name with a number keeps its base. */
export function numberedPageName(path: VaultPath, n: number): VaultPath {
  const base = path.slice(0, -3).replace(/ \d+$/, '');
  return n <= 1 ? `${base}.md` : `${base} ${n}.md`;
}

/** The first name of the page's series that `taken` does not hold. */
export async function freePageName(
  path: VaultPath,
  taken: (candidate: VaultPath) => Promise<boolean>,
): Promise<VaultPath> {
  for (let n = 1; n <= MAX_PAGE_NAMES; n += 1) {
    const candidate = numberedPageName(path, n);
    if (!(await taken(candidate))) return candidate;
  }
  throw new VaultError('VALIDATION', 'Every name for the semester page is taken.', {
    reason: 'name-taken',
  });
}
