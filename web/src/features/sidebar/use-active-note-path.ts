import { useLocation, useSearchParams } from 'react-router';
import { NOTE_ROUTE } from '../../lib/app-navigation';

/** Path of the note on screen (`#/note?path=…`), or null on other routes. */
export function useActiveNotePath(): string | null {
  const location = useLocation();
  const [params] = useSearchParams();
  return location.pathname === NOTE_ROUTE ? params.get('path') : null;
}
