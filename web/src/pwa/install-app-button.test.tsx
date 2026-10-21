import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { InstallAppButton } from './install-app-button';
import {
  promptInstall,
  startInstallPromptCapture,
  useInstallPromptStore,
  type BeforeInstallPromptEventLike,
} from './install-prompt-store';

function fakePromptEvent(outcome: 'accepted' | 'dismissed') {
  const event = new Event('beforeinstallprompt', {
    cancelable: true,
  }) as BeforeInstallPromptEventLike;
  Object.assign(event, {
    prompt: vi.fn(async () => undefined),
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  });
  return event;
}

function fakeMediaQuery(matches: boolean) {
  const target = new EventTarget();
  return Object.assign(target, {
    matches,
    media: '(display-mode: standalone)',
  }) as unknown as MediaQueryList;
}

let stops: Array<() => void> = [];
function capture(options: { promptSupported?: boolean; standalone?: MediaQueryList } = {}) {
  const win = new EventTarget() as EventTarget & Record<string, unknown>;
  if (options.promptSupported !== false) win.onbeforeinstallprompt = null;
  const standalone = options.standalone ?? fakeMediaQuery(false);
  win.matchMedia = () => standalone;
  stops.push(startInstallPromptCapture(win as unknown as Window));
  return { win, standalone };
}

describe('install prompt and "Cài đặt app" (F21.3)', () => {
  beforeAll(() => {
    initI18n('vi');
  });
  afterEach(() => {
    stops.forEach((stop) => stop());
    stops = [];
    useInstallPromptStore.setState({ deferred: null, installed: false, promptSupported: false });
  });

  it('keeps the browser prompt and shows the button, which opens it once', async () => {
    const { win } = capture();
    render(<InstallAppButton />);
    expect(screen.queryByRole('button')).toBeNull();
    const event = fakePromptEvent('accepted');
    act(() => {
      win.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    const button = screen.getByRole('button', { name: 'Cài đặt app' });
    expect(button).toHaveClass('button--secondary');
    await userEvent.click(button);
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button')).toBeNull();
    expect(useInstallPromptStore.getState().installed).toBe(true);
  });

  it('hides the button after the user dismissed the prompt (it cannot be reused)', async () => {
    const { win } = capture();
    const event = fakePromptEvent('dismissed');
    win.dispatchEvent(event);
    await expect(promptInstall()).resolves.toBe('dismissed');
    await expect(promptInstall()).resolves.toBe('unavailable');
    render(<InstallAppButton />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('Mở bằng Chrome hoặc Edge để cài app.')).toBeNull();
  });

  it('shows nothing once installed, by the appinstalled event or in the app window', () => {
    const { win } = capture();
    win.dispatchEvent(fakePromptEvent('accepted'));
    act(() => {
      win.dispatchEvent(new Event('appinstalled'));
    });
    const { container } = render(<InstallAppButton />);
    expect(container).toBeEmptyDOMElement();

    stops.forEach((stop) => stop());
    capture({ standalone: fakeMediaQuery(true) });
    expect(useInstallPromptStore.getState().installed).toBe(true);
  });

  it('notices when the page turns into the installed app window', () => {
    const { standalone } = capture();
    const change = Object.assign(new Event('change'), { matches: true });
    standalone.dispatchEvent(change);
    expect(useInstallPromptStore.getState().installed).toBe(true);
  });

  it('tells browsers without an install prompt to use Chrome or Edge', () => {
    capture({ promptSupported: false });
    render(<InstallAppButton />);
    expect(screen.getByText('Mở bằng Chrome hoặc Edge để cài app.')).toBeInTheDocument();
  });
});
