// Thin bridge to the chat (#968): "open this conversation" for the sidebar. The chat folder is built by another
// change; once it exports openChatSession(cliSessionId) (web/src/chat/index.ts), swap this body for that import.
// Until then the dock can listen for the window event below (detail.cliSessionId).
import { OPEN_CHAT_SESSION } from './chatHistory';

export function openChatSession(cliSessionId: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_CHAT_SESSION, { detail: { cliSessionId } }));
}
