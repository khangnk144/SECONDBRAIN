import {
  ArrowSquareOut,
  DotsThreeVertical,
  DownloadSimple,
  FolderOpen,
  FileText,
} from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from '../../i18n';
import type { ResourceFile } from '../../lib/api/resources-types';
import { postReveal } from '../../lib/api/vault-api';
import { openVaultFile } from '../../lib/open-vault-file';
import { showToast } from '../../lib/toast-store';
import { PopupMenu, type PopupMenuItem } from '../dialogs/popup-menu';
import { downloadVaultFile, openWithOtherApp } from '../viewer/vault-file-actions';

async function revealFile(file: ResourceFile): Promise<void> {
  try {
    await postReveal(file.path);
  } catch (error) {
    showToast({
      message: i18n.t(
        error instanceof TypeError ? 'viewer.files.offline' : 'resources.revealFailed',
        {
          name: file.name,
        },
      ),
      tone: 'error',
    });
  }
}

/** Row menu: Mở, Tải về, Mở bằng ứng dụng khác, Hiện trong thư mục (↓ or Enter opens it). */
export function ResourceRowMenu({ file }: { file: ResourceFile }) {
  const { t } = useTranslation();
  const button = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

  const open = () => {
    const rect = button.current?.getBoundingClientRect();
    if (rect) setPosition({ x: rect.left, y: rect.bottom + 4 });
  };

  const items: PopupMenuItem[] = [
    {
      id: 'open',
      label: t('resources.menu.open'),
      icon: FileText,
      onSelect: () => openVaultFile(file.path),
    },
    {
      id: 'download',
      label: t('viewer.files.download'),
      icon: DownloadSimple,
      onSelect: () => void downloadVaultFile(file.path),
    },
    {
      id: 'open-external',
      label: t('viewer.files.openExternal'),
      icon: ArrowSquareOut,
      onSelect: () => void openWithOtherApp(file.path),
    },
    {
      id: 'reveal',
      label: t('resources.menu.reveal'),
      icon: FolderOpen,
      onSelect: () => void revealFile(file),
    },
  ];

  return (
    <>
      <button
        ref={button}
        type="button"
        className="icon-button resource-row__menu"
        aria-label={t('resources.menu.button', { name: file.name })}
        aria-haspopup="menu"
        aria-expanded={position !== null}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return;
          event.preventDefault();
          open();
        }}
      >
        <DotsThreeVertical size={18} aria-hidden="true" focusable="false" />
      </button>
      {position ? (
        <PopupMenu
          label={t('resources.menu.label', { name: file.name })}
          items={items}
          position={position}
          onClose={() => {
            setPosition(null);
            button.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}
