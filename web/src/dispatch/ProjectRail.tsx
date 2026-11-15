// Project list of the 세션 board: 전체, each project and 미분류 with its open-session count. Links, so a click, a
// shared URL and back/forward all work; the picked one carries aria-current. Wide screens: a column on the left;
// narrow: one scrolling row above the board.
import { cn } from '../lib/utils';
import { hashWith, openCounts, type Scope } from './lib/folder.ts';
import { useDispatch } from './store';
import type { ProjectInfo } from '../api';

const item = 'flex h-8 min-w-0 shrink-0 items-center gap-2 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-md:h-7';

export function ProjectRail({ projects, scope, view, onPick }: {
  projects: ProjectInfo[]; scope: Scope; view: string; onPick: (s: Scope) => void;
}) {
  const sessions = useDispatch(s => s.sessions);
  const counts = openCounts(sessions, new Set(projects.map(p => p.path)));
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const entries: { key: string; label: string; value: Scope; count: number }[] = [
    { key: 'all', label: '전체', value: undefined, count: total },
    ...projects.map(p => ({ key: `p:${p.path}`, label: p.name, value: p.path as Scope, count: counts.get(p.path) ?? 0 })),
    { key: 'none', label: '미분류', value: null, count: counts.get(null) ?? 0 },
  ];
  return (
    <nav aria-label="프로젝트" className="shrink-0 border-r max-md:border-r-0 max-md:border-b md:w-56 md:overflow-y-auto">
      <ul className="m-0 flex list-none flex-col gap-0.5 p-2 max-md:flex-row max-md:overflow-x-auto max-md:[scrollbar-width:none]">
        {entries.map(e => {
          const on = e.value === scope;
          return (
            <li key={e.key} className="min-w-0 max-md:shrink-0">
              <a
                href={hashWith(view, e.value) || location.pathname}
                aria-current={on ? 'page' : undefined}
                onClick={ev => { ev.preventDefault(); onPick(e.value); }}
                className={cn(item, on && 'bg-muted text-foreground')}
              >
                <span className="truncate">{e.label}</span>
                {e.count > 0 && <span title="열린 세션" className="ml-auto text-xs tabular-nums max-md:ml-0">{e.count}</span>}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
