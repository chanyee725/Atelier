// Data for the home dashboard (E545, #685). Every source is one the app already reads elsewhere; nothing new on
// the server, nothing stored. Metadata only: session names, branches, PR numbers, usage percentages.
//   - usage per provider: GET /api/limits + GET /api/state providers (same as 설정 > 사용 한도, #676)
//   - repo: GET /api/workspace/pr-tracking, GET /api/state (project branch, open sessions' branches),
//     and the PR numbers in the records of runs going now (GET /api/runs/active → /api/runs → /api/runs/run)
import { useEffect, useState } from 'react';
import { api, type ProviderLimits, type ProviderState } from '../api';
import { isOpen } from '../dispatch/lib/format.ts';
import { usageGroups, type UsageEntry, type UsageGroup } from '../settings/model';
import { getJson } from './ProjectRuns';
import { pollWhileVisible } from './model';
import type { Session } from '../../../shared/dispatch/types.ts';

const POLL_MS = 30_000;

/** Connected providers with their usage windows; null while loading, 'failed' when either request failed. */
export function useUsage(): UsageGroup[] | 'failed' | null {
  const [groups, setGroups] = useState<UsageGroup[] | 'failed' | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      void Promise.all([api.limits(), api.providers()]).then(
        ([l, p]: [ProviderLimits, Record<string, ProviderState>]) => live && setGroups(usageGroups(l as Record<string, UsageEntry>, p)),
        () => live && setGroups((old) => (Array.isArray(old) ? old : 'failed')),
      );
    const stop = pollWhileVisible(load, POLL_MS);
    return () => {
      live = false;
      stop();
    };
  }, []);
  return groups;
}

export type RepoPr = { number: number; state: string | null; branch: string | null; session: string | null; file: string };
export type RepoBranch = { name: string; sessions: string[] };
export type RepoStatus = {
  /** PR tracking switch; 'unknown' when the server has no such route. */
  tracking: boolean | 'unknown';
  /** The integration branch the project checkout is on (null when Dispatch is off). */
  base: string | null;
  /** Branches open sessions work on, with who works there. */
  branches: RepoBranch[];
  /** PRs of the runs going now, open ones first. */
  prs: RepoPr[];
};

type RunSummary = { id: string; state: string };
type RunRecordLite = { steps?: Record<string, { sessions?: { name?: string; branch?: string; pr?: { number: number; state: string | null } | null }[] }> };

/** At most this many running files are read for PR numbers (each costs two requests). */
const RUN_FILES_MAX = 6;

async function prsOfRunningRuns(signal: AbortSignal): Promise<RepoPr[]> {
  const active = await getJson<{ files: string[] }>('/api/runs/active', signal);
  const out = new Map<number, RepoPr>();
  for (const file of (active?.files ?? []).slice(0, RUN_FILES_MAX)) {
    const q = `path=${encodeURIComponent(file)}`;
    const list = await getJson<{ runs: RunSummary[] }>(`/api/runs?${q}`, signal);
    for (const run of (list?.runs ?? []).filter((r) => r.state === 'running' || r.state === 'paused').slice(0, 1)) {
      const rec = await getJson<RunRecordLite>(`/api/runs/run?${q}&id=${encodeURIComponent(run.id)}`, signal);
      for (const step of Object.values(rec?.steps ?? {}))
        for (const s of step.sessions ?? [])
          if (s.pr && Number.isInteger(s.pr.number)) out.set(s.pr.number, { number: s.pr.number, state: s.pr.state, branch: s.branch ?? null, session: s.name ?? null, file });
    }
  }
  const rank = (p: RepoPr) => (p.state === 'open' || p.state === null ? 0 : 1);
  return [...out.values()].sort((a, b) => rank(a) - rank(b) || b.number - a.number);
}

/** Branches of open sessions, most used first; the base branch is left out. */
export function branchesOf(sessions: readonly Pick<Session, 'name' | 'branch' | 'status'>[], base: string | null): RepoBranch[] {
  const m = new Map<string, string[]>();
  for (const s of sessions) if (s.branch && s.branch !== base && isOpen(s)) m.set(s.branch, [...(m.get(s.branch) ?? []), s.name]);
  return [...m].map(([name, sessions]) => ({ name, sessions })).sort((a, b) => b.sessions.length - a.sessions.length || a.name.localeCompare(b.name));
}

export function useRepoStatus(): RepoStatus | 'failed' | null {
  const [repo, setRepo] = useState<RepoStatus | 'failed' | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    const load = () =>
      void (async () => {
        const [tracking, state] = await Promise.all([
          api.prTracking().then((r) => r.on, () => 'unknown' as const),
          getJson<{ project?: { branch: string | null }; sessions?: Session[] }>('/api/state', ctl.signal),
        ]);
        if (ctl.signal.aborted) return;
        if (!state) {
          setRepo((old) => (old && old !== 'failed' ? old : 'failed'));
          return;
        }
        const base = state.project?.branch ?? null;
        const prs = tracking === false ? [] : await prsOfRunningRuns(ctl.signal).catch(() => []);
        if (!ctl.signal.aborted) setRepo({ tracking, base, branches: branchesOf(state.sessions ?? [], base), prs });
      })();
    const stop = pollWhileVisible(load, POLL_MS);
    return () => {
      ctl.abort();
      stop();
    };
  }, []);
  return repo;
}
