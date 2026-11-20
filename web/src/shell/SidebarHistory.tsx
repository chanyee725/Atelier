// 기록 (#968): the saved chats under 문서 in the sidebar, newest first. A row is the first question's summary and
// its time; it only shows what the server keeps (title, time), never message text.
import { useEffect } from 'react';
import { MessageSquare } from 'lucide-react';
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '../components/ui/sidebar';
import { ago, reloadHistory, rowTitle, useChatHistory, type ChatSummary } from './chatHistory';

function HistoryRow({ chat }: { chat: ChatSummary }) {
  const title = rowTitle(chat);
  return (
    <SidebarMenuItem data-chat-row={chat.id}>
      <SidebarMenuButton className="pr-8 font-normal text-muted-foreground hover:text-foreground max-md:pr-12" title={title}>
        <MessageSquare className="size-[15px]! text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <time className="shrink-0 text-[11px] tabular-nums text-muted-foreground" dateTime={new Date(chat.updatedAt).toISOString()}>
          {ago(chat.updatedAt)}
        </time>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function SidebarHistory() {
  const { chats, loaded, error } = useChatHistory();
  useEffect(() => void reloadHistory(), []);
  return (
    <SidebarGroup className="mt-3" data-chat-history="">
      <SidebarGroupLabel>기록</SidebarGroupLabel>
      {!loaded ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">불러오는 중이에요…</p>
      ) : error ? (
        <p className="px-2 py-1 text-xs text-destructive" role="status">기록을 불러오지 못했어요.</p>
      ) : chats.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">아직 지난 대화가 없어요. 채팅으로 대화하면 여기에 남아요.</p>
      ) : (
        <SidebarMenu>
          {chats.map((c) => (
            <HistoryRow key={c.id} chat={c} />
          ))}
        </SidebarMenu>
      )}
    </SidebarGroup>
  );
}
