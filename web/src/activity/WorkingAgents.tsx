// "작업 중인 에이전트" in the app sidebar (E537, #654): every agent session at work in the workspace with its status
// line ("다이어그램 작성 중…") and the file it edits; a click opens that file. Hidden while none is working. From the
// live agent list (home/useAgents.ts, SSE `agents`). Memory only.
import type { CSSProperties } from 'react';
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '../components/ui/sidebar';
import { agentStateLabel, fileStem, safeColor, type AgentPresence } from '../home/agents';
import { useAgents } from '../home/useAgents';

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
          return (
            <SidebarMenuItem key={a.sid}>
              <SidebarMenuButton
                className="h-auto items-start py-1.5"
                data-working-agent={a.sid}
                disabled={!a.file}
                aria-current={a.file && a.file === current ? 'page' : undefined}
                title={doc ? `${doc} 열기` : undefined}
                onClick={() => a.file && onOpen(a.file)}
              >
                <span
                  aria-hidden
                  className="mt-[5px] size-2 shrink-0 rounded-full bg-[var(--agent)]"
                  style={{ '--agent': safeColor(a.color) ?? 'var(--idle)' } as CSSProperties}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="truncate font-medium">{a.name}</span>
                    <span className="truncate text-xs text-muted-foreground" data-working-status="">
                      {status}
                    </span>
                  </span>
                  {doc && <span className="truncate text-xs text-muted-foreground">{doc}</span>}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
