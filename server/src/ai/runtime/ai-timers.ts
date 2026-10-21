import type { ProviderTimers } from '../providers/provider-types.js';

/**
 * Real timers for the AI plugin. Unref'd: a pending embedding job or retry must never keep the
 * process alive on shutdown (close() cancels them anyway).
 */
export const defaultAiTimers: ProviderTimers = {
  setTimeout(callback, ms) {
    const handle = setTimeout(callback, ms);
    handle.unref();
    return handle;
  },
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};
