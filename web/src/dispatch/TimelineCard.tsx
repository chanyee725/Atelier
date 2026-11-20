// 타임라인 card of the 세션 board (E29, #879): one row per session of the picked project in role lanes, the last two hours across, each stretch
// drawn by state on a sunken, rounded track (refresh, #897). Shape tells states apart without colour: active states fill the row, stuck is hatched, resting is
// a low solid bar (no fade, so it keeps 3:1 against the track), done a thin faded line, a failure a red tick. History is state and time only (GET /api/timeline).
// Forced-colors mode drops author backgrounds and gradients, so every mark also gets a system-colour border there
// (stuck dashed, failures in Highlight); the shapes still tell states apart.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, EmptyState } from '../home/dash';
import { cn } from '../lib/utils';
import { roleColor } from '../run/overlayModel';
import { windowSpans, WINDOW_MS, type Entry } from '../../../shared/dispatch/timeline.js';
import { STATE, TONE_COLOR, stateOf } from './lib/format.ts';
import { rowHistory } from './lib/usage.ts';
import { StateChip } from './parts';
import { api, useDispatch } from './store';
import { useScope } from './scope';
import type { Scope } from './lib/folder.ts';
import { timelineLanes } from './lib/timeline.ts';
import type { Session, SessionState } from './types';

type Timeline = { now: number; windowMs: number; sessions: Record<string, Entry[]> };

const SHAPE: Record<SessionState, { h: string; hatch?: boolean; fade?: boolean }> = {
  working: { h: 'h-full' },
  waiting: { h: 'h-full' },
  stuck: { h: 'h-full', hatch: true },
  failed: { h: 'h-full' },
  resting: { h: 'h-2/5' },
  done: { h: 'h-0.5', fade: true },
};
/** Border marks that stand in for the background fill in forced-colors mode (Windows high contrast). */
const forcedMark = (state: SessionState) =>
  cn('forced-colors:border forced-colors:border-[CanvasText]', SHAPE[state].hatch && 'forced-colors:border-dashed');
const FORCED_FAIL = 'forced-colors:border-l-[3px] forced-colors:border-[Highlight]';
const LEGEND: SessionState[] = ['working', 'waiting', 'stuck', 'failed', 'resting', 'done'];

const hhmm = (t: number) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
const mins = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
};
const known = (st: string): SessionState => (st in SHAPE ? (st as SessionState) : 'resting');

function barStyle(state: SessionState) {
  const color = TONE_COLOR[STATE[state].tone];
  const { hatch, fade } = SHAPE[state];
  return { background: hatch ? `repeating-linear-gradient(135deg, ${color} 0 4px, transparent 4px 7px)` : color, opacity: fade ? 0.55 : 1 };
}

function Swatch({ state }: { state: SessionState }) {
  return (
    <span aria-hidden className="flex h-3 w-4 shrink-0 items-center">
      <span className={cn('w-full rounded-full', SHAPE[state].h, forcedMark(state))} style={barStyle(state)} />
    </span>
  );
}

function Row({ s, history, now, windowMs, onOpen }: { s: Session; history: Entry[]; now: number; windowMs: number; onOpen: () => void }) {
  const start = now - windowMs;
  const { spans, fails } = useMemo(() => windowSpans(history, now, windowMs), [history, now, windowMs]);
  const x = (t: number) => `${((t - start) / windowMs) * 100}%`;
  const w = (a: number, b: number) => `${((b - a) / windowMs) * 100}%`;
  const state = stateOf(s);
  const summary = spans.map(p => `${STATE[known(p.state)].label} ${hhmm(p.from)}–${hhmm(p.to)}`).join(', ');
  return (
    <button
      type="button"
      onClick={onOpen}
      data-row={s.name}
      aria-label={`${s.name}, 지금 ${STATE[state].label}. ${summary}${fails.length ? `. 실패 ${fails.length}번` : ''}`}
      className="grid w-full grid-cols-[200px_1fr] items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none @max-[560px]:grid-cols-1 @max-[560px]:gap-1.5"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium">{s.name}</span>
        <StateChip state={state} className="ml-auto" />
      </span>
      <span aria-hidden className="relative block h-3 overflow-hidden rounded-full bg-sunken">
        {spans.map(p => (
          <span key={p.from} data-span={p.state} title={`${STATE[known(p.state)].label} · ${hhmm(p.from)}–${hhmm(p.to)} (${mins(p.to - p.from)})`}
            className="absolute inset-y-0 flex min-w-0.5 items-center" style={{ left: x(p.from), width: w(p.from, p.to) }}>
            <span className={cn('w-full rounded-full', SHAPE[known(p.state)].h, forcedMark(known(p.state)))} style={barStyle(known(p.state))} />
          </span>
        ))}
        {fails.map(t => (
          <span key={t} title={`실패 · ${hhmm(t)}`} data-fail className={cn('absolute inset-y-0 w-[3px] -translate-x-1/2 bg-destructive ring-1 ring-sunken', FORCED_FAIL)} style={{ left: x(t) }} />
        ))}
      </span>
    </button>
  );
}

function Axis({ now, windowMs }: { now: number; windowMs: number }) {
  const start = now - windowMs;
  const step = 30 * 60_000;
  const ticks: number[] = [];
  for (let t = Math.ceil(start / step) * step; t < now - step / 2; t += step) ticks.push(t);
  return (
    <div aria-hidden className="grid grid-cols-[200px_1fr] gap-3 pr-2 pl-[19px] @max-[560px]:grid-cols-1">
      <span className="@max-[560px]:hidden" />
      <div className="relative h-4 text-[11px] text-muted-foreground tabular-nums">
        {ticks.map(t => <span key={t} className="absolute -translate-x-1/2" style={{ left: `${((t - start) / windowMs) * 100}%` }}>{hhmm(t)}</span>)}
        <span className="absolute right-0">지금</span>
      </div>
    </div>
  );
}

/**
 * 타임라인 card (#879): the sessions of `projectId` (the board's picked project; 전체 = undefined, 미분류 = null) over
 * the last two hours. `focus` (#board=timeline) scrolls the card into view.
 */
export function TimelineCard({ projectId, onOpen, focus }: { projectId: Scope; onOpen: (id: string) => void; focus?: boolean }) {
  const all = useDispatch(s => s.sessions);
  const roles = useDispatch(s => s.roles);
  const { known, pending = false } = useScope();
  const [data, setData] = useState<Timeline | null>(null);
  const [now, setNow] = useState(() => Date.now());
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
  const lanes = useMemo(() => timelineLanes(all, roles, projectId, known, pending), [all, roles, projectId, known, pending]);
  const count = lanes.reduce((n, l) => n + l.sessions.length, 0);
  const histories = useMemo(() => new Map(lanes.flatMap(l => l.sessions).map(s => [s.id, rowHistory(s, data?.sessions[s.id], now)])), [lanes, data, now]);

  return (
    <div ref={ref} className="scroll-mt-4">
      <Card id="timeline" title="타임라인" count={count || undefined} hint="최근 2시간" flush>
        {!count ? (
          <EmptyState>{projectId === undefined ? '아직 세션이 없어요.' : '이 프로젝트에는 아직 세션이 없어요.'}</EmptyState>
        ) : (
          <div className="@container">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b px-4 py-2 text-xs text-muted-foreground">
              {LEGEND.map(st => <span key={st} className="inline-flex items-center gap-1.5"><Swatch state={st} />{STATE[st].label}</span>)}
              <span className="inline-flex items-center gap-1.5"><span aria-hidden data-legend="failed" className={cn('inline-block h-3 w-[3px] bg-destructive', FORCED_FAIL)} />실패한 순간</span>
            </div>
            <div className="flex flex-col gap-4 px-2 py-3">
              {lanes.map(lane => (
                <section key={lane.id} aria-label={lane.name} className="border-l-[3px] pl-2" style={{ borderColor: roleColor(lane.id) }}>
                  <h3 className="m-0 mb-1 px-2 text-[13px] font-semibold">{lane.name}</h3>
                  {lane.sessions.map(s => (
                    <Row key={s.id} s={s} history={histories.get(s.id) ?? []} now={now} windowMs={windowMs} onOpen={() => onOpen(s.id)} />
                  ))}
                </section>
              ))}
              <Axis now={now} windowMs={windowMs} />
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
