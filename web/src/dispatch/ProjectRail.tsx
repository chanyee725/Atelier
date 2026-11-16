// Project list of the 세션 board: 전체, each project and 미분류 with its open-session count. Links, so a click, a
// shared URL and back/forward all work; the picked one carries aria-current. Wide screens: a column on the left;
// narrow: one scrolling row above the board.
import { cn } from '../lib/utils';
import { hashWith, openCounts, type Scope } from './lib/folder.ts';
import { useDispatch } from './store';
import type { ProjectInfo } from '../api';

const item = 'flex h-8 min-w-0 shrink-0 items-center gap-2 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-solid forced-colors:focus-visible:outline-offset-1 forced-colors:focus-visible:outline-[CanvasText] max-md:h-7';

export function ProjectRail({ projects, state, scope, view, onPick }: {
  projects: ProjectInfo[]; state: 'loading' | 'ready' | 'failed'; scope: Scope; view: string; onPick: (s: Scope) => void;
}) {
  const sessions = useDispatch(s => s.sessions);
  const counts = openCounts(sessions, new Set(projects.map(p => p.path)));
  const counted = state === 'ready'; // before the first list every session would count as 미분류
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  // The picked entry is told apart by weight and an edge bar as well as colour, and by Highlight under forced colours.
  // Forced colours drop the focus ring (a box-shadow), so focus gets its own CanvasText outline just outside the item (#524).
  const entries: { key: string; label: string; value: Scope; count: number }[] = [
    { key: 'all', label: '전체', value: undefined, count: total },
    // A linked project the list has not named yet still shows, picked.
    ...(!counted && typeof scope === 'string' && !projects.some(p => p.path === scope) ? [{ key: `p:${scope}`, label: scope.split('/').pop() || scope, value: scope as Scope, count: 0 }] : []),
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
                className={cn(item, on && 'bg-muted font-semibold text-foreground shadow-[inset_2px_0_0_currentColor] forced-colors:shadow-none forced-colors:outline-2 forced-colors:-outline-offset-2 forced-colors:outline-[Highlight]')}
              >
                <span className="truncate">{e.label}</span>
                {counted && e.count > 0 && <span title="열린 세션" className="ml-auto text-xs tabular-nums max-md:ml-0">{e.count}</span>}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
