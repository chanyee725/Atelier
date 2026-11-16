// "작업 중인 에이전트" in the app sidebar (E537, #654): every agent session at work in the workspace with its status
// line ("다이어그램 작성 중…") and the file it edits; a click opens that file. Hidden while none is working. From the
// live agent list (home/useAgents.ts, SSE `agents`). Memory only.
import type { CSSProperties } from 'react';
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '../components/ui/sidebar';
import { agentStateLabel, fileStem, safeColor, type AgentPresence } from '../home/agents';
import { useAgents } from '../home/useAgents';
import { cn } from '../lib/utils';

// Rows grow to two lines (status, then the file); the dot sits on the first line's centre.
const ROW = 'h-auto min-h-[30px] items-start py-1';

/** The rows: sessions first, newest activity first (the server's order), outside writers after them. */
export const workingRows = (agents: readonly AgentPresence[]) => [...agents.filter((a) => !a.outside), ...agents.filter((a) => a.outside)];

export function WorkingAgents({ current, onOpen, titleOf }: { current: string | null; onOpen: (path: string) => void; titleOf?: (path: string) => string | null }) {
  const { agents } = useAgents();
  if (!Array.isArray(agents) || agents.length === 0) return null;
  return (
    <SidebarGroup className="mt-3" data-working-agents="">
      <SidebarGroupLabel>작업 중인 에이전트</SidebarGroupLabel>
      <SidebarMenu>
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
              {a.file ? (
                <SidebarMenuButton
                  // Editing the open file: a hover-strength tint, so the document's own row stays the one selected row.
                  className={cn(ROW, 'aria-[current=page]:bg-sidebar-foreground/5')}
                  data-working-agent={a.sid}
                  aria-current={a.file === current ? 'page' : undefined}
                  title={doc ? `${doc} 열기` : undefined}
                  onClick={() => a.file && onOpen(a.file)}
                >
                  {body}
                </SidebarMenuButton>
              ) : (
                // Nothing to open: a status line, not a dimmed (disabled) button.
                <div className={cn('flex w-full min-w-0 gap-2 rounded-md px-2 text-sm', ROW)} data-working-agent={a.sid}>
                  {body}
                </div>
              )}
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
