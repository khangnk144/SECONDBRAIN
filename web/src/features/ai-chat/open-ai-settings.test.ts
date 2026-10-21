import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Navigator } from '../../lib/app-navigation';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { openAiSettings } from './open-ai-settings';

describe('"Mở Cài đặt AI" focuses the section once Settings shows it', () => {
  let navigate: ReturnType<typeof vi.fn<Navigator>>;
  beforeEach(async () => {
    navigate = (await resetAppState()) as ReturnType<typeof vi.fn<Navigator>>;
  });
  afterEach(() => document.body.replaceChildren());

  it.each(['ai', 'mcp'] as const)('%s', async (section) => {
    openAiSettings(section);
    expect(navigate).toHaveBeenCalledWith('/settings', undefined);
    // Settings renders its sections after loading: the heading comes a moment later.
    await new Promise((resolve) => setTimeout(resolve, 60));
    const heading = document.createElement('h2');
    heading.id = `settings-${section}`;
    document.body.append(heading);
    await vi.waitFor(() => expect(heading).toHaveFocus());
    expect(heading).toHaveAttribute('tabindex', '-1');
  });
});
