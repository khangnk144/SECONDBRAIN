import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TemplateUpgradeItem } from '../../lib/api/templates-types';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { installSettingsRoutes, renderSettings, settingsResponse } from './settings-test-kit';

let mock: FetchMock;
let items: TemplateUpgradeItem[];

const PAPER = 'Templates/Paper.md';
const SKELETON = 'CLAUDE.md';

describe('Settings: "Cập nhật mẫu" upgrades only unedited bundled files (owner request R2, F14)', () => {
  beforeEach(async () => {
    await resetAppState();
    mock = installFetchMock();
    installSettingsRoutes(mock, settingsResponse());
    items = [];
    mock.on('GET /api/templates/upgrades', () => ({ body: { items } }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('offers nothing while every file is current or missing', async () => {
    items = [
      { path: PAPER, state: 'current' },
      { path: SKELETON, state: 'missing' },
    ];
    renderSettings();
    await screen.findByRole('button', { name: 'Khôi phục mẫu gốc' });
    await waitFor(() => expect(mock.callsTo('GET /api/templates/upgrades')).toHaveLength(1));
    expect(screen.queryByRole('button', { name: 'Cập nhật mẫu' })).toBeNull();
    expect(screen.queryByText(/Cập nhật mẫu/)).toBeNull();
  });

  it('upgrades both, names them and where the old copies went; focus stays on the outcome', async () => {
    const user = userEvent.setup();
    items = [
      { path: PAPER, state: 'upgradable' },
      { path: SKELETON, state: 'upgradable' },
    ];
    mock.on('POST /api/templates/upgrade', () => {
      items = items.map((item) => ({ ...item, state: 'current' }));
      return { body: { upgraded: [PAPER, SKELETON], skipped: [] } };
    });
    renderSettings();
    expect(
      await screen.findByText(
        'Có mẫu mới cho Paper.md và CLAUDE.md (thêm Bài toán, Input/Output, Dữ liệu…).',
      ),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cập nhật mẫu' }));
    // By name: she may not know CLAUDE.md as a "template".
    const outcome = await screen.findByText(
      'Đã cập nhật Paper.md và CLAUDE.md. Bản cũ nằm trong thùng rác.',
    );
    expect(outcome).toBeVisible();
    expect(mock.callsTo('POST /api/templates/upgrade').map((call) => call.body)).toEqual([
      { paths: [PAPER, SKELETON] },
    ]);
    // Read again: nothing left to offer.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cập nhật mẫu' })).toBeNull());
    // The pressed button is gone: focus moved to the outcome, not to the page body.
    await waitFor(() => expect(outcome).toHaveFocus());
    expect(outcome).toHaveAttribute('tabindex', '-1');
  });

  it('an edited file is named and never sent; only the unedited one is upgraded', async () => {
    const user = userEvent.setup();
    items = [
      { path: PAPER, state: 'upgradable' },
      { path: SKELETON, state: 'edited' },
    ];
    mock.on('POST /api/templates/upgrade', {
      body: { upgraded: [PAPER], skipped: [] },
    });
    renderSettings();
    expect(
      await screen.findByText('Có mẫu mới cho Paper.md (thêm Bài toán, Input/Output, Dữ liệu…).'),
    ).toBeVisible();
    expect(screen.getByText('Bạn đã sửa CLAUDE.md nên app không thay nó.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cập nhật mẫu' }));
    expect(
      await screen.findByText('Đã cập nhật Paper.md. Bản cũ nằm trong thùng rác.'),
    ).toBeVisible();
    expect(mock.callsTo('POST /api/templates/upgrade')[0]?.body).toEqual({ paths: [PAPER] });
  });

  it('only edited files: says so, with no button', async () => {
    items = [
      { path: PAPER, state: 'edited' },
      { path: SKELETON, state: 'current' },
    ];
    renderSettings();
    expect(await screen.findByText('Bạn đã sửa Paper.md nên app không thay nó.')).toBeVisible();
    expect(screen.getByText('Cập nhật mẫu')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Cập nhật mẫu' })).toBeNull();
  });

  it('a file edited meanwhile is skipped or stops the update, and says what to do', async () => {
    const user = userEvent.setup();
    items = [
      { path: PAPER, state: 'upgradable' },
      { path: SKELETON, state: 'upgradable' },
    ];
    mock.on('POST /api/templates/upgrade', {
      body: { upgraded: [SKELETON], skipped: [{ path: PAPER, reason: 'edited' }] },
    });
    renderSettings();
    await user.click(await screen.findByRole('button', { name: 'Cập nhật mẫu' }));
    expect(
      await screen.findByText(
        'Đã cập nhật CLAUDE.md. Bản cũ nằm trong thùng rác. Bạn đã sửa Paper.md nên app không thay nó.',
      ),
    ).toBeVisible();

    mock.on('POST /api/templates/upgrade', apiError(409, 'CONFLICT', { upgraded: [] }));
    await user.click(screen.getByRole('button', { name: 'Cập nhật mẫu' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Một mẫu vừa thay đổi trong lúc cập nhật nên app dừng lại. Bấm Cập nhật mẫu lần nữa nhé.',
    );
  });
});
