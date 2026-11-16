// Agent sessions working in a project right now, for the project home's 지금 작업 중 panel (#592).
// Data: GET /api/workspace/agents (first answer) and the SSE event `agents` (a full snapshot of the whole workspace,
// sent on connect and on every change). Memory-only on the server; nothing here is stored either.
// The type mirrors shared/dispatch/agent-presence.ts (part b of #592, PR #603); import it from there once that lands.
import { STATE } from '../dispatch/lib/format.ts';
import type { SessionState } from '../../../shared/dispatch/types.ts';

export type AgentPresence = {
  sid: string;
  /** The session's own name as created ("Otto"), or the label an outside API writer gave in x-drawing-session. */
  name: string;
  /** Role id; '' for an outside writer. */
  role: string;
  roleName?: string;
  /** The session's cursor colour (`#rrggbb`); absent for outside writers. */
  color?: string;
  model: string | null;
  modelLabel?: string;
  /** Hub status: starting | running | waiting. */
  status: string;
  /** Monitoring state (SessionState), null when not known yet. */
  state: string | null;
  /** Top folder the session works in. */
  project: string | null;
  /** Workspace-relative file it edited last (held now); null before its first edit. */
  file: string | null;
  /** Last activity (ms), null when unknown. */
  at: number | null;
  /** An API writer from outside (no role, model or colour). */
  outside?: true;
};

const STATUS_LABEL: Record<string, string> = { starting: '시작 중', running: '작업 중', waiting: '기다리는 중' };
/** The monitoring state when known (작업 중, 사람 기다림, 멈춤, …), else the hub status. */
export const agentStateLabel = (a: Pick<AgentPresence, 'status' | 'state'>) =>
  (a.state && STATE[a.state as SessionState]?.label) || STATUS_LABEL[a.status] || a.status;
/** Doing something now (green dot): working by the monitor, or running/starting by the hub when the monitor has no word. */
export const isBusy = (a: Pick<AgentPresence, 'status' | 'state'>) => (a.state ? a.state === 'working' : a.status === 'running' || a.status === 'starting');
/** Needs a person or is stuck (amber dot). */
export const needsLook = (a: Pick<AgentPresence, 'status' | 'state'>) => (a.state ? a.state === 'waiting' || a.state === 'stuck' || a.state === 'failed' : a.status === 'waiting');

/** The project's agents: busy first, then whoever holds a file, then the most recent; a stable name order last. */
export function agentsIn(all: readonly AgentPresence[], project: string): AgentPresence[] {
  return all
    .filter((a) => a.project === project || (!!a.file && a.file.startsWith(`${project}/`)))
    .sort((a, b) => Number(isBusy(b)) - Number(isBusy(a)) || Number(!!b.file) - Number(!!a.file) || (b.at ?? 0) - (a.at ?? 0) || a.name.localeCompare(b.name));
}

/** Who holds each file, for the marks on document rows. */
export function holdersByFile(agents: readonly AgentPresence[]): ReadonlyMap<string, AgentPresence[]> {
  const m = new Map<string, AgentPresence[]>();
  for (const a of agents) if (a.file) m.set(a.file, [...(m.get(a.file) ?? []), a]);
  return m;
}

/** "구현자 · Opus 5.5"; an outside writer says so instead. */
export function agentMeta(a: AgentPresence): string {
  if (a.outside) return '외부 API';
  return [a.roleName || a.role, a.modelLabel || a.model].filter(Boolean).join(' · ');
}

/** A safe `#rrggbb` colour or null (the server sends one; anything else is ignored). */
export const safeColor = (c: string | undefined) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : null);

/** Fallback title of a file path: its last part without .dpx.json. */
export const fileStem = (path: string) => (path.split('/').pop() ?? path).replace(/\.dpx\.json$/, '');

/** Parses an `agents` event or GET answer; anything malformed counts as no agents. */
export function parseAgents(x: unknown): AgentPresence[] {
  const list = (x as { agents?: unknown } | null)?.agents;
  if (!Array.isArray(list)) return [];
  return list.filter((a): a is AgentPresence => !!a && typeof a === 'object' && typeof (a as AgentPresence).sid === 'string' && typeof (a as AgentPresence).name === 'string');
}
