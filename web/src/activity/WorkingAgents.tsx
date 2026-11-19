// "작업 중인 에이전트" in the app sidebar (E537, #654): every agent session at work in the workspace with its status
// line ("다이어그램 작성 중…") and the file it edits. A row click opens the agent's live view (#728); the file opens
// from the row's trailing button. Hidden while none is working. From the live agent list (home/useAgents.ts, SSE
// `agents`). Memory only. The group folds like a project folder (E556, #725): a disclosure button with a chevron,
// the count while folded, and the open/closed choice remembered (agentsGroupOpen.ts).
import { useId, useState, type CSSProperties } from 'react';
import { ChevronRight, FileText } from 'lucide-react';
import { SidebarGroup, SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from '../components/ui/sidebar';
import { openAgentLive, useAgentLiveTarget } from '../live/store';
import { agentStateLabel, fileStem, safeColor, type AgentPresence } from '../home/agents';
import { useAgents } from '../home/useAgents';
import { FOCUS_RING } from '../lib/focus';
import { cn } from '../lib/utils';
import { readAgentsOpen, writeAgentsOpen } from './agentsGroupOpen';

// Rows grow to two lines (status, then the file); the dot sits on the first line's centre.
const ROW = 'h-auto min-h-[30px] items-start py-1';

/** The rows: sessions first, newest activity first (the server's order), outside writers after them. */
export const workingRows = (agents: readonly AgentPresence[]) => [...agents.filter((a) => !a.outside), ...agents.filter((a) => a.outside)];

export function WorkingAgents({ current, onOpen, titleOf }: { current: string | null; onOpen: (path: string) => void; titleOf?: (path: string) => string | null }) {
  const { agents } = useAgents();
  const openSid = useAgentLiveTarget();
  const [open, setOpen] = useState(readAgentsOpen);
  const listId = useId();
  if (!Array.isArray(agents) || agents.length === 0) return null;
  const toggle = () => {
    writeAgentsOpen(!open);
    setOpen(!open);
  };
  return (
    <SidebarGroup className="mt-3" data-working-agents="">
      {/* A native button: Enter and Space toggle it. The chevron sits right after the label, the count after it. */}
      <button
        type="button"
        className={cn('flex h-[30px] w-full items-center gap-1 rounded-md px-2 text-left text-xs font-medium text-muted-foreground outline-none hover:bg-sidebar-foreground/5 hover:text-sidebar-foreground max-md:h-11', FOCUS_RING)}
        aria-expanded={open}
        aria-controls={listId}
        title={open ? '작업 중인 에이전트 접기' : '작업 중인 에이전트 펼치기'}
        data-working-agents-toggle=""
        onClick={toggle}
      >
        <span className="truncate">작업 중인 에이전트</span>
        <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 motion-safe:transition-transform', open && 'rotate-90')} />
        {!open && (
          <span className="ml-auto shrink-0 tabular-nums">
            <span aria-hidden data-working-agents-count="">
              {agents.length}
            </span>
            <span className="sr-only">, {agents.length}개</span>
          </span>
        )}
      </button>
      <SidebarMenu id={listId} hidden={!open}>
        {workingRows(agents).map((a) => {
          const doc = a.file ? titleOf?.(a.file) || fileStem(a.file) : null;
          const status = a.statusLabel || agentStateLabel(a);
          const body = (
            <>
              <span aria-hidden className="mt-[7px] size-2 shrink-0 rounded-full bg-[var(--agent)]" style={{ '--agent': safeColor(a.color) ?? 'var(--idle)' } as CSSProperties} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="truncate font-medium text-sidebar-foreground">{a.name}</span>
                  <span className="truncate text-xs text-muted-foreground" data-working-status="">
                    {status}
                  </span>
                </span>
                {doc && <span className="truncate text-xs text-muted-foreground">{doc}</span>}
              </span>
            </>
          );
          return (
            <SidebarMenuItem key={a.sid}>
              <SidebarMenuButton
                // Editing the open file: a hover-strength tint, so the document's own row stays the one selected row.
                className={cn(ROW, a.file && 'pr-8', 'aria-[current=page]:bg-sidebar-foreground/5')}
                data-working-agent={a.sid}
                aria-current={a.file && a.file === current ? 'page' : undefined}
                aria-expanded={openSid === a.sid}
                title={`${a.name} 진행상황 보기`}
                onClick={(e) => openAgentLive(a.sid, { trigger: e.currentTarget, from: 'sidebar' })}
              >
                {body}
              </SidebarMenuButton>
              {a.file && doc && (
                <SidebarMenuAction showOnHover aria-label={`${doc} 열기`} title={`${doc} 열기`} data-working-agent-file={a.file} onClick={() => a.file && onOpen(a.file)}>
                  <FileText />
                </SidebarMenuAction>
              )}
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
