import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { cssRule, readWebSource } from '../../lib/testing/read-source-file';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { mcpConfig, SESSION_TOKEN } from './ai-settings-test-kit';
import { COPIED_NOTICE_MS } from './snippet-block';
import { installSettingsRoutes, renderSettings, settingsResponse } from './settings-test-kit';

let mock: FetchMock;
const puts = () => mock.callsTo('PUT /api/settings').map((call) => call.body);

async function mcpRegion() {
  return screen.findByRole('region', { name: 'Kết nối Claude (MCP)' });
}

describe('Settings: connect Claude Desktop over MCP (F32.1)', () => {
  beforeEach(async () => {
    await resetAppState();
    mock = installFetchMock();
    installSettingsRoutes(mock, settingsResponse());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('says what it does, lists the steps and shows the stdio snippet; "Sao chép" copies it', async () => {
    const user = userEvent.setup();
    renderSettings();
    const region = await mcpRegion();
    expect(region).toHaveTextContent('MCP là cách để Claude Desktop đọc và viết vào wiki của bạn');
    const steps = within(within(region).getByRole('list', { name: 'Cách kết nối' })).getAllByRole(
      'listitem',
    );
    expect(steps).toHaveLength(5);
    expect(steps[1]).toHaveTextContent('mở Settings, chọn Developer rồi bấm Edit Config');
    const snippet = await within(region).findByLabelText('Đoạn cấu hình cho Claude Desktop');
    expect(snippet.textContent).toBe(mcpConfig().stdioSnippet);
    expect(snippet.textContent).toContain('mcp-stdio.js');
    expect(within(region).queryByText(/Hãy mở app bằng Mở Second Brain/)).toBeNull();

    const copy = within(region).getAllByRole('button', { name: 'Sao chép' })[0]!;
    await user.click(copy);
    expect(await navigator.clipboard.readText()).toBe(mcpConfig().stdioSnippet);
    expect(copy).toHaveTextContent('Đã sao chép');
    await waitFor(() => expect(copy).toHaveTextContent(/^Sao chép$/), {
      timeout: COPIED_NOTICE_MS + 1000,
    });
  });

  it('the HTTP snippet is tucked away and masks the token on screen; the copy holds all of it', async () => {
    const user = userEvent.setup();
    renderSettings();
    const region = await mcpRegion();
    const details = (await within(region).findByText('Cách khác: kết nối qua HTTP')).closest(
      'details',
    )!;
    expect(details).not.toHaveAttribute('open');
    // A visible marker says it opens (a flex summary loses the native triangle).
    const caret = details.querySelector('summary > svg.settings-details__caret');
    expect(caret).not.toBeNull();
    expect(caret).toHaveAttribute('aria-hidden', 'true');
    const css = await readWebSource('features/settings/settings-ai.css');
    expect(cssRule(css, '.settings-details[open] > summary .settings-details__caret')).toMatch(
      /transform:\s*rotate\(90deg\)/,
    );
    await user.click(within(details).getByText('Cách khác: kết nối qua HTTP'));
    expect(details).toHaveAttribute('open');
    const snippet = within(details).getByLabelText('Đoạn cấu hình HTTP');
    expect(snippet).toHaveTextContent('"Authorization": "Bearer ••••wxyz"');
    expect(within(details).getByText(/Đừng chia sẻ nó/)).toBeVisible();
    expect(document.body.innerHTML).not.toContain(SESSION_TOKEN);

    await user.click(within(details).getByRole('button', { name: 'Sao chép' }));
    const copied = await navigator.clipboard.readText();
    expect(copied).toBe(mcpConfig().httpSnippet);
    expect(copied).toContain(`Bearer ${SESSION_TOKEN}`);
    expect(document.body.innerHTML).not.toContain(SESSION_TOKEN);
  });

  it('a copy that fails says so instead of "Đã sao chép"', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    renderSettings();
    const region = await mcpRegion();
    await within(region).findByLabelText('Đoạn cấu hình cho Claude Desktop');
    await user.click(within(region).getAllByRole('button', { name: 'Sao chép' })[0]!);
    expect(await within(region).findByRole('alert')).toHaveTextContent(
      'Chưa sao chép được. Bôi đen đoạn cấu hình rồi bấm Ctrl+C nhé.',
    );
    expect(within(region).queryByText('Đã sao chép')).toBeNull();
  });

  it('asks to open the app once when the bridge is not built yet', async () => {
    mock.on('GET /api/mcp/config', { body: mcpConfig({ bridgeBuilt: false }) });
    renderSettings();
    expect(
      await screen.findByText(
        'Hãy mở app bằng Mở Second Brain một lần để app chuẩn bị file kết nối.',
      ),
    ).toBeVisible();
  });

  it('a config that cannot be read says so and can be read again', async () => {
    const user = userEvent.setup();
    mock.on('GET /api/mcp/config', apiError(503, 'UNAVAILABLE'));
    renderSettings();
    const region = await mcpRegion();
    expect(await within(region).findByRole('alert')).toHaveTextContent(
      'Chưa tải được đoạn cấu hình.',
    );
    mock.on('GET /api/mcp/config', { body: mcpConfig() });
    await user.click(within(region).getByRole('button', { name: 'Thử lại' }));
    expect(await within(region).findByLabelText('Đoạn cấu hình cho Claude Desktop')).toBeVisible();
  });

  it('"Cho phép AI sửa ghi chú cá nhân" is off by default and saves at once', async () => {
    const user = userEvent.setup();
    renderSettings();
    const toggle = await screen.findByRole('switch', { name: 'Cho phép AI sửa ghi chú cá nhân' });
    expect(toggle).not.toBeChecked();
    expect(toggle).toHaveAccessibleDescription(
      'Khi tắt, Claude chỉ viết vào wiki/, thêm vào Inbox và vào ghi chú hôm nay. Khi bật, Claude được sửa cả ghi chú của bạn, và luôn kiểm tra mình đang sửa bản mới nhất.',
    );
    await user.click(toggle);
    await waitFor(() => expect(puts()).toEqual([{ mcp: { allowNoteEdits: true } }]));
    await waitFor(() => expect(toggle).toBeChecked());
    await user.click(toggle);
    await waitFor(() => expect(puts()[1]).toEqual({ mcp: { allowNoteEdits: false } }));
  });
});
