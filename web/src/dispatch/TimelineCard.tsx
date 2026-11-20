// 타임라인 card of the 세션 board (E29, #879; by team, #928): one folding row per team (a lead and the sessions under
// it) for the picked project, the last two hours across. Only busy teams start open; a folded lead row draws the whole
// team's activity merged. States read from the mark's shape, not a legend: work is a solid bar in the one accent colour,
// resting a dotted line, done a thin line, waiting for a person an outlined stretch (warn), stuck a dashed outline, a
// failure a short red tick. The exact state is in the hover title and the row's accessible name. History is state and
// time only (GET /api/timeline). Forced-colors mode drops author backgrounds, so filled marks get a system-colour border.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChevronRight } from 'lucide-react';
import { Card, EmptyState } from '../home/dash';
import { cn } from '../lib/utils';
import { windowSpans, WINDOW_MS, type Entry } from '../../../shared/dispatch/timeline.js';
import { STATE, stateOf } from './lib/format.ts';
import { rowHistory } from './lib/usage.ts';
import { api, useDispatch } from './store';
import { useScope } from './scope';
import type { Scope } from './lib/folder.ts';
import { mergeSpans, teamBusy, timelineTeams, type Span, type Team } from './lib/timeline.ts';
import type { Session, SessionState } from './types';

type Timeline = { now: number; windowMs: number; sessions: Record<string, Entry[]> };
type Spans = { spans: Span[]; fails: number[] };

const known = (st: string): SessionState => (st in STATE ? (st as SessionState) : 'resting');

/** The mark per state. Only `working` uses the accent; warn and bad are kept for waiting and failure. */
const MARK: Record<SessionState, { className: string; style?: CSSProperties }> = {
  working: { className: 'h-2 rounded-[2px] forced-colors:border forced-colors:border-[CanvasText]', style: { background: 'var(--ok)' } },
  waiting: { className: 'h-2 rounded-[2px] border-[1.5px] border-warn' },
  stuck: { className: 'h-2 rounded-[2px] border-[1.5px] border-dashed border-muted-foreground' },
  failed: { className: 'h-0 border-t border-destructive/70' },
  resting: { className: 'h-0 border-t-2 border-dotted border-muted-foreground' },
  done: { className: 'h-0 border-t border-muted-foreground/60' },
};
/** The dot next to a row's current state: colour only where it asks for attention. */
const DOT: Record<SessionState, string> = {
  working: 'bg-ok', waiting: 'bg-warn', failed: 'bg-destructive', stuck: 'bg-muted-foreground', resting: 'bg-muted-foreground/60', done: 'bg-muted-foreground/60',
};
const FORCED_FAIL = 'forced-colors:bg-[Highlight]';

const hhmm = (t: number) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
const mins = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
};
const describe = ({ spans, fails }: Spans) =>
  spans.map(p => `${STATE[known(p.state)].label} ${hhmm(p.from)}–${hhmm(p.to)}`).join(', ') + (fails.length ? `. 실패 ${fails.length}번` : '');

const ROW = 'grid w-full grid-cols-[220px_1fr] items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none @max-[560px]:grid-cols-1 @max-[560px]:gap-1.5';

function StateText({ state }: { state: SessionState }) {
  return (
    <span data-state={state} className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
      <span aria-hidden className={cn('size-1.5 rounded-full forced-colors:bg-[CanvasText]', DOT[state])} />
      {STATE[state].label}
    </span>
  );
}

function Track({ data, now, windowMs }: { data: Spans; now: number; windowMs: number }) {
  const start = now - windowMs;
  const x = (t: number) => `${((t - start) / windowMs) * 100}%`;
  return (
    <span aria-hidden className="relative block h-3">
      {data.spans.map(p => {
        const st = known(p.state);
        return (
          <span key={p.from} data-span={st} title={`${STATE[st].label} · ${hhmm(p.from)}–${hhmm(p.to)} (${mins(p.to - p.from)})`}
            className="absolute inset-y-0 flex min-w-0.5 items-center" style={{ left: x(p.from), width: `${((p.to - p.from) / windowMs) * 100}%` }}>
            <span className={cn('w-full', MARK[st].className)} style={MARK[st].style} />
          </span>
        );
      })}
      {data.fails.map(t => (
        <span key={t} title={`실패 · ${hhmm(t)}`} data-fail className={cn('absolute inset-y-0 w-[2px] -translate-x-1/2 rounded-full bg-destructive', FORCED_FAIL)} style={{ left: x(t) }} />
      ))}
    </span>
  );
}

function MemberRow({ s, role, data, now, windowMs, onOpen }: { s: Session; role: string; data: Spans; now: number; windowMs: number; onOpen: () => void }) {
  const state = stateOf(s);
  return (
    <button type="button" onClick={onOpen} data-row={s.name} aria-label={`${s.name}, ${role}, 지금 ${STATE[state].label}. ${describe(data)}`} className={ROW}>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-sm">{s.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{role}</span>
        <StateText state={state} />
      </span>
      <Track data={data} now={now} windowMs={windowMs} />
    </button>
  );
}

function TeamRows({ team, open, onToggle, spansOf, roleOf, now, windowMs, onOpen }: {
  team: Team<Session>; open: boolean; onToggle: () => void; spansOf: (id: string) => Spans; roleOf: (s: Session) => string;
  now: number; windowMs: number; onOpen: (id: string) => void;
}) {
  const { lead, members } = team;
  const all = [lead, ...members];
  const merged = mergeSpans(all.map(s => spansOf(s.id)));
  if (!members.length) return <MemberRow s={lead} role={roleOf(lead)} data={spansOf(lead.id)} now={now} windowMs={windowMs} onOpen={() => onOpen(lead.id)} />;
  // The folded row speaks for the whole team: its state is the strongest any member is in now.
  const states = all.map(stateOf);
  const teamState = (['working', 'waiting', 'stuck', 'failed', 'resting', 'done'] as const).find(st => states.includes(st)) ?? 'resting';
  const panel = `team-${lead.id}`;
  return (
    <div data-team={lead.id}>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={panel} data-row={lead.name}
        aria-label={`${lead.name} 팀, 팀원 ${members.length}명, 지금 ${STATE[teamState].label}. ${describe(merged)}`} className={ROW}>
        <span className="flex min-w-0 items-center gap-1.5">
          <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-(--ease-out) motion-reduce:transition-none', open && 'rotate-90')} />
          <span className="truncate text-sm font-medium">{lead.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">팀원 {members.length}</span>
          <StateText state={teamState} />
        </span>
        <Track data={merged} now={now} windowMs={windowMs} />
      </button>
      <div id={panel} inert={!open} className={cn('grid transition-[grid-template-rows] duration-200 ease-(--ease-out) motion-reduce:transition-none', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="overflow-hidden">
          <div className="ml-[15px] border-l pl-1">
            {all.map(s => (
              <MemberRow key={s.id} s={s} role={roleOf(s)} data={spansOf(s.id)} now={now} windowMs={windowMs} onOpen={() => onOpen(s.id)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Axis({ now, windowMs }: { now: number; windowMs: number }) {
  const start = now - windowMs;
  const step = 30 * 60_000;
  const ticks: number[] = [];
  for (let t = Math.ceil(start / step) * step; t < now - step / 2; t += step) ticks.push(t);
  return (
    <div aria-hidden className="grid grid-cols-[220px_1fr] gap-3 px-2 @max-[560px]:grid-cols-1">
      <span className="@max-[560px]:hidden" />
      <div className="relative h-4 text-[11px] text-muted-foreground tabular-nums">
        {ticks.map(t => <span key={t} className="absolute -translate-x-1/2" style={{ left: `${((t - start) / windowMs) * 100}%` }}>{hhmm(t)}</span>)}
        <span className="absolute right-0">지금</span>
      </div>
    </div>
  );
}

/**
 * 타임라인 card (#879, #928): the teams of `projectId` (the board's picked project; 전체 = undefined, 미분류 = null)
 * over the last two hours. `focus` (#board=timeline) scrolls the card into view.
 */
export function TimelineCard({ projectId, onOpen, focus }: { projectId: Scope; onOpen: (id: string) => void; focus?: boolean }) {
  const all = useDispatch(s => s.sessions);
  const roles = useDispatch(s => s.roles);
  const { known: knownFolders, pending = false } = useScope();
  const [data, setData] = useState<Timeline | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** Teams the person opened or closed; the rest follow whether they are busy. */
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ block: 'start' });
  }, [focus]);

  useEffect(() => {
    let alive = true;
    const load = () => api<Timeline>('GET', '/api/timeline').then(d => alive && setData(d), () => {});
    load();
    const fetchT = setInterval(load, 60_000);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => { alive = false; clearInterval(fetchT); clearInterval(tick); };
  }, []);

  const windowMs = data?.windowMs ?? WINDOW_MS;
  const teams = useMemo(() => timelineTeams(all, roles, projectId, knownFolders, pending), [all, roles, projectId, knownFolders, pending]);
  const count = teams.reduce((n, t) => n + 1 + t.members.length, 0);
  const spans = useMemo(() => {
    const m = new Map<string, Spans>();
    for (const s of teams.flatMap(t => [t.lead, ...t.members])) m.set(s.id, windowSpans(rowHistory(s, data?.sessions[s.id], now), now, windowMs));
    return m;
  }, [teams, data, now, windowMs]);
  const spansOf = useMemo(() => (id: string) => spans.get(id) ?? { spans: [], fails: [] }, [spans]);
  const roleNames = useMemo(() => new Map(roles.map(r => [r.id, r.name])), [roles]);
  const roleOf = (s: Session) => roleNames.get(s.role) ?? (s.roleName || s.role);

  return (
    <div ref={ref} className="scroll-mt-4">
      <Card id="timeline" title="타임라인" count={count || undefined} hint="최근 2시간" flush>
        {!count ? (
          <EmptyState>{projectId === undefined ? '아직 세션이 없어요.' : '이 프로젝트에는 아직 세션이 없어요.'}</EmptyState>
        ) : (
          <div className="@container flex flex-col gap-1 px-2 py-3">
            {teams.map(team => {
              const open = picked[team.lead.id] ?? teamBusy([team.lead, ...team.members].map(stateOf));
              return (
                <TeamRows key={team.lead.id} team={team} open={open} onToggle={() => setPicked(p => ({ ...p, [team.lead.id]: !open }))}
                  spansOf={spansOf} roleOf={roleOf} now={now} windowMs={windowMs} onOpen={onOpen} />
              );
            })}
            <Axis now={now} windowMs={windowMs} />
          </div>
        )}
      </Card>
    </div>
  );
}
