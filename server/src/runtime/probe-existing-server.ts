import http from 'node:http';
import { APP_ID } from '../version.js';

/**
 * Asks whatever listens on the port whether it is a Second Brain server.
 * Uses node:http (not fetch) so the Host header can be set to the allowlisted value.
 */
export function probeExistingServer(port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/api/health',
        method: 'GET',
        headers: { host: `localhost:${port}`, accept: 'application/json' },
        timeout: timeoutMs,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          if (body.length < 4096) body += chunk;
        });
        response.on('end', () => {
          try {
            const parsed = JSON.parse(body) as { app?: string };
            resolve(response.statusCode === 200 && parsed.app === APP_ID);
          } catch {
            resolve(false);
          }
        });
      },
    );
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
    request.end();
  });
}
