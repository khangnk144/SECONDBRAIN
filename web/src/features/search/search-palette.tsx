import { useSearchUi } from '../../lib/search-ui-store';
import { SearchPaletteDialog } from './search-palette-dialog';

/**
 * Mounted once by the layout; shows the palette while `useSearchUi.open` is set (`Ctrl+K`, the
 * sidebar search box, tag pills). Each opening mounts a fresh dialog, so focus handling and the
 * first request start over.
 */
export function SearchPalette() {
  const open = useSearchUi((state) => state.open);
  return open ? <SearchPaletteDialog /> : null;
}
