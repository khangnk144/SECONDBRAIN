import type { ActionState } from './use-action-status';

/** The outcome sentence under a Settings action (errors are announced at once). */
export function ActionMessage({ state, busyText }: { state: ActionState; busyText?: string }) {
  if (state.kind === 'error') {
    return (
      <p className="settings-status settings-status--error" role="alert">
        {state.message}
      </p>
    );
  }
  const text = state.kind === 'done' ? state.message : state.kind === 'busy' ? busyText : '';
  return (
    <p className="settings-status settings-status--block" role="status">
      {text ?? ''}
    </p>
  );
}
