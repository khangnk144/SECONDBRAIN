import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleShortcutKeydown,
  installShortcutListener,
  listShortcuts,
  registerShortcut,
  resetShortcuts,
  suspendShortcuts,
} from './shortcut-registry';

function press(init: KeyboardEventInit, target: EventTarget = document.body) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('shortcut registry (F22)', () => {
  let uninstall: () => void;
  beforeEach(() => {
    resetShortcuts();
    uninstall = installShortcutListener();
  });
  afterEach(() => {
    uninstall();
    document.body.innerHTML = '';
  });

  it('runs a shortcut once through the single window listener and lists it', () => {
    const run = vi.fn();
    registerShortcut({ id: 'close-tab', keys: 'Alt+W', run, labelKey: 'shortcuts.closeTab' });
    const event = press({ key: 'w', code: 'KeyW', altKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(listShortcuts()).toEqual([
      { id: 'close-tab', keys: 'Alt+W', labelKey: 'shortcuts.closeTab' },
    ]);
  });

  it('matches by physical key when Alt changes the character, and requires exact modifiers', () => {
    const run = vi.fn();
    registerShortcut({ id: 'prev', keys: 'Alt+[', run, labelKey: 'x' });
    press({ key: '“', code: 'BracketLeft', altKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    press({ key: '[', code: 'BracketLeft', altKey: true, ctrlKey: true });
    press({ key: '[', code: 'BracketLeft' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('ignores typing in inputs unless allowed, and stays quiet while an overlay suspends it', () => {
    const plain = vi.fn();
    const allowed = vi.fn();
    registerShortcut({ id: 'new', keys: 'Alt+N', run: plain, labelKey: 'x' });
    registerShortcut({ id: 'k', keys: 'Ctrl+K', run: allowed, allowInInputs: true, labelKey: 'y' });
    const input = document.createElement('input');
    document.body.append(input);
    press({ key: 'n', code: 'KeyN', altKey: true }, input);
    press({ key: 'k', code: 'KeyK', ctrlKey: true }, input);
    expect(plain).not.toHaveBeenCalled();
    expect(allowed).toHaveBeenCalledTimes(1);

    // The rich-text editor is contenteditable, not a form field: shortcuts still work there.
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.append(editor);
    press({ key: 'n', code: 'KeyN', altKey: true }, editor);
    expect(plain).toHaveBeenCalledTimes(1);

    const resume = suspendShortcuts();
    const blockedAlt = press({ key: 'n', code: 'KeyN', altKey: true });
    const blockedCtrl = press({ key: 'k', code: 'KeyK', ctrlKey: true });
    expect(plain).toHaveBeenCalledTimes(1);
    expect(allowed).toHaveBeenCalledTimes(1);
    // A suspended Ctrl shortcut still keeps the browser's own Ctrl+K away; Alt keys pass through.
    expect(blockedCtrl.defaultPrevented).toBe(true);
    expect(blockedAlt.defaultPrevented).toBe(false);
    resume();
    press({ key: 'n', code: 'KeyN', altKey: true });
    expect(plain).toHaveBeenCalledTimes(2);
  });

  it('skips composing (IME), repeats and already handled events; unregister removes it', () => {
    const run = vi.fn();
    const unregister = registerShortcut({ id: 'a', keys: 'Alt+1', run, labelKey: 'x' });
    press({ key: '1', code: 'Digit1', altKey: true, isComposing: true });
    press({ key: '1', code: 'Digit1', altKey: true, repeat: true });
    const handled = new KeyboardEvent('keydown', { key: '1', altKey: true, cancelable: true });
    handled.preventDefault();
    expect(handleShortcutKeydown(handled)).toBe(false);
    expect(run).not.toHaveBeenCalled();
    unregister();
    press({ key: '1', code: 'Digit1', altKey: true });
    expect(run).not.toHaveBeenCalled();
  });
});
