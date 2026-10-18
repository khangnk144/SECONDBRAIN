export type ServerMode = 'production' | 'development';

export interface CspOptions {
  port: number;
  mode: ServerMode;
  /** Vite HMR websocket port (development only). */
  hmrPort?: number;
}

/**
 * Content-Security-Policy for the UI shell. Production is strict: no inline scripts or styles.
 * Development relaxes only what Vite needs: its inline React-refresh preamble, injected <style>
 * tags, and the HMR websocket on its own port.
 */
export function buildContentSecurityPolicy({ port, mode, hmrPort }: CspOptions): string {
  const dev = mode === 'development';
  const connect = ["'self'", `ws://localhost:${port}`];
  if (dev && hmrPort) connect.push(`ws://localhost:${hmrPort}`);
  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    ['script-src', dev ? ["'self'", "'unsafe-inline'"] : ["'self'"]],
    ['style-src', dev ? ["'self'", "'unsafe-inline'"] : ["'self'"]],
    ['img-src', ["'self'", 'data:', 'blob:']],
    ['font-src', ["'self'"]],
    ['connect-src', connect],
    ['object-src', ["'none'"]],
    ['base-uri', ["'none'"]],
    ['frame-ancestors', ["'none'"]],
    ['form-action', ["'self'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}

/** Headers sent on every response. */
export const BASELINE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
};
