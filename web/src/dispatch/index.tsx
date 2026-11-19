// /dispatch in project mode (no workspace, server/app.js sends every editor URL here): the same 세션 보드 the
// Drawing shell shows (#731), without the sidebar since there is no workspace to list. The address uses the shell's
// `#board…` hashes; old `/dispatch#usage`, `#folder=`, `#tv`, `#settings` links still work. In drawing mode main.tsx
// sends /dispatch to `/#board…` instead, so this file is only the project-mode wrapper.
// Loaded lazily from main.tsx so the editor bundle does not carry it.
import { useCallback, useEffect, useState } from 'react';
import { useTheme } from '../theme';
import { ActivityAlerts } from '../activity/ActivityAlerts';
import { boardHash, legacyBoardHash, parseBoardHash, type BoardExtra, type BoardSection } from '../projectNav';
import SessionBoard from './SessionBoard';
import { AgentLiveHost } from '../live/AgentLivePanel';
import { agentFromHash, withAgent } from '../live/store';
import { connect } from './store';

export { connect };

/** The board route of the address (old /dispatch hashes read as their board equivalent). */
const read = () => parseBoardHash(legacyBoardHash(location.hash))!;

export default function DispatchApp() {
  useTheme();
  const [route, setRoute] = useState<BoardSection>(() => {
    const r = read();
    return { kind: 'board', tab: r.tab, folder: r.folder };
  });
  const [extra, setExtra] = useState<BoardExtra | null>(() => read().extra ?? null);
  const [openRequest, setOpenRequest] = useState<{ id: string; n: number } | null>(null);

  // Rewrite an old hash to the board's once, then follow back/forward.
  useEffect(() => {
    history.replaceState(null, '', location.pathname + location.search + withAgent(boardHash({ ...route, extra: extra ?? undefined }), agentFromHash(location.hash)));
    const on = () => {
      const r = read();
      setRoute({ kind: 'board', tab: r.tab, folder: r.folder });
      if (r.extra) setExtra(r.extra);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const onRoute = useCallback((tab: BoardSection['tab'], folder: string | null | undefined) => {
    const next: BoardSection = { kind: 'board', tab, folder };
    const url = location.pathname + location.search + withAgent(boardHash(next), agentFromHash(location.hash));
    if (location.pathname + location.search + location.hash !== url) history.pushState(null, '', url);
    setRoute(next);
  }, []);
  const extraDone = useCallback(() => {
    setExtra(null);
    setRoute((r) => {
      history.replaceState(null, '', location.pathname + location.search + withAgent(boardHash(r), agentFromHash(location.hash)));
      return r;
    });
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <SessionBoard tab={route.tab} folder={route.folder} onRoute={onRoute} openRequest={openRequest} extra={extra} onExtraDone={extraDone} />
      {/* App and agent toasts (E540, #671); 열기 on a document goes to the editor. */}
      <ActivityAlerts onOpen={(p) => window.location.assign(`/#file=${encodeURIComponent(p)}`)} onSession={(id) => setOpenRequest({ id, n: Date.now() })} />
      <AgentLiveHost onOpenFile={(p) => window.location.assign(`/#file=${encodeURIComponent(p)}`)} />
    </div>
  );
}
