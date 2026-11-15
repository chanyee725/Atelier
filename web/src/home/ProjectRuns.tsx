// Run records of a project (metadata only) from GET /api/runs/list?folder=. One source for the 파이프라인 tab and the
// 세션 tab of a project home, so the two never disagree about whether the project has runs.
import { useEffect, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { fmtUsd } from '../dispatch/lib/format.ts';
import { relativeTime } from './model';

export type RunRow = { file: string; id: string; startedAt: number | null; endedAt: number | null; state: string; totals?: { cost: number; mtok: number } };

const RUN_STATE: Record<string, string> = { running: '실행 중', paused: '멈춤', done: '완료', failed: '실패', stopped: '중단' };

/** Fetches JSON; null when the server has no such route or answers an error. */
export const getJson = <T,>(url: string, signal: AbortSignal) =>
  fetch(url, { signal }).then((r) => (r.ok ? (r.json() as Promise<T>) : null), () => null);

export const Block = ({ title, note, children }: { title: string; note?: React.ReactNode; children: React.ReactNode }) => (
  <section aria-label={title} className="min-w-0 rounded-lg border bg-card">
    <header className="flex items-center gap-2 border-b px-4 py-2.5">
      <h2 className="m-0 text-[15px] font-semibold">{title}</h2>
      <span className="ml-auto text-sm text-muted-foreground">{note}</span>
    </header>
    {children}
  </section>
);
export const Note = ({ children }: { children: React.ReactNode }) => <p className="m-0 px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>;

/** The project's run records: null while loading, 'failed' when the list could not be read. */
export function useProjectRuns(folder: string): RunRow[] | 'failed' | null {
  const [runs, setRuns] = useState<RunRow[] | 'failed' | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    setRuns(null);
    void getJson<{ runs: RunRow[] }>(`/api/runs/list?folder=${encodeURIComponent(folder)}`, ctl.signal).then((d) => !ctl.signal.aborted && setRuns(d ? d.runs ?? [] : 'failed'));
    return () => ctl.abort();
  }, [folder]);
  return runs;
}

export function RunsBlock({ folder, onOpen }: { folder: string; onOpen: (path: string) => void }) {
  const runs = useProjectRuns(folder);
  const list = Array.isArray(runs) ? runs : null;
  return (
    <Block title="실행 기록" note={list && list.length > 0 ? `${list.length}건` : undefined}>
      {runs === null ? (
        <Note>불러오는 중이에요</Note>
      ) : runs === 'failed' ? (
        <Note>실행 기록을 불러오지 못했어요.</Note>
      ) : runs.length === 0 ? (
        <Note>이 프로젝트에서 실행한 파이프라인이 아직 없어요. 계획 문서에서 시작하기를 누르면 여기에 보여요.</Note>
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
  );
}
