import type { Ref } from 'react';
import type { ActionState } from './use-action-status';

/**
 * The outcome sentence under a Settings action (errors are announced at once). `messageRef` lets
 * a row move focus onto it when the button that was used disappears with the outcome.
 */
export function ActionMessage({
  state,
  busyText,
  messageRef,
}: {
  state: ActionState;
  busyText?: string;
  messageRef?: Ref<HTMLParagraphElement>;
}) {
  // Focusable by script only (never a Tab stop), and only when a row asks for it.
  const tabIndex = messageRef ? -1 : undefined;
  if (state.kind === 'error') {
    return (
      <p
        ref={messageRef}
        tabIndex={tabIndex}
        className="settings-status settings-status--error"
        role="alert"
      >
        {state.message}
      </p>
    );
  }
  const text = state.kind === 'done' ? state.message : state.kind === 'busy' ? busyText : '';
  return (
    <p
      ref={messageRef}
      tabIndex={tabIndex}
      className="settings-status settings-status--block"
      role="status"
    >
      {text ?? ''}
    </p>
  );
}
