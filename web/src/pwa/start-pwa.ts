/**
 * PWA startup, imported by main.tsx before React renders: the install prompt is captured at
 * once (Chrome fires it only once per page load), the service worker registers after `load`.
 */
import { startInstallPromptCapture } from './install-prompt-store';
import { startServiceWorker } from './register-service-worker';

startInstallPromptCapture();
startServiceWorker();
