// 세션 tab of a project home: the project's sessions (open ones first) and its run records (metadata only).
// Sessions come from GET /api/state (the snapshot, polled while the tab is open); run records from RunsBlock, the same
// list the 파이프라인 tab shows. Either answer failing shows a plain note, never an error screen.
import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { fmtUsd, isOpen, STATE, stateOf } from '../dispatch/lib/format.ts';
import { sessionsOf } from '../dispatch/lib/folder.ts';
import { boardHash, plainClick } from '../projectNav';
import { Block, getJson, Note, RunsBlock } from './ProjectRuns';
import type { Session } from '../../../shared/dispatch/types.ts';

const SESSIONS_SHOWN = 8;
const POLL_MS = 15_000;

export function ProjectSessions({ folder, onOpen, onBoard }: { folder: string; onOpen: (path: string) => void; onBoard: (folder: string) => void }) {
  const [sessions, setSessions] = useState<Session[] | 'failed' | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    setSessions(null);
    const loadSessions = () =>
      void getJson<{ sessions: Session[] }>('/api/state', ctl.signal).then((d) => !ctl.signal.aborted && setSessions(d ? sessionsOf(d.sessions ?? [], folder) : 'failed'));
    loadSessions();
    const t = setInterval(() => document.visibilityState === 'visible' && loadSessions(), POLL_MS);
    return () => {
      ctl.abort();
      clearInterval(t);
    };
  }, [folder]);

  // Same target as the click: '' is the whole project, so the board opens unscoped (#715).
  const board = `/${boardHash({ tab: 'sessions', folder: folder || undefined })}`;
  const list = Array.isArray(sessions) ? sessions : [];
  const open = list.filter(isOpen).length;
  return (
    <div className="grid grid-cols-2 gap-3 px-2 pt-3 max-lg:grid-cols-1">
      <Block
        title="세션"
        note={
          <a href={board} onClick={(e) => (plainClick(e) ? (e.preventDefault(), onBoard(folder)) : undefined)} className="inline-flex items-center gap-1 text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            세션 보드에서 보기 <ArrowRight aria-hidden className="size-3.5" />
          </a>
        }
      >
        {sessions === null ? (
          <Note>불러오는 중이에요</Note>
        ) : sessions === 'failed' ? (
          <Note>세션을 불러오지 못했어요.</Note>
        ) : sessions.length === 0 ? (
          <Note>이 프로젝트의 세션이 아직 없어요. 계획 문서에서 시작하기를 누르면 여기에 보여요.</Note>
        ) : (
          <>
            <p className="m-0 border-b px-4 py-2 text-xs text-muted-foreground tabular-nums">열린 세션 {open}개 · 전체 {sessions.length}개</p>
            <ul className="m-0 list-none divide-y p-0">
              {sessions.slice(0, SESSIONS_SHOWN).map((s) => {
                const st = stateOf(s);
                return (
                  <li key={s.id} className="flex min-w-0 items-center gap-2 px-4 py-2 text-sm">
                    <span className="truncate font-medium">{s.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{s.roleName}</span>
                    <Badge variant="secondary" className="ml-auto shrink-0">{STATE[st].label}</Badge>
                    <span className="w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{fmtUsd(s.cost)}</span>
                  </li>
                );
              })}
            </ul>
            {sessions.length > SESSIONS_SHOWN && <p className="m-0 border-t px-4 py-2 text-xs text-muted-foreground">나머지 {sessions.length - SESSIONS_SHOWN}개는 세션 보드에서 봐요.</p>}
          </>
        )}
      </Block>

      <RunsBlock folder={folder} onOpen={onOpen} />
    </div>
  );
}
