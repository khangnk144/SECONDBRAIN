import { realpath as realpathCallback } from 'node:fs';
import { realpath as nativeRealpath } from 'node:fs/promises';
import { promisify } from 'node:util';

const jsRealpath = promisify(realpathCallback);

/**
 * Real path of an existing entry. The native call (which also yields the true letter case on
 * Windows) fails on some Windows virtual drives; then Node's JavaScript implementation, which
 * resolves links one segment at a time, is used. A missing entry is reported as is.
 */
export async function realPath(target: string): Promise<string> {
  try {
    return await nativeRealpath(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error;
    return jsRealpath(target);
  }
}
