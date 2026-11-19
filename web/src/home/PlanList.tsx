// 파이프라인 tab (#782): every plan document, grouped by area (a top folder), each row showing its feature folder and state.
import { Badge } from '../components/ui/badge';
import { Block, Note } from './ProjectRuns';
import { matchesQuery, relativeTime, type PlanArea } from './model';

const STATE: Record<string, string> = { plan: '계획', running: '실행 중', paused: '멈춤', done: '완료' };

export function PlanAreas({ areas, query, onOpen, empty }: { areas: PlanArea[]; query: string; onOpen: (path: string) => void; empty: string }) {
  const shown = areas.map((a) => ({ ...a, plans: a.plans.filter((p) => matchesQuery(p.title, query) || matchesQuery(p.feature ?? '', query)) })).filter((a) => a.plans.length > 0);
  if (shown.length === 0) return <Note>{query.trim() ? '맞는 계획이 없어요' : empty}</Note>;
  return (
    <div className="flex flex-col gap-3">
      {shown.map((a) => (
        <Block key={a.area ?? ''} title={a.name} note={`${a.plans.length}개`}>
          <ul className="m-0 list-none divide-y p-0">
            {a.plans.map((p) => (
              <li key={p.path}>
                <button
                  type="button"
                  onClick={() => onOpen(p.path)}
                  className="flex w-full min-w-0 items-center gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {p.feature && <span className="shrink-0 truncate text-muted-foreground">{p.feature} /</span>}
                  <span className="truncate font-medium">{p.title}</span>
                  <Badge variant="secondary" className="shrink-0">{STATE[p.state] ?? p.state}</Badge>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{relativeTime(p.modifiedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Block>
      ))}
    </div>
  );
}
