import { boardHash, parseBoardHash, type BoardSection } from '../projectNav';
import { agentFromHash, withAgent } from '../live/store';

// The open file lives in the URL hash so a reload reopens it. Only the workspace-relative path is kept, plus the
// open agent live view (`&agent=<sid>`, web/src/live/store.ts), which survives a file change.
// Leaving the 세션 보드 adds a history entry, so 뒤로 goes back to the board (#731).
export const setHashPath = (p: string | null) => {
  const sid = agentFromHash(window.location.hash);
  const url = `${window.location.pathname}${window.location.search}${withAgent(p ? `#file=${encodeURIComponent(p)}` : '', sid)}`;
  if (parseBoardHash(window.location.hash)) window.history.pushState({ drawing: 1 }, '', url);
  else window.history.replaceState({ drawing: 1 }, '', url);
};
// The 세션 보드's address: a new history entry when it changes, so back/forward walk the board's tabs and scope.
export const setBoardHash = (b: BoardSection, replace = false) => {
  const url = `${window.location.pathname}${window.location.search}${withAgent(boardHash(b), agentFromHash(window.location.hash))}`;
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` === url) return;
  if (replace) window.history.replaceState({ drawing: 1 }, '', url);
  else window.history.pushState({ drawing: 1 }, '', url);
};
/** The board route of the address this page opened with, if any. */
export const initialBoard = () => parseBoardHash(window.location.hash);
// A link followed in this tab was cancelled or failed: the browser already added a history entry for it.
// Step back over that entry (state is null on entries the browser made) so history has no duplicate of the open file.
export const undoLinkEntry = (current: string | null) => {
  if (window.history.state === null) window.history.back();
  else setHashPath(current);
};
