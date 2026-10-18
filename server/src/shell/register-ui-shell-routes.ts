import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { GlobalSettings } from '../config/global-settings.js';
import { sendApiError } from '../http/api-errors.js';
import {
  decodedRequestPath,
  isApiPath,
  isWebSocketPath,
} from '../security/host-and-origin-rules.js';
import { buildContentSecurityPolicy, type ServerMode } from '../security/security-headers.js';
import { renderUiShell } from './render-ui-shell.js';
import type { ShellSource } from './shell-source.js';

export const UI_NOT_BUILT_MESSAGE = [
  'Second Brain: the user interface has not been built yet.',
  'Run "npm run build" in the app folder, then start the server again.',
  '',
  'Second Brain: giao diện chưa được build.',
  'Chạy "npm run build" trong thư mục app rồi khởi động lại máy chủ.',
].join('\n');

export interface ShellRouteOptions {
  source: ShellSource;
  getSettings: () => GlobalSettings;
  port: number;
  mode: ServerMode;
  hmrPort?: number;
}

function acceptsHtml(request: FastifyRequest): boolean {
  const accept = request.headers.accept ?? '';
  return accept.includes('text/html');
}

/**
 * Serves the UI shell at "/" (and as the fallback for HTML navigations), and turns every other
 * unmatched request into a JSON 404. The shell carries the session token, so it is never cached.
 */
export function registerUiShellRoutes(app: FastifyInstance, options: ShellRouteOptions): void {
  const csp = buildContentSecurityPolicy({
    port: options.port,
    mode: options.mode,
    hmrPort: options.hmrPort,
  });

  async function sendShell(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const template = await options.source.loadTemplate(request.url);
    if (template === null) {
      return reply
        .code(503)
        .type('text/plain; charset=utf-8')
        .header('cache-control', 'no-store')
        .send(UI_NOT_BUILT_MESSAGE);
    }
    const settings = options.getSettings();
    const html = renderUiShell(template, { token: settings.sessionToken, ui: settings.ui });
    return reply
      .code(200)
      .type('text/html; charset=utf-8')
      .header('content-security-policy', csp)
      .header('cache-control', 'no-store')
      .send(html);
  }

  app.get('/', sendShell);

  app.setNotFoundHandler(async (request, reply) => {
    const pathName = decodedRequestPath(request.url);
    const isRead = request.method === 'GET' || request.method === 'HEAD';
    if (isRead && acceptsHtml(request) && !isApiPath(pathName) && !isWebSocketPath(pathName)) {
      return sendShell(request, reply);
    }
    return sendApiError(reply, 404, 'NOT_FOUND', 'Not found.');
  });
}
