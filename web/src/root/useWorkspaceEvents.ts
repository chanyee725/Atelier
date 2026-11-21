import { useEffect, type RefObject } from 'react';
import { api, type DpxFile } from '../api';
import type { CursorEvent, CursorStatusEvent } from '../canvas/agentCursor';
import { applyCursorEvent, applyCursorStatusEvent, clearCursors } from '../canvas/cursorStore';
import { applyDocCursorEvent, applyDocCursorStatusEvent, clearDocCursors } from '../doc/docCursorStore';
import { canApplyLive, movedOpenPath, type WorkspaceEvent } from '../externalChange';
import type { FileSession } from '../fileSession';
import { events } from '../lib/events';
import { onRunEvent, reloadRun } from '../run/runData';
import type { RunEvent } from '../run/runModel';
import { setHashPath } from './hashRoute';

type WorkspaceEvents = {
  session: FileSession;
  load: (p: string, f: DpxFile) => void;
  refreshTree: () => Promise<void>;
  /** Moves started in this tab, by their `from` path: their echo is not an outside move. */
  ownMoves: RefObject<Set<string>>;
  /** Path this tab is deleting right now: its close needs no error. */
  removing: RefObject<string | null>;
  setError: (message: string | null) => void;
};

// The server now runs in another folder: everything on screen belongs to the old one, so start over at home.
const reloadForWorkspace = () => window.location.assign('/');

/** Other tabs and outside edits: keep the file list current, reload the open file when it changed and holds no unsaved edits. */
export function useWorkspaceEvents({ session, load, refreshTree, ownMoves, removing, setError }: WorkspaceEvents) {
  useEffect(() => {
    // Another tab switched the server to another folder (E554).
    const offSwitch = events.subscribeJson('workspace-switch', reloadForWorkspace);
    const offWorkspace = events.subscribeJson<WorkspaceEvent>('workspace', (e) => {
      // This tab's own move already renames the open file; the echo must not close it.
      if (e.kind === 'tree' && e.from !== undefined && ownMoves.current.delete(e.from)) {
        void refreshTree();
        return;
      }
      // An outside move of the open file (or its folder) follows it to the new path instead of closing it.
      const next = movedOpenPath(e, session.getState().path);
      if (next) {
        void api.readFile(next).then(
          (f) => {
            session.rename(next, f.revision);
            setHashPath(next);
          },
          () => {
            // The new path cannot be read: close it as before.
            if (session.external(e, (p) => api.readFile(p), () => {}) === 'close') {
              setHashPath(null);
              setError('열어 둔 파일이 지워졌거나 옮겨졌어요');
            }
          },
        );
        void refreshTree();
        return;
      }
      if (session.external(e, (p) => api.readFile(p), (p, f) => (canApplyLive(session.getState().file, f) ? session.applyLive(p, f) : load(p, f))) === 'close') {
        setHashPath(null);
        // Our own delete can be announced before its response arrives: that close needs no error.
        if (!removing.current) setError('열어 둔 파일이 지워졌거나 옮겨졌어요');
      }
      void refreshTree();
    });
    // Runs of the open file; a run starting or ending also changes its tree badge.
    const offRun = events.subscribeJson<RunEvent>('run', (e) => {
      onRunEvent(e);
      if (e.run) void refreshTree();
      // A run that ended: no agent is editing its file any more.
      if (e.run?.endedAt) {
        clearCursors(e.file);
        clearDocCursors(e.file);
      }
    });
    // Live agent cursors (E56): where an agent session is editing a diagram. A malformed event moves nothing.
    // The same events place agent cursors in the document (E529) when they carry a document place.
    const offCursor = events.subscribeJson<CursorEvent>('cursor', (e) => {
      applyCursorEvent(e);
      applyDocCursorEvent(e);
    });
    // A session's status label changed (E536): the tag text only, the cursor stays where it is.
    const offStatus = events.subscribeJson<CursorStatusEvent>('cursor-status', (e) => {
      applyCursorStatusEvent(e);
      applyDocCursorStatusEvent(e);
    });
    // Events missed while the stream was down: read the run again. Cursors from before the gap are stale; the server
    // sends the cursors of sessions still at work to the new connection (live cursors only leave on `gone`).
    const offOpen = events.onConnection((online) => {
      if (!online) return;
      clearCursors();
      clearDocCursors();
      void reloadRun();
    });
    return () => {
      offSwitch();
      offWorkspace();
      offRun();
      offCursor();
      offStatus();
      offOpen();
    };
  }, [session, load, refreshTree]);
}
