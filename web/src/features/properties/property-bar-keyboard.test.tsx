import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installFetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { applyTestPatch } from '../note-session/session-test-patch';
import type { FrontmatterChange } from '../note-session/note-session-types';
import { PropertyBar } from './property-bar';

const RAW = '---\ntype: project\nstatus: doing\nnguồn: sách\n---\n';

/** The bar with front matter that really changes when a patch succeeds. */
function Harness({ onPatch }: { onPatch: (change: FrontmatterChange) => void }) {
  const [raw, setRaw] = useState<string | null>(RAW);
  return (
    <PropertyBar
      frontmatterRaw={raw}
      disabled={false}
      onPatch={async (change) => {
        onPatch(change);
        const next = applyTestPatch(raw ?? '', change.set ?? {}, change.unset ?? []);
        setRaw(next === '' ? null : next);
        return true;
      }}
    />
  );
}

const main = (name: RegExp) => screen.getByRole('button', { name });

async function removeWithKeyboard(label: string) {
  const button = screen.getByRole('button', { name: `Xóa thuộc tính ${label}` });
  button.focus();
  await act(async () => {
    fireEvent.click(button);
  });
}

describe('property bar keyboard use', () => {
  beforeEach(async () => {
    await resetAppState('vault-a');
    installFetchMock();
  });

  it('after removing a property, focus goes to the next chip, else the previous, else "Thêm"', async () => {
    render(<Harness onPatch={vi.fn()} />);
    await removeWithKeyboard('Loại');
    expect(document.activeElement).toBe(main(/^Trạng thái/));
    await removeWithKeyboard('nguồn');
    expect(document.activeElement).toBe(main(/^Trạng thái/));
    await removeWithKeyboard('Trạng thái');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Thêm thuộc tính' }));
  });

  it('the status list opens on the current value; arrows move, Enter picks, nothing changes before', () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} />);
    fireEvent.click(main(/^Trạng thái/));
    const doing = screen.getByRole('button', { name: 'Đang làm' });
    expect(document.activeElement).toBe(doing);
    fireEvent.keyDown(doing, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Xong' }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cần làm' }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Xong' }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home' });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Xong' }));
    expect(onPatch).not.toHaveBeenCalled();
    // Enter on a button is its click.
    fireEvent.click(document.activeElement as HTMLElement);
    expect(onPatch).toHaveBeenCalledWith({ set: { status: 'done' } });
  });

  it('Esc closes the list and gives focus back to the chip', () => {
    render(<Harness onPatch={vi.fn()} />);
    fireEvent.click(main(/^Loại/));
    const current = screen.getByRole('button', { name: 'Dự án' });
    expect(document.activeElement).toBe(current);
    fireEvent.keyDown(current, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(main(/^Loại/));
  });
});
