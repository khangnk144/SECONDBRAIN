import type { AppLogger } from '../logging/rotating-file-logger.js';
import type { WebSocketHub } from '../ws/websocket-hub.js';
import type { AppContext } from './create-app-context.js';
import type { VaultPluginInstance } from './vault-plugins.js';

/**
 * The one context the routes are registered with. Every member resolves to the vault that is
 * open at call time, so after a vault switch the same routes answer from the new vault. Routes
 * must therefore read members per request (`context.index`), never keep them from registration.
 */
export function createDelegatingContext(parts: {
  current: () => AppContext;
  hub: WebSocketHub;
  logger: AppLogger;
  /** What `close()` does: closes the host (the open vault and its plugins). */
  close: () => Promise<void>;
}): AppContext {
  const { current } = parts;
  return {
    get vault() {
      return current().vault;
    },
    get index() {
      return current().index;
    },
    get deadlines() {
      return current().deadlines;
    },
    get sampleData() {
      return current().sampleData;
    },
    get now() {
      return current().now;
    },
    hub: parts.hub,
    logger: parts.logger,
    settled: () => current().settled(),
    startRebuild: () => current().startRebuild(),
    refreshPendingJournal: () => current().refreshPendingJournal(),
    greet: (send) => current().greet(send),
    plugin: <T extends VaultPluginInstance>(name: string) => current().plugin<T>(name),
    attachPlugin: (name, instance) => current().attachPlugin(name, instance),
    onEvent: (listener) => current().onEvent(listener),
    close: parts.close,
  };
}
