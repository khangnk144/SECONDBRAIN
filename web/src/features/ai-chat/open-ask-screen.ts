import { ASK_ROUTE, navigateTo } from '../../lib/app-navigation';
import { requestChatFocus } from './chat-store';
import { ASK_THREAD } from './chat-types';

/** Palette "Hỏi AI…": the Ask screen, with focus in its question box. */
export function openAskScreen(): void {
  requestChatFocus(ASK_THREAD);
  navigateTo(ASK_ROUTE);
}
