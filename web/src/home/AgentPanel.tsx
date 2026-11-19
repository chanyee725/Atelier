// 지금 작업 중: the agent sessions in a project right now, each with the file it holds (#592). Each name is drawn as the
// same pointer + colour tag the session shows on the canvas and in the document, so the panel, the document rows and
// the live cursor read as one person. Updates come from the `agents` event stream (useAgents), no reload.
import type { CSSProperties } from 'react';
import { useId } from 'react';
import { File, RotateCw } from 'lucide-react';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';
import { FOCUS_RING } from '../lib/focus';
import { openAgentLive } from '../live/store';
import { agentMeta, agentStateLabel, fileStem, isBusy, needsLook, roleBadge, safeColor, type AgentPresence, type RoleTone } from './agents';
import { relativeTime } from './model';

const FALLBACK = '#475569';

/** The cursor tag in small: pointer and name on the session's colour. Decorative copies pass `hidden`. */
export function AgentTag({ agent, size = 'md', className }: { agent: Pick<AgentPresence, 'name' | 'color' | 'sid'>; size?: 'sm' | 'md'; className?: string }) {
  const color = safeColor(agent.color) ?? FALLBACK;
  return (
    <span data-agent-tag={agent.sid} className={cn('inline-flex min-w-0 shrink items-start', className)} style={{ '--agent': color } as CSSProperties}>
      <svg aria-hidden width={size === 'sm' ? 8 : 10} height={size === 'sm' ? 9 : 11} viewBox="0 0 16 18" className="mt-px shrink-0 fill-[var(--agent)]">
        <path d="M1 1 L1 15 L5 11.5 L8 17 L10.5 15.8 L7.6 10.4 L13 10 Z" />
      </svg>
      <span
        className={cn(
          'truncate rounded-[5px] bg-[var(--agent)] font-medium text-white',
          size === 'sm' ? 'mt-[5px] -ml-px px-1.5 text-[11px] leading-4' : 'mt-[7px] -ml-0.5 px-[7px] text-[13px] leading-5',
        )}
      >
        {agent.name}
      </span>
    </span>
  );
}

const ROLE_COLOR: Record<RoleTone, string> = {
  lead: 'var(--role-lead)',
  merge: 'var(--role-merge)',
  impl: 'var(--role-impl)',
  review: 'var(--role-review)',
  test: 'var(--role-test)',
  design: 'var(--role-design)',
  docs: 'var(--role-docs)',
  other: 'var(--muted-foreground)',
};

/** The session's role as a small tinted badge: the role colour plus its name, so colour is never the only cue. */
export function RoleBadge({ agent, className }: { agent: Pick<AgentPresence, 'role' | 'roleName' | 'outside'>; className?: string }) {
  const { tone, label } = roleBadge(agent);
  return (
    <span
      data-role-tone={tone}
      style={{ '--role': ROLE_COLOR[tone] } as CSSProperties}
      className={cn(
        'inline-flex max-w-full min-w-0 items-center rounded-[4px] border border-[color-mix(in_oklch,var(--role)_38%,transparent)] bg-[color-mix(in_oklch,var(--role)_14%,transparent)] px-1.5 text-[11px] leading-[18px] font-medium text-[var(--role)]',
        className,
      )}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}

type Props = {
  agents: AgentPresence[] | 'off' | 'failed' | null;
  /** Asks the server again after a failed request. */
  onRetry?: () => void;
  /** Title of a file in this project, when the list knows it. */
  titleOf: (path: string) => string | undefined;
  onOpen: (path: string) => void;
  className?: string;
};

export function AgentPanel({ agents, onRetry, titleOf, onOpen, className }: Props) {
  const headId = useId();
  const list = Array.isArray(agents) ? agents : [];
  const busy = list.filter(isBusy).length;
  return (
    <section aria-labelledby={headId} data-slot="agent-panel" className={cn('min-w-0', className)}>
      <header className="flex h-8 items-center gap-2 border-b px-4 text-[13px]">
        <h2 id={headId} className="m-0 text-[13px] font-medium text-foreground">지금 작업 중</h2>
        {list.length > 0 && (
          <span className="text-muted-foreground tabular-nums">
            <span className="sr-only">에이전트 </span>
            {list.length}
            <span className="sr-only">명</span>
          </span>
        )}
        {busy > 0 && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-muted-foreground tabular-nums">
            <span aria-hidden className="size-1.5 rounded-full bg-ok" />
            {busy}명 작업 중
          </span>
        )}
      </header>
      {agents === null ? (
        <p className="m-0 px-4 py-5 text-[13px] text-muted-foreground">불러오는 중이에요</p>
      ) : agents === 'failed' ? (
        // Polite, not an alert: the rest of the page works, and the list may still arrive on the event stream.
        <div role="status" data-agents-failed className="grid justify-items-start gap-2 px-4 py-5 text-[13px] leading-5 break-keep text-muted-foreground">
          <p className="m-0">에이전트 목록을 불러오지 못했어요. 잠시 뒤에 다시 시도해 주세요.</p>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RotateCw aria-hidden /> 다시 시도
            </Button>
          )}
        </div>
      ) : agents === 'off' ? (
        <p className="m-0 px-4 py-5 text-[13px] text-muted-foreground">이 서버는 에이전트 목록을 아직 보내지 않아요.</p>
      ) : list.length === 0 ? (
        <p className="m-0 px-4 py-5 text-[13px] leading-5 break-keep text-muted-foreground">
          지금 이 프로젝트에서 일하는 에이전트가 없어요. 세션이 파일을 고치기 시작하면 여기에 바로 보여요.
        </p>
      ) : (
        <ul role="list" aria-label="이 프로젝트의 에이전트" className="m-0 list-none divide-y p-0">
          {list.map((a) => (
            <AgentRow key={a.sid} agent={a} title={a.file ? titleOf(a.file) ?? fileStem(a.file) : null} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AgentRow({ agent: a, title, onOpen }: { agent: AgentPresence; title: string | null; onOpen: (path: string) => void }) {
  const busy = isBusy(a);
  const meta = agentMeta(a);
  return (
    <li data-agent={a.sid} data-state={a.state ?? a.status} className="grid gap-1 px-4 pt-1.5 pb-2.5">
      <div className="flex min-w-0 items-start gap-2">
        {/* The name opens the agent's live view (#728); the file below stays a link to the document. */}
        <button
          type="button"
          data-agent-live={a.sid}
          title={`${a.name} 진행상황 보기`}
          onClick={(e) => openAgentLive(a.sid, { trigger: e.currentTarget, from: 'doc' })}
          className={cn('-m-0.5 flex min-w-0 rounded-md p-0.5 hover:bg-accent/60', FOCUS_RING)}
        >
          <AgentTag agent={a} />
        </button>
        <span className={cn('mt-[7px] ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs leading-5', busy ? 'text-foreground' : 'text-muted-foreground')}>
          <span aria-hidden className={cn('size-1.5 rounded-full', busy ? 'bg-ok' : needsLook(a) ? 'bg-warn' : 'bg-muted-foreground/50')} />
          {agentStateLabel(a)}
        </span>
      </div>
      {meta && <p className="m-0 truncate pl-3 text-xs text-muted-foreground">{meta}</p>}
      {a.file && title ? (
        <button
          type="button"
          onClick={() => onOpen(a.file!)}
          className="-mx-1.5 flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 pl-[18px] text-left text-[13px] hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <File aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="sr-only">잡고 있는 파일 </span>
          <span className="truncate">{title}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{a.at ? relativeTime(a.at) : null}</span>
        </button>
      ) : (
        <p className="m-0 pl-3 text-xs text-muted-foreground">잡고 있는 파일 없음</p>
      )}
    </li>
  );
}
