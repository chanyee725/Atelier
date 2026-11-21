import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { parseHash } from '../doc/outline';
import type { FileSession } from '../fileSession';
import { parseBoardHash, type BoardExtra, type Section } from '../projectNav';
import { setHashPath, undoLinkEntry } from './hashRoute';

type HashNavigation = {
  session: FileSession;
  open: (p: string) => Promise<boolean>;
  jumpTo: (id: string | null) => void;
  setSection: Dispatch<SetStateAction<Section>>;
  setBoardExtra: (extra: BoardExtra) => void;
};

/** A heading link pasted into the address bar of this tab (only the hash changes, so the page does not reload). */
export function useHashNavigation({ session, open, jumpTo, setSection, setBoardExtra }: HashNavigation) {
  useEffect(() => {
    const onHash = () => {
      // Back/forward into or within the 세션 보드 (#731).
      const board = parseBoardHash(window.location.hash);
      if (board) {
        setSection({ kind: 'board', tab: board.tab, folder: board.folder });
        if (board.extra) setBoardExtra(board.extra);
        return;
      }
      const link = parseHash(window.location.hash);
      if (!link) {
        // Back from the board to an entry without a file: the dashboard.
        setSection((s) => (s.kind === 'board' ? { kind: 'all' } : s));
        return;
      }
      // Drop `&h=` (same file) or restore the open file's hash (cancelled or failed open), so the
      // address bar always names the open file and following the same link again fires `hashchange`.
      const current = session.getState().path;
      if (link.path === current) {
        setSection({ kind: 'doc' });
        setHashPath(current);
        return jumpTo(link.heading);
      }
      void open(link.path).then((ok) => {
        if (ok) jumpTo(link.heading);
        else undoLinkEntry(session.getState().path);
      });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [session, open, jumpTo]);
}
