// Agent sessions working in a project right now, for the project home's 지금 작업 중 panel (#592).
// Data: GET /api/workspace/agents (first answer) and the SSE event `agents` (a full snapshot of the whole workspace,
// sent on connect and on every change). Memory-only on the server; nothing here is stored either.
// The type mirrors shared/dispatch/agent-presence.ts (part b of #592); kept here until that file lands.

export type AgentPresence = {
  sid: string;
  /** The session's own name as created ("Otto"), or the name an outside API writer gave in x-drawing-session. */
  name: string;
  role: string;
  roleName?: string;
  /** The session's cursor colour (`#rrggbb`). */
  color?: string;
  model: string | null;
  modelLabel?: string | null;
  /** running | starting | waiting | idle | … (unknown values are shown as they come). */
  state: string;
  /** Top folder the session works for. */
  project: string | null;
  /** Workspace-relative file it holds now; null when its turn ended. */
  file: string | null;
  at: number;
  /** An API writer from outside (no model or role). */
  outside?: true;
};

const STATE_LABEL: Record<string, string> = { running: '작업 중', starting: '시작 중', waiting: '기다리는 중', idle: '쉬는 중', stuck: '멈춤', failed: '실패', done: '끝남' };
export const agentStateLabel = (s: string) => STATE_LABEL[s] ?? s;
/** States that mean the session is doing something now (green dot); the rest are quiet. */
export const isBusy = (s: string) => s === 'running' || s === 'starting';

const ORDER: Record<string, number> = { running: 0, starting: 1, waiting: 2 };
/** The project's agents: busy first, then whoever holds a file, then the most recent; a stable name order last. */
export function agentsIn(all: readonly AgentPresence[], project: string): AgentPresence[] {
  return all
    .filter((a) => a.project === project || (!!a.file && a.file.startsWith(`${project}/`)))
    .sort((a, b) => (ORDER[a.state] ?? 3) - (ORDER[b.state] ?? 3) || Number(!!b.file) - Number(!!a.file) || b.at - a.at || a.name.localeCompare(b.name));
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
