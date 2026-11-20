// 문서 tab of the 진행 중 card (#975): documents a session writes now and plans that run now, one line each. Click opens
// the document (a running plan opens in its run view). Quiet on purpose: the dashboard's standout stays the working-session number.
import { useEffect, useMemo, useState } from 'react';
import { FileText, LoaderCircle } from 'lucide-react';
import { ProviderIcon } from '../ProviderIcon';
import { cn } from '../lib/utils';
import { EmptyState } from './dash';
import { activeDocs, stepProgress, type ActiveDoc, type DocFacts, type RunProgress } from './activeDocs';
import { pollWhileVisible, relativeTime } from './model';
import { allDocs } from './model';
import type { ProjectInfo } from '../api';
import type { AgentPresence } from './agents';

const PROGRESS_POLL_MS = 10_000;
type Run = { id: string; state: string };
const getJson = async <T,>(url: string, signal: AbortSignal): Promise<T | null> => {
  try {
    const r = await fetch(url, { signal });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null; // aborted, offline or a server without the runs module: no progress bar
  }
};

/** Finished steps of each running plan (its live run's record), refreshed while the page is visible. Metadata only. */
function useRunProgress(files: readonly string[]): ReadonlyMap<string, RunProgress> {
  const [map, setMap] = useState<ReadonlyMap<string, RunProgress>>(new Map());
  const key = files.join('\n');
  useEffect(() => {
    if (!key) return setMap(new Map());
    const ctl = new AbortController();
    const load = () =>
      void Promise.all(
        key.split('\n').map(async (f) => {
          const q = `path=${encodeURIComponent(f)}`;
          const list = await getJson<{ runs: Run[] }>(`/api/runs?${q}`, ctl.signal);
          const run = list?.runs?.find((r) => r.state === 'running') ?? list?.runs?.[0];
          const rec = run ? await getJson<{ steps?: Record<string, { state: string }> }>(`/api/runs/run?${q}&id=${encodeURIComponent(run.id)}`, ctl.signal) : null;
          const p = rec ? stepProgress(rec.steps) : null;
          return p ? ([f, p] as const) : null;
        }),
      ).then((rows) => !ctl.signal.aborted && setMap(new Map(rows.flatMap((r) => (r ? [r] : [])))));
    const stop = pollWhileVisible(load, PROGRESS_POLL_MS);
    load();
    return () => {
      ctl.abort();
      stop();
    };
  }, [key]);
  return map;
}

/** The active documents of a project: presence files and running plans, with step progress. */
export function useActiveDocs(project: ProjectInfo, agents: AgentPresence[] | 'off' | 'failed' | null): ActiveDoc[] {
  const facts = useMemo<DocFacts[]>(() => allDocs([project], []).map(({ doc }) => ({ path: doc.path, title: doc.title, modifiedAt: doc.modifiedAt, plan: doc.plan })), [project]);
  const running = useMemo(() => facts.filter((d) => d.plan === 'running').map((d) => d.path), [facts]);
  const progress = useRunProgress(running);
  return useMemo(() => activeDocs(Array.isArray(agents) ? agents : [], facts, progress, project.path), [agents, facts, progress, project.path]);
}

export function ActiveDocsList({ docs, onOpen, now = Date.now() }: { docs: readonly ActiveDoc[]; onOpen: (path: string) => void; now?: number }) {
  if (!docs.length) return <EmptyState>지금 쓰고 있는 문서가 없어요.</EmptyState>;
  return (
    <ul aria-label="진행 중인 문서" className="m-0 list-none p-0 *:border-t">
      {docs.map((d) => (
        <DocLine key={d.path} doc={d} onOpen={onOpen} now={now} />
      ))}
    </ul>
  );
}

function DocLine({ doc: d, onOpen, now }: { doc: ActiveDoc; onOpen: (path: string) => void; now: number }) {
  const who = d.agents[0];
  const model = who?.modelLabel || who?.model;
  const p = d.progress;
  const text = p ? `${p.done}/${p.total} 단계` : null;
  return (
    <li data-active-doc={d.path} data-source={d.source} className="min-w-0">
      <button
        type="button"
        onClick={() => onOpen(d.path)}
        className="grid w-full min-w-0 gap-1 border-0 bg-transparent px-3 py-2 text-left text-sm text-inherit transition-colors hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
      >
        <span className="flex min-w-0 items-center gap-2">
          <FileText aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate" title={d.title}>{d.title}</span>
          {d.area && <span className="min-w-0 shrink truncate text-xs text-muted-foreground" title={d.area}>{d.area}</span>}
          <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{d.modifiedAt ? relativeTime(d.modifiedAt, now) : ''}</span>
        </span>
        <span className="flex min-w-0 items-center gap-x-3 pl-[1.375rem] text-xs text-muted-foreground">
          {d.source === 'plan' && <span className="shrink-0">계획 실행 중</span>}
          {who && (
            <span data-doc-agent className="inline-flex min-w-0 items-center gap-1" title={model ?? undefined}>
              <ProviderIcon provider={who.provider} className="size-3 shrink-0" />
              <span className="truncate text-foreground">{who.name}{d.agents.length > 1 ? ` 외 ${d.agents.length - 1}` : ''}</span>
            </span>
          )}
          {d.doing && <span className={cn('min-w-0 truncate')} title={d.doing}>{d.doing}</span>}
        </span>
        {p && p.total > 0 && (
          <span data-doc-progress className="flex min-w-0 items-center gap-2 pl-[1.375rem] text-xs text-muted-foreground">
            <span role="progressbar" aria-label={text!} aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.done} className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/8">
              <span className="block h-full rounded-full bg-merged" style={{ width: `${(p.done / p.total) * 100}%` }} />
            </span>
            <span aria-hidden className="shrink-0 tabular-nums">{text}</span>
          </span>
        )}
      </button>
    </li>
  );
}

/** Small "실행 중" mark (dot and spinner) for an issue row of the 이슈 card. */
export function RunningMark() {
  return (
    <span data-issue-running className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--role-impl)]" />
      <span aria-hidden className="grid size-3 place-items-center motion-safe:animate-spin">
        <LoaderCircle className="block size-3" />
      </span>
      실행 중
    </span>
  );
}
