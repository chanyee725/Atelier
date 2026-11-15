// 세션 tab of a project home: the project's sessions (open ones first) and its run records (metadata only).
// Sessions come from GET /api/state (the snapshot, polled while the tab is open); run records from
// GET /api/runs/list?folder=. Either answer failing shows a plain note, never an error screen.
import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { fmtUsd, isOpen, STATE, stateOf } from '../dispatch/lib/format.ts';
import { sessionsOf } from '../dispatch/lib/folder.ts';
import { relativeTime } from './model';
import type { Session } from '../../../shared/dispatch/types.ts';

type RunRow = { file: string; id: string; startedAt: number | null; endedAt: number | null; state: string; totals?: { cost: number; mtok: number } };

const RUN_STATE: Record<string, string> = { running: '실행 중', paused: '멈춤', done: '완료', failed: '실패', stopped: '중단' };
const SESSIONS_SHOWN = 8;
const POLL_MS = 15_000;

/** Fetches JSON; null when the server has no such route or answers an error. */
const getJson = <T,>(url: string, signal: AbortSignal) =>
  fetch(url, { signal }).then((r) => (r.ok ? (r.json() as Promise<T>) : null), () => null);

const Block = ({ title, note, children }: { title: string; note?: React.ReactNode; children: React.ReactNode }) => (
  <section aria-label={title} className="min-w-0 rounded-lg border bg-card">
    <header className="flex items-center gap-2 border-b px-4 py-2.5">
      <h2 className="m-0 text-[15px] font-semibold">{title}</h2>
      <span className="ml-auto text-sm text-muted-foreground">{note}</span>
    </header>
    {children}
  </section>
);
const Note = ({ children }: { children: React.ReactNode }) => <p className="m-0 px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>;

export function ProjectSessions({ folder, onOpen }: { folder: string; onOpen: (path: string) => void }) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    setSessions(null);
    setRuns(null);
    const loadSessions = () =>
      void getJson<{ sessions: Session[] }>('/api/state', ctl.signal).then((d) => !ctl.signal.aborted && setSessions(d ? sessionsOf(d.sessions ?? [], folder) : []));
    loadSessions();
    void getJson<{ runs: RunRow[] }>(`/api/runs/list?folder=${encodeURIComponent(folder)}`, ctl.signal).then((d) => !ctl.signal.aborted && setRuns(d?.runs ?? []));
    const t = setInterval(() => document.visibilityState === 'visible' && loadSessions(), POLL_MS);
    return () => {
      ctl.abort();
      clearInterval(t);
    };
  }, [folder]);

  const board = `/dispatch#folder=${encodeURIComponent(folder)}`;
  const open = sessions?.filter(isOpen).length ?? 0;
  return (
    <div className="grid grid-cols-2 gap-3 px-2 pt-3 max-lg:grid-cols-1">
      <Block
        title="세션"
        note={
          <a href={board} className="inline-flex items-center gap-1 text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            세션 보드에서 보기 <ExternalLink aria-hidden className="size-3.5" />
          </a>
        }
      >
        {sessions === null ? (
          <Note>불러오는 중이에요</Note>
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

      <Block title="실행 기록" note={runs && runs.length > 0 ? `${runs.length}건` : undefined}>
        {runs === null ? (
          <Note>불러오는 중이에요</Note>
        ) : runs.length === 0 ? (
          <Note>이 프로젝트에서 실행한 파이프라인이 아직 없어요.</Note>
        ) : (
          <ul className="m-0 list-none divide-y p-0">
            {runs.map((r) => (
              <li key={`${r.file}/${r.id}`}>
                <button
                  type="button"
                  onClick={() => onOpen(r.file)}
                  className="flex w-full min-w-0 items-center gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <span className="truncate font-medium">{r.file.slice(folder.length + 1)}</span>
                  <Badge variant="secondary" className="shrink-0">{RUN_STATE[r.state] ?? r.state}</Badge>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                    {r.totals ? `${fmtUsd(r.totals.cost)} · ` : ''}{relativeTime(r.startedAt ?? 0)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Block>
    </div>
  );
}
