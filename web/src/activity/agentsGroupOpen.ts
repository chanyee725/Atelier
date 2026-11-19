// Open/closed state of the sidebar's "작업 중인 에이전트" group (E556, #725), remembered across reloads in
// localStorage. Open unless the user folded it. Only a boolean is stored, never agent data.
export const AGENTS_OPEN_KEY = 'drawing.sidebar.agentsOpen';

/** The stored value: only an explicit '0' means folded, anything else (missing, garbage) opens the group. */
export const parseAgentsOpen = (raw: string | null): boolean => raw !== '0';

export function readAgentsOpen(): boolean {
  try {
    return parseAgentsOpen(localStorage.getItem(AGENTS_OPEN_KEY));
  } catch {
    return true;
  }
}

export function writeAgentsOpen(open: boolean): void {
  try {
    if (open) localStorage.removeItem(AGENTS_OPEN_KEY);
    else localStorage.setItem(AGENTS_OPEN_KEY, '0');
  } catch {
    // Storage off (private mode, quota): the choice lasts for this page only.
  }
}
