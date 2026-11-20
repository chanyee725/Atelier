// 진행 중 card's 문서 tab (#975): the documents a session writes now (agent presence `file`) merged with the plan
// documents whose pipeline runs now. Built from feeds the dashboard already has (the agents stream, the workspace
// tree's plan state, the run records); no request of its own. Pure functions, so tests run without a browser.
import type { AgentPresence } from './agents.ts';

export type ActiveDocSource = 'writing' | 'plan';
export type ActiveDoc = {
  path: string;
  title: string;
  /** Area path shown under the title (e.g. "Web / 채팅"): the folders above the file, without the project folder. */
  area: string;
  source: ActiveDocSource;
  /** Sessions writing the file now (presence), in the order given. */
  agents: AgentPresence[];
  /** What the first writer does now (a plan step, a status label or its activity). */
  doing: string | null;
  /** Finished steps of a running plan; null for a plain document or while the record is unknown. */
  progress: { done: number; total: number } | null;
  modifiedAt: number;
};

export type DocFacts = { path: string; title: string; modifiedAt: number; plan?: string };
export type RunProgress = { done: number; total: number };

const stem = (p: string) => (p.split('/').pop() ?? p).replace(/\.dpx\.json$/, '');

/** "Web / 채팅" from "<project>/Web/채팅/<file>"; '' for a file right under the project folder. */
export function areaOf(path: string, project: string): string {
  const rel = project && path.startsWith(`${project}/`) ? path.slice(project.length + 1) : path;
  return rel.split('/').slice(0, -1).join(' / ');
}

/**
 * Open documents first by who works on them: writing sessions or a running plan. A file that is both a running plan
 * and held by a session is one row (source 'plan', with its writers). Newest edit first; a file the tree does not know
 * yet falls back to its file name and time 0.
 */
export function activeDocs(
  agents: readonly AgentPresence[],
  docs: readonly DocFacts[],
  progress: ReadonlyMap<string, RunProgress> = new Map(),
  project = '',
): ActiveDoc[] {
  const byPath = new Map(docs.map((d) => [d.path, d]));
  const writers = new Map<string, AgentPresence[]>();
  for (const a of agents) if (a.file) writers.set(a.file, [...(writers.get(a.file) ?? []), a]);
  const paths = new Set<string>([...writers.keys(), ...docs.filter((d) => d.plan === 'running').map((d) => d.path)]);
  const out: ActiveDoc[] = [];
  for (const path of paths) {
    const d = byPath.get(path);
    const who = writers.get(path) ?? [];
    const first = who[0];
    out.push({
      path,
      title: d?.title || stem(path),
      area: areaOf(path, project),
      source: d?.plan === 'running' ? 'plan' : 'writing',
      agents: who,
      doing: first ? first.step || first.statusLabel || first.activity || null : null,
      progress: d?.plan === 'running' ? progress.get(path) ?? null : null,
      modifiedAt: d?.modifiedAt ?? 0,
    });
  }
  return out.sort((a, b) => b.modifiedAt - a.modifiedAt || a.path.localeCompare(b.path));
}

/** Steps done out of all steps of a run record (`steps` map); null for an empty one. */
export function stepProgress(steps: Record<string, { state: string }> | undefined): RunProgress | null {
  const all = Object.values(steps ?? {});
  return all.length ? { done: all.filter((s) => s.state === 'done').length, total: all.length } : null;
}

/** The persisted tab of the card; anything unknown is 이슈. Reads and writes never throw (private mode, no storage). */
export type ActiveTab = 'issues' | 'docs';
export const ACTIVE_TAB_KEY = 'atelier.active-card-tab';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
export function readActiveTab(store?: Store | null): ActiveTab {
  try {
    return (store ?? localStorage).getItem(ACTIVE_TAB_KEY) === 'docs' ? 'docs' : 'issues';
  } catch {
    return 'issues';
  }
}
export function saveActiveTab(tab: ActiveTab, store?: Store | null): void {
  try {
    (store ?? localStorage).setItem(ACTIVE_TAB_KEY, tab);
  } catch {
    /* storage unavailable: the choice just is not remembered */
  }
}
