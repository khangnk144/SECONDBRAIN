import { describe, expect, it } from 'vitest';
import { normalizeSettings, type GlobalSettings } from '../../src/config/global-settings.js';
import { createSettingsStore } from '../../src/config/settings-store.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('settings store (one queue, changes in place)', () => {
  it('concurrent updates never lose a field and each save sees the earlier ones', async () => {
    const live = normalizeSettings({});
    const saved: GlobalSettings[] = [];
    const store = createSettingsStore(
      () => live,
      async (next) => {
        await settle(); // a slow disk: updates overlap in time
        saved.push(structuredClone(next));
      },
    );
    await Promise.all([
      store.update((draft) => {
        draft.ui.name = 'Khang';
      }),
      store.update((draft) => {
        draft.reminders.time = '07:30';
      }),
      store.update((draft) => {
        draft.port = 5050;
      }),
    ]);
    expect(live.ui.name).toBe('Khang');
    expect(live.reminders.time).toBe('07:30');
    expect(live.port).toBe(5050);
    expect(saved).toHaveLength(3);
    expect(saved[2]).toMatchObject({
      ui: { name: 'Khang' },
      reminders: { time: '07:30' },
      port: 5050,
    });
  });

  it('keeps the live object and its nested objects (readers holding them see the change)', async () => {
    const live = normalizeSettings({});
    const ui = live.ui;
    const ai = live.ai;
    const store = createSettingsStore(
      () => live,
      async () => {},
    );
    await store.update((draft) => {
      draft.ui.theme = 'light';
      draft.ai.apiKeys.openai = 'sk-test-0123456789abcdef';
    });
    expect(store.get()).toBe(live);
    expect(live.ui).toBe(ui);
    expect(ui.theme).toBe('light');
    expect(ai.apiKeys.openai).toBe('sk-test-0123456789abcdef');
    await store.update((draft) => {
      delete draft.ai.apiKeys.openai;
    });
    expect('openai' in ai.apiKeys).toBe(false);
  });

  it('a failed save leaves the live settings unchanged and does not block later updates', async () => {
    const live = normalizeSettings({});
    let fail = true;
    const store = createSettingsStore(
      () => live,
      async () => {
        if (fail) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      },
    );
    await expect(
      store.update((draft) => {
        draft.ui.name = 'Lost';
      }),
    ).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(live.ui.name).toBe('khangnie');
    fail = false;
    await store.update((draft) => {
      draft.ui.name = 'Kept';
    });
    expect(live.ui.name).toBe('Kept');
  });

  it('writes nothing when the update changed nothing', async () => {
    const live = normalizeSettings({});
    let saves = 0;
    const store = createSettingsStore(
      () => live,
      async () => {
        saves += 1;
      },
    );
    await store.update((draft) => {
      draft.ui.name = 'khangnie';
    });
    expect(saves).toBe(0);
  });
});
