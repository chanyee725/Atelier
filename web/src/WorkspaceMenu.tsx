// Sidebar header (E554): the open workspace folder's name opens a menu of the folders this server can switch
// between (~/.dispatch/drawing.json `workspaces`) plus 폴더 열기 for the folder browser. Picking one switches the
// server; App reloads the page. The list is fetched each time the menu opens.
import { useState } from 'react';
import { ChevronsUpDown, FolderOpen } from 'lucide-react';
import { api, type WorkspaceFolders } from './api';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu';
import { FOCUS_RING } from './lib/focus';
import { cn } from './lib/utils';

type Props = {
  workspace: string | null;
  /** Switch the server to this folder (absolute path). */
  onSwitch: (path: string) => void;
  /** Open the folder browser. */
  onOpenFolder: () => void;
};

export function WorkspaceMenu({ workspace, onSwitch, onOpenFolder }: Props) {
  const [list, setList] = useState<WorkspaceFolders | null>(null);
  const [failed, setFailed] = useState(false);
  const load = (open: boolean) => {
    if (!open) return;
    setFailed(false);
    api.workspaces().then(setList, () => setFailed(true));
  };
  const name = workspace ?? 'Drawing';
  const current = list?.folders.find((f) => f.current)?.path ?? '';
  return (
    <DropdownMenu onOpenChange={load}>
      <DropdownMenuTrigger
        className={cn('flex h-[35px] min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left hover:bg-sidebar-accent aria-expanded:bg-sidebar-accent', FOCUS_RING)}
        aria-label={`폴더 바꾸기, 지금 폴더: ${name}`}
      >
        <span aria-hidden className="grid size-[22px] shrink-0 place-items-center rounded-sm bg-primary text-xs font-semibold text-primary-foreground">
          {[...(workspace ?? 'D')][0]?.toUpperCase()}
        </span>
        <span className="truncate text-sm font-semibold">{name}</span>
        <ChevronsUpDown aria-hidden className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 max-w-[calc(100vw-1rem)]">
        <DropdownMenuLabel className="text-xs text-muted-foreground">폴더</DropdownMenuLabel>
        {!list && !failed && <DropdownMenuItem disabled>불러오는 중이에요…</DropdownMenuItem>}
        {failed && <DropdownMenuItem disabled>목록을 불러오지 못했어요</DropdownMenuItem>}
        {list && (
          <DropdownMenuRadioGroup aria-label="열 수 있는 폴더" value={current} onValueChange={(p) => p !== current && onSwitch(p)}>
            {list.folders.map((f) => (
              <DropdownMenuRadioItem key={f.path} value={f.path} disabled={f.missing || (!f.current && !list.switchable)} title={f.path}>
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                {f.missing && <span className="text-xs text-muted-foreground">없음</span>}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenFolder} disabled={list ? !list.switchable : false}>
          <FolderOpen aria-hidden />
          폴더 열기…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
